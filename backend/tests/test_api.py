import pytest
from fastapi import HTTPException

from app.main import (
    app,
    get_calendar,
    get_dataset_status,
    get_datasets,
    get_harmonization_readiness,
    get_health,
    get_hotspots,
    get_job_status,
    get_report_status,
    get_sensor_comparison,
    get_summary,
    get_temporal_analytics,
    post_generate_report,
    post_validate_schema,
    run_harmonization,
)
from app.models.schemas import (
    HarmonizationParametersSchema,
    ReportConfigSchema,
    SchemaValidationRequest,
)
from app.services.registry import DatasetRegistry, JobStore
from tests.factories import obs, registry_with


def empty():
    return DatasetRegistry(), JobStore()


def hotspots(reg, **kw):
    args = dict(sensor=None, min_confidence=0.0, min_frp=0.0, max_frp=None, start_date=None, end_date=None,
                min_lat=-90.0, max_lat=90.0, min_lon=-180.0, max_lon=180.0, limit=5000, reg=reg)
    args.update(platform=None, region_id=None)
    args.update(kw)
    return get_hotspots(**args)


def test_route_registration():
    paths = {r.path for r in app.routes}
    for p in ["/api/health", "/api/observations/summary", "/api/explorer/hotspots", "/api/harmonization/run",
              "/api/harmonization/jobs/{job_id}", "/api/harmonization/readiness", "/api/calendar",
              "/api/analytics/temporal", "/api/analytics/sensors", "/api/datasets", "/api/datasets/status",
              "/api/datasets/upload", "/api/datasets/{dataset_id}/observations", "/api/datasets/{dataset_id}",
              "/api/acquisition/availability", "/api/acquisitions", "/api/acquisitions/{job_id}",
              "/api/acquisitions/{job_id}/pause", "/api/acquisitions/{job_id}/resume",
              "/api/regions", "/api/regions/{region_id}",
              "/api/datasets/validate-schema", "/api/reports", "/api/reports/generate"]:
        assert p in paths


def test_health_has_no_fake_pipeline_claims():
    h = get_health()
    assert h["status"] == "healthy" and "harmonizationEngine" not in h


def test_empty_state_for_every_read_endpoint():
    reg, jobs = empty()
    s = get_summary(reg=reg, jobs=jobs)
    assert s.status == "no_dataset" and s.totalDetections is None and s.modisCount is None
    assert s.datasetsLoaded == 0 and s.recentBatches == [] and s.processedTiles == []
    h = hotspots(reg)
    assert h.status == "no_dataset" and h.items == [] and "Awaiting NASA dataset" in h.message
    assert get_datasets(reg=reg).datasets == []
    st = get_dataset_status(reg=reg)
    assert st.datasetsLoaded == 0 and st.harmonizationReady is False
    cal = get_calendar(start_year=2000, end_year=2020, metric="frp_sum", sensor="all", reg=reg)
    assert cal.status == "no_dataset" and cal.cells == []
    t = get_temporal_analytics(start_year=2000, end_year=2020, metric="frp_sum", reg=reg)
    assert t.status == "no_dataset" and t.stlDecomposition == [] and t.kpis.mannKendallTrend is None
    c = get_sensor_comparison(spatial_tolerance_m=750.0, temporal_window_min=30.0, reg=reg)
    assert c.status == "no_dataset" and c.frpScatterPairs == []
    r = get_report_status(jobs=jobs)
    assert r.canGenerate is False and r.availableSections == []
    assert get_harmonization_readiness(reg=reg).ready is False


def test_harmonization_run_without_datasets_is_conflict():
    reg, jobs = empty()
    p = HarmonizationParametersSchema(startDate="2020-01-01", endDate="2020-12-31")
    with pytest.raises(HTTPException) as e:
        run_harmonization(p, reg=reg, jobs=jobs)
    assert e.value.status_code == 409 and e.value.detail["code"] == "DATASETS_UNAVAILABLE"
    assert set(e.value.detail["missing"]) == {"MODIS", "VIIRS"}


def test_harmonization_psf_is_not_implemented():
    reg = registry_with([obs("Aqua", 0, 0)], [obs("NOAA-20", 0, 0)])
    p = HarmonizationParametersSchema(startDate="2020-01-01", endDate="2020-12-31", enablePsfDeconvolution=True)
    with pytest.raises(HTTPException) as e:
        run_harmonization(p, reg=reg, jobs=JobStore())
    assert e.value.status_code == 501


def test_unknown_job_is_404():
    with pytest.raises(HTTPException) as e:
        get_job_status("job-does-not-exist", jobs=JobStore())
    assert e.value.status_code == 404


def test_job_status_reflects_actual_execution():
    reg, jobs = registry_with([obs("Aqua", 0, 0)], [obs("NOAA-20", 0.001, 0, time="1205")]), JobStore()
    p = HarmonizationParametersSchema(startDate="2020-01-01", endDate="2020-12-31")
    res = run_harmonization(p, reg=reg, jobs=jobs)
    assert get_job_status(res.jobId, jobs=jobs).status == "completed"


@pytest.mark.parametrize("kw", [
    {"min_frp": 10.0, "max_frp": 5.0},
    {"min_lat": 10.0, "max_lat": 0.0},
    {"min_lon": 10.0, "max_lon": 0.0},
])
def test_hotspot_invalid_ranges_are_422(kw):
    with pytest.raises(HTTPException) as e:
        hotspots(DatasetRegistry(), **kw)
    assert e.value.status_code == 422


def test_hotspot_filters_on_loaded_data():
    reg = registry_with([obs("Aqua", 0, 0, frp=5.0, confidence=90.0)],
                        [obs("NOAA-20", 5, 5, frp=50.0, confidence=60.0), obs("NOAA-20", 20, 20, frp=500.0, confidence=99.0)])
    assert hotspots(reg).total == 3
    assert hotspots(reg, sensor="VIIRS").total == 2
    assert hotspots(reg, min_confidence=95.0).total == 1
    assert hotspots(reg, min_frp=10.0, max_frp=100.0).total == 1
    assert hotspots(reg, min_lat=10.0, max_lat=30.0, min_lon=10.0, max_lon=30.0).total == 1
    assert hotspots(reg, limit=1).total == 3 and len(hotspots(reg, limit=1).items) == 1


def test_calendar_invalid_range_is_422():
    with pytest.raises(HTTPException) as e:
        get_calendar(start_year=2020, end_year=2010, metric="frp_sum", sensor="all", reg=DatasetRegistry())
    assert e.value.status_code == 422


def test_overview_counts_are_real_computed_counts():
    reg = registry_with([obs("Aqua", 0, 0), obs("Terra", 1, 1)], [obs("NOAA-20", 2, 2)])
    s = get_summary(reg=reg, jobs=JobStore())
    assert (s.totalDetections, s.modisCount, s.viirsCount, s.modisAquaCount, s.modisTerraCount) == (3, 2, 1, 1, 1)
    assert s.harmonizedDualSensorClusters is None and s.matchPercentage is None  # needs a completed job


def test_schema_validation_endpoint():
    ok = post_validate_schema(SchemaValidationRequest(sensor="MODIS", columns=[
        "latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite",
        "confidence", "version", "bright_t31", "frp", "daynight"]))
    assert ok.valid and ok.missingRequired == []
    bad = post_validate_schema(SchemaValidationRequest(sensor="VIIRS", columns=["latitude", "latitude", "x"]))
    assert not bad.valid and "frp" in bad.missingRequired and bad.duplicateColumns == ["latitude"]
    assert bad.unexpectedColumns == ["x"]
    with pytest.raises(ValueError):
        SchemaValidationRequest(sensor="MODIS", columns=[])


def test_report_cannot_be_generated_without_analysis():
    with pytest.raises(HTTPException) as e:
        post_generate_report(ReportConfigSchema(), jobs=JobStore())
    assert e.value.status_code == 409 and e.value.detail["code"] == "NO_VALID_ANALYSIS"


def test_report_is_built_only_from_a_completed_job():
    reg, jobs = registry_with([obs("Aqua", 0, 0)], [obs("NOAA-20", 0.001, 0, time="1205")]), JobStore()
    p = HarmonizationParametersSchema(startDate="2020-01-01", endDate="2020-12-31")
    job = run_harmonization(p, reg=reg, jobs=jobs)
    assert get_report_status(jobs=jobs).canGenerate is True
    rep = post_generate_report(ReportConfigSchema(author=""), jobs=jobs)
    assert rep.sourceJobId == job.jobId and rep.author is None
    assert len(rep.provenanceHash) == 64 and len(rep.sections) >= 1
    only = post_generate_report(ReportConfigSchema(includeSections=["provenance"]), jobs=jobs)
    assert [s.id for s in only.sections] == ["provenance"]
