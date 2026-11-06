import pytest

from app.models.schemas import HarmonizationParametersSchema
from app.services.harmonization import (
    DatasetsUnavailable,
    FeatureNotImplemented,
    execute_harmonization,
    get_readiness,
)
from app.services.registry import DatasetRegistry, JobStore
from tests.factories import obs, registry_with


def params(**kw):
    base = dict(startDate="2020-01-01", endDate="2020-12-31")
    base.update(kw)
    return HarmonizationParametersSchema(**base)


def test_readiness_empty_registry_is_not_ready():
    r = get_readiness(DatasetRegistry())
    assert r.ready is False
    assert set(r.missing) == {"MODIS", "VIIRS"}
    assert all(not i.available and i.recordCount == 0 for i in r.inputs)
    assert "Awaiting NASA dataset" in r.reason


def test_readiness_requires_both_sensors():
    reg = registry_with(modis=[obs("Aqua", 0, 0)])
    assert get_readiness(reg).missing == ["VIIRS"]


def test_run_refused_without_datasets_and_no_job_recorded():
    jobs = JobStore()
    with pytest.raises(DatasetsUnavailable) as exc:
        execute_harmonization(params(), DatasetRegistry(), jobs)
    assert set(exc.value.missing) == {"MODIS", "VIIRS"}
    assert jobs.latest_completed() is None


def test_psf_deconvolution_is_not_silently_accepted():
    reg = registry_with([obs("Aqua", 0, 0)], [obs("NOAA-20", 0, 0)])
    with pytest.raises(FeatureNotImplemented):
        execute_harmonization(params(enablePsfDeconvolution=True), reg, JobStore())


@pytest.mark.parametrize("kw", [
    {"startDate": "2020-02-01", "endDate": "2020-01-01"},
    {"startDate": "not-a-date"},
    {"spatialToleranceMeters": 0},
    {"temporalWindowMinutes": -5},
    {"modisMinConfidence": 101},
    {"selectedSensors": []},
    {"selectedSensors": ["Terra", "Aqua"]},
])
def test_parameter_validation_rejects_invalid_input(kw):
    with pytest.raises(ValueError):
        params(**kw)


def test_completed_job_reports_only_computed_values():
    modis = [obs("Aqua", 0.0, 0.0, time="1200", frp=10.0), obs("Aqua", 1.0, 1.0, time="1200", frp=20.0),
             obs("Terra", 2.0, 2.0, time="1200", frp=30.0)]
    viirs = [obs("NOAA-20", 0.001, 0.0, time="1205", frp=11.0), obs("NOAA-20", 1.001, 1.0, time="1205", frp=22.0),
             obs("NOAA-20", 2.001, 2.0, time="1205", frp=33.0), obs("NOAA-20", 50.0, 50.0, frp=5.0)]
    reg, jobs = registry_with(modis, viirs), JobStore()
    res = execute_harmonization(params(), reg, jobs)
    assert res.status == "completed"
    assert (res.modisCount, res.viirsCount, res.totalRawRecords) == (3, 4, 7)
    assert res.confirmedCrossMatches == 3 and res.unmatchedViirsObservations == 1 and res.candidateDuplicates == 0
    assert "unmatchedViirsObservations" in res.model_dump()
    assert "subpixelViirsOnly" not in res.model_dump()
    assert res.harmonizedUniqueEvents == 4
    assert res.pearsonR is not None and res.pearsonR > 0.99
    assert jobs.get(res.jobId).status == "completed"


def test_no_pearson_with_too_few_pairs():
    reg = registry_with([obs("Aqua", 0, 0)], [obs("NOAA-20", 0.001, 0)])
    res = execute_harmonization(params(), reg, JobStore())
    assert res.confirmedCrossMatches == 1
    assert res.pearsonR is None and res.rSquared is None


def test_viirs_categorical_confidence_is_preserved_without_numeric_filtering():
    v = obs("NOAA-20", 0.001, 0, confidence=10.0)
    v.confidence_class = "l"
    reg = registry_with([obs("Aqua", 0, 0)], [v])
    res = execute_harmonization(params(viirsMinConfidence=100), reg, JobStore())
    assert res.viirsCount == 1
    assert res.confirmedCrossMatches == 1


def test_missing_frp_does_not_remove_observations_or_create_correlation_pairs():
    m = obs("Aqua", 0, 0, frp=None)
    v = obs("NOAA-20", 0.001, 0, frp=12.0)
    res = execute_harmonization(params(), registry_with([m], [v]), JobStore())
    assert res.totalRawRecords == 2
    assert res.confirmedCrossMatches == 1
    assert res.pearsonR is None


def test_counts_use_one_to_one_associations_and_report_unmatched_sensor_rows():
    m = obs("Aqua", 0, 0)
    v1 = obs("NOAA-20", 0.0001, 0, time="1201")
    v2 = obs("NOAA-21", 0.0002, 0, time="1202")
    res = execute_harmonization(params(), registry_with([m], [v1, v2]), JobStore())
    assert res.totalRawRecords == 3
    assert res.confirmedCrossMatches == 1
    assert res.candidateDuplicates == 1
    assert res.unmatchedViirsObservations == 1
    assert res.harmonizedUniqueEvents == 2  # one association plus one unmatched observation
    statuses = {row.status for row in res.sampleMatches}
    assert "harmonized_match" in statuses
    assert "candidate_duplicate" in statuses
    assert "viirs_unmatched" in statuses


def test_failure_is_recorded_as_failed_job():
    reg = registry_with([obs("Aqua", 0, 0, time="9999")], [obs("NOAA-20", 0, 0)])
    jobs = JobStore()
    res = execute_harmonization(params(), reg, jobs)
    assert res.status == "failed" and res.error
    assert jobs.latest_completed() is None


def test_harmonization_job_survives_store_recreation(tmp_path):
    reg = registry_with([obs("Aqua", 0, 0)], [obs("NOAA-20", 0.001, 0)])
    jobs = JobStore(str(tmp_path))
    result = execute_harmonization(params(), reg, jobs)
    reloaded = JobStore(str(tmp_path))
    assert reloaded.get(result.jobId).model_dump() == result.model_dump()
    entry = reloaded.latest_completed()
    assert entry["result"].jobId == result.jobId
    assert entry["params"].startDate == "2020-01-01"


def test_filters_by_date_and_platform():
    reg = registry_with([obs("Aqua", 0, 0, date="2019-06-01"), obs("Terra", 0, 0)], [obs("NOAA-20", 0, 0)])
    res = execute_harmonization(params(selectedSensors=["Aqua", "NOAA-20"]), reg, JobStore())
    assert res.modisCount == 0 and res.viirsCount == 1
