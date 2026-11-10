import csv
import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

import app.main as main_module
from app.main import app, delete_dataset, get_dataset_observations, get_datasets, upload_dataset
from app.services.registry import DatasetRegistry
from app.services.ingestion import _platform

MODIS = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite", "confidence", "version", "bright_t31", "frp", "daynight"]
VIIRS = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time", "satellite", "confidence", "version", "bright_ti5", "frp", "daynight"]


def row(columns, **values):
    defaults = {
        "latitude": "34.25", "longitude": "-118.5", "brightness": "320.1", "bright_ti4": "310.2",
        "scan": "1.0", "track": "1.1", "acq_date": "2024-02-03", "acq_time": "45",
        "satellite": "Terra", "confidence": "85", "version": "6.1N", "bright_t31": "290.0",
        "bright_ti5": "280.0", "frp": "12.5", "daynight": "D",
    }
    defaults.update(values)
    return [defaults.get(c, "") for c in columns]


def make_csv(columns, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(columns)
    writer.writerows(rows)
    return out.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    app_settings = SimpleNamespace(DATA_DIR=str(tmp_path / "store"), MAX_UPLOAD_BYTES=2_000_000)
    monkeypatch.setattr(main_module, "settings", app_settings)
    reg = DatasetRegistry(app_settings.DATA_DIR)
    yield reg, tmp_path / "store"


def upload(client, sensor, contents, filename="fire.csv"):
    reg, _ = client
    source = contents.encode("utf-8") if isinstance(contents, str) else contents
    return upload_dataset(file=UploadFile(filename=filename, file=io.BytesIO(source)), sensor=sensor, reg=reg)


def test_uploads_valid_modis_and_viirs_layouts(client):
    reg, _ = client
    modis = upload(client, "MODIS", make_csv(MODIS, [row(MODIS)]), "modis.csv")
    viirs = upload(client, "VIIRS", make_csv(VIIRS, [row(VIIRS, satellite="NOAA-20", confidence="n")]), "viirs.csv")
    assert modis.dataset.recordCount == viirs.dataset.recordCount == 1
    assert viirs.dataset.qualityReport["platformDistribution"] == {"NOAA-20": 1}
    assert len(reg.observations("MODIS")) == 1
    v = reg.observations("VIIRS")[0]
    assert v.confidence is None and v.confidence_class == "n"
    assert v.acq_time == "0045" and v.source_columns["confidence"] == "n"


def test_suomi_npp_short_code_n_is_normalized_and_reported(client):
    response = upload(client, "VIIRS", make_csv(VIIRS, [row(VIIRS, satellite="N")]), "snpp.csv")
    assert response.dataset.recordCount == 1
    assert response.dataset.satellite == "Suomi-NPP"
    assert response.dataset.qualityReport["platformDistribution"] == {"Suomi-NPP": 1}
    assert response.dataset.provenance["uploadedFilename"] == "snpp.csv"


@pytest.mark.parametrize(("sensor", "value", "expected"), [
    ("MODIS", "Terra", "Terra"), ("MODIS", "T", "Terra"),
    ("MODIS", "Aqua", "Aqua"), ("MODIS", "A", "Aqua"),
    ("VIIRS", "N", "Suomi-NPP"), ("VIIRS", "SNPP", "Suomi-NPP"),
    ("VIIRS", "N20", "NOAA-20"), ("VIIRS", "J1", "NOAA-20"),
    ("VIIRS", "N21", "NOAA-21"), ("VIIRS", "J2", "NOAA-21"),
])
def test_known_platform_mappings_are_preserved(sensor, value, expected):
    assert _platform(sensor, value) == expected


def test_unknown_viirs_platform_is_still_rejected(client):
    response = upload(client, "VIIRS", make_csv(VIIRS, [row(VIIRS, satellite="UNKNOWN")]))
    assert response.dataset.recordCount == 0
    assert response.dataset.qualityReport["rejectionReasons"]["invalid_platform"] == 1


def test_missing_required_columns_and_non_csv_are_rejected(client):
    with pytest.raises(HTTPException) as err:
        upload(client, "MODIS", make_csv(MODIS[:-1], []))
    assert err.value.status_code == 400 and err.value.detail["code"] == "INVALID_SCHEMA"
    with pytest.raises(HTTPException) as err:
        upload(client, "MODIS", "not a csv", "report.txt")
    assert err.value.status_code == 415


def test_invalid_coordinates_and_platform_are_counted_not_silently_dropped(client):
    reg, _ = client
    contents = make_csv(MODIS, [
        row(MODIS, latitude="91"),
        row(MODIS, satellite="NOAA-20"),
        row(MODIS, longitude="not-a-number"),
    ])
    response = upload(client, "MODIS", contents)
    report = response.dataset.qualityReport
    assert report["totalInputRows"] == 3 and report["successfullyParsedRows"] == 0 and report["rejectedRows"] == 3
    assert report["invalidCoordinates"] == 2
    assert report["rejectionReasons"]["invalid_platform"] == 1
    assert reg.observations("MODIS") == []


def test_malformed_empty_and_oversized_uploads_are_rejected(client, monkeypatch):
    with pytest.raises(HTTPException) as err:
        upload(client, "MODIS", b"")
    assert err.value.status_code == 400
    malformed = ",".join(MODIS) + '\n"unterminated\n'
    with pytest.raises(HTTPException) as err:
        upload(client, "MODIS", malformed)
    assert err.value.status_code == 400
    main_module.settings.MAX_UPLOAD_BYTES = 10
    with pytest.raises(HTTPException) as err:
        upload(client, "MODIS", make_csv(MODIS, [row(MODIS)]))
    assert err.value.status_code == 413 and err.value.detail["code"] == "FILE_TOO_LARGE"


def test_duplicate_records_quality_report_and_persisted_reload(client):
    reg, store = client
    contents = make_csv(MODIS, [row(MODIS), row(MODIS)])
    response = upload(client, "MODIS", contents, "..\\unsafe\\source.csv")
    dataset = response.dataset
    assert dataset.qualityReport["duplicateRecords"] == 1
    assert dataset.sourceFilename == "source.csv"
    assert dataset.qualityReport["geographicBoundingBox"]["minLatitude"] == 34.25
    assert (store / dataset.id / "original.csv").is_file()
    assert (store / dataset.id / "observations.jsonl").is_file()
    assert (store / dataset.id / "validation_report.json").is_file()
    reloaded = DatasetRegistry(str(store))
    assert reloaded.datasets()[0].id == dataset.id
    assert len(reloaded.observation_page(dataset.id, limit=1)) == 1
    assert len(reloaded.query_observations(sensor="MODIS", platform="Terra", start_date="2024-02-03", bbox=(34, 35, -119, -118))) == 2
    with reloaded._connect() as conn:
        index_names = {row[1] for row in conn.execute("PRAGMA index_list(observations)")}
    assert {"idx_observations_dataset", "idx_observations_sensor", "idx_observations_platform", "idx_observations_date", "idx_observations_lat_lon"} <= index_names
    assert len(reg.observations()) == 2


def test_multiple_datasets_preview_and_removal(client):
    reg, store = client
    a = upload(client, "MODIS", make_csv(MODIS, [row(MODIS)]), "a.csv").dataset.id
    b = upload(client, "VIIRS", make_csv(VIIRS, [row(VIIRS, satellite="Suomi-NPP")]), "b.csv").dataset.id
    assert len(get_datasets(reg).datasets) == 2
    assert get_dataset_observations(b, 0, 5, reg)[0].platform == "Suomi-NPP"
    assert delete_dataset(a, reg) is None
    assert not (store / a).exists()
    assert len(get_datasets(reg).datasets) == 1
    with pytest.raises(HTTPException) as err:
        get_dataset_observations(a, 0, 100, reg)
    assert err.value.status_code == 404
