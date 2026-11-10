import csv
import hashlib
from contextlib import contextmanager
from datetime import date, datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.schemas import AcquisitionStartRequest, DatasetMetadataSchema, RegionDefinitionSchema
from app.services.acquisition import AcquisitionManager, AcquisitionRecoveryError, RawCsvConflictError, plan_chunks, point_in_geometry, sha256_file
from app.services.registry import DatasetRegistry
from app.services.regions import RegionStore


def verified_manifest(manager, source="VIIRS_NOAA21_SP", start="2024-01-17", end="2024-01-21"):
    manager._write_availability({
        "status": "verified", "checkedAt": "2024-01-21T00:00:00+00:00", "message": "NASA fixture response",
        "sources": [{"sourceId": source, "label": source, "sensor": "VIIRS", "platforms": ["NOAA-21"],
                     "minDate": start, "maxDate": end, "status": "available"}],
    })


class FakeResponse:
    def __init__(self, body=b"", json_body=None):
        self.body = body
        self.headers = {"content-length": str(len(body))}
        self._json_body = json_body or {}
        self.text = body.decode("utf-8", errors="replace")

    def raise_for_status(self):
        return None

    def json(self):
        return self._json_body

    def iter_bytes(self, chunk_size):
        for offset in range(0, len(self.body), 11):
            yield self.body[offset:offset + 11]


def firms_csv(rows):
    header = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"
    return (header + "".join(rows)).encode()


def sample_row(lat="29.5", lon="79.0", day="2024-01-17", satellite="N21"):
    return f"{lat},{lon},330.2,0.4,0.5,{day},930,{satellite},VIIRS,n,2.0SP,300.1,2.4,D\n"


def build_manager(tmp_path, *, key="test-key", registry=None, regions=None, **kwargs):
    return AcquisitionManager(tmp_path, key, registry or DatasetRegistry(str(tmp_path)),
                              regions or RegionStore(str(tmp_path)), requests_per_minute=30,
                              retry_base_seconds=0, start_workers=False, **kwargs)


def test_availability_discovery_records_actual_csv_dates_and_persists(tmp_path):
    body = ("data_id,min_date,max_date\nMODIS_SP,2000-11-01,2026-11-01\n"
            "VIIRS_NOAA20_SP,2018-04-01,2026-10-28\nVIIRS_NOAA21_SP,2024-01-17,2026-10-28\n"
            "VIIRS_SNPP_SP,2012-01-20,2026-10-28\n").encode()
    manager = build_manager(tmp_path, http_get=lambda *args, **kwargs: FakeResponse(body))
    result = manager.availability(refresh=True)
    assert result["status"] == "verified"
    assert {row["sourceId"]: (row["minDate"], row["maxDate"]) for row in result["sources"]}["VIIRS_NOAA21_SP"] == ("2024-01-17", "2026-10-28")
    reloaded = build_manager(tmp_path)
    assert reloaded.availability()["sources"] == result["sources"]


def test_missing_key_does_not_guess_availability(tmp_path):
    manager = build_manager(tmp_path, key="")
    result = manager.availability(refresh=True)
    assert result["status"] == "configuration_required"
    assert all(row["minDate"] is None and row["maxDate"] is None for row in result["sources"])


def test_study_start_is_enforced_and_request_cannot_exceed_verified_sp_latest(tmp_path):
    with pytest.raises(ValidationError, match="2022-01-01"):
        AcquisitionStartRequest(regionId="california-usa", product="VIIRS_SNPP_SP",
                                startDate="2021-12-31", endDate="2022-01-01")

    manager = build_manager(tmp_path)
    verified_manifest(manager, start="2022-01-20", end="2026-10-28")
    with pytest.raises(ValueError, match="latest NASA FIRMS SP date"):
        manager.create_job(AcquisitionStartRequest(regionId="california-usa", product="VIIRS_NOAA21_SP",
                                                   startDate="2026-10-28", endDate="2026-10-29"))


def test_date_chunking_caps_area_api_at_five_days_and_marks_platform_gaps():
    chunks = plan_chunks(date(2024, 1, 15), date(2024, 1, 27), date(2024, 1, 17), date(2024, 1, 23))
    assert chunks[0] == {"startDate": "2024-01-15", "endDate": "2024-01-16", "status": "unavailable_product_coverage"}
    requested = [c for c in chunks if c["status"] == "pending"]
    assert [(c["startDate"], c["endDate"]) for c in requested] == [("2024-01-17", "2024-01-21"), ("2024-01-22", "2024-01-23")]
    assert chunks[-1]["status"] == "not_yet_available"
    assert max((date.fromisoformat(c["endDate"]) - date.fromisoformat(c["startDate"])).days + 1 for c in requested) <= 5
    across_year = plan_chunks(date(2023, 12, 29), date(2024, 1, 3), date(2023, 1, 1), date(2025, 1, 1))
    assert [(c["startDate"], c["endDate"]) for c in across_year] == [("2023-12-29", "2023-12-31"), ("2024-01-01", "2024-01-03")]


def test_point_filter_supports_polygon_holes_and_multipolygon():
    polygon = {"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]}
    assert point_in_geometry(0.5, 0.5, polygon)
    assert not point_in_geometry(2, 2, polygon)
    assert point_in_geometry(11, 1, {"type": "MultiPolygon", "coordinates": [[[[10, 0], [12, 0], [12, 2], [10, 2], [10, 0]]]]})


def test_retry_checksum_polygon_filter_import_dedup_and_restart(tmp_path):
    regions = RegionStore(str(tmp_path))
    region = RegionDefinitionSchema(
        id="pilot-region", name="Pilot ROI", country="Test", boundingBox={"minLatitude": 28, "maxLatitude": 31, "minLongitude": 77, "maxLongitude": 82},
        boundaryGeometry={"type": "Polygon", "coordinates": [[[78, 29], [80, 29], [80, 30], [78, 30], [78, 29]]]},
        boundaryNote="Synthetic polygon for software tests only.",
    )
    regions.upsert(region)
    registry = DatasetRegistry(str(tmp_path))
    attempts = {"area": 0}
    csv_bytes = firms_csv([sample_row(), sample_row(lat="30.5", lon="81.2")])

    def get(url, **kwargs):
        return FakeResponse(json_body={"transaction_limit": 5000, "current_transactions": 10})

    @contextmanager
    def stream(method, url, **kwargs):
        attempts["area"] += 1
        if attempts["area"] == 1:
            raise httpx.ConnectError("temporary test outage")
        yield FakeResponse(csv_bytes)

    manager = build_manager(tmp_path, registry=registry, regions=regions, http_get=get, http_stream=stream, max_retries=1)
    verified_manifest(manager)
    request = AcquisitionStartRequest(regionId=region.id, product="VIIRS_NOAA21_SP", startDate="2024-01-17", endDate="2024-01-21")
    job = manager.create_job(request)
    manager._run_job(job["id"])
    result = manager.get_job(job["id"])
    assert result["status"] == "completed", f"job={result['message']} chunks={[chunk['error'] for chunk in result['chunks']]}"
    assert result["recordsDownloaded"] == 2
    assert attempts["area"] == 2
    imported = registry.datasets()
    assert len(imported) == 1 and imported[0].recordCount == 1
    assert imported[0].qualityReport["acquisition"]["recordsBeforeRoiFilter"] == 2
    assert imported[0].qualityReport["acquisition"]["recordsAfterRoiFilter"] == 1
    chunk = result["chunks"][0]
    raw_file = tmp_path / "firms_acquisition" / "raw" / region.id / "VIIRS_NOAA21_SP" / "2024" / chunk["originalFilename"]
    assert raw_file.is_file() and sha256_file(raw_file) == chunk["checksum"] == hashlib.sha256(csv_bytes).hexdigest()

    # Exact repeated chunk uses the persisted checksum and does not request or import twice.
    repeat = manager.create_job(request)
    manager._run_job(repeat["id"])
    assert attempts["area"] == 2
    assert len(registry.datasets()) == 1

    restarted_registry = DatasetRegistry(str(tmp_path))
    restarted = build_manager(tmp_path, registry=restarted_registry, regions=RegionStore(str(tmp_path)))
    assert restarted.get_job(job["id"])["status"] == "completed"
    assert len(restarted_registry.datasets()) == 1
    assert restarted.availability()["status"] == "verified"


def test_valid_empty_csv_is_not_marked_unavailable(tmp_path):
    headers_only = firms_csv([])
    path = tmp_path / "empty.csv"
    path.write_bytes(headers_only)
    count, versions, satellites = AcquisitionManager._validate_firms_csv(path, "VIIRS")
    assert count == 0 and versions == set() and satellites == set()


def test_existing_valid_raw_csv_is_reused_only_with_matching_metadata(tmp_path):
    manager = build_manager(tmp_path)
    region_id = "california-usa"
    source = "VIIRS_NOAA21_SP"
    start, end = "2024-01-17", "2024-01-21"
    folder = manager.raw_root / region_id / source / "2024"
    folder.mkdir(parents=True)
    path = folder / f"{start}_{end}.csv"
    body = firms_csv([sample_row()])
    path.write_bytes(body)
    cache = {
        "file_path": str(path.relative_to(manager.data_dir)),
        "checksum": hashlib.sha256(body).hexdigest(),
        "record_count": 1,
        "original_filename": path.name,
        "downloaded_at": "2024-01-22T00:00:00+00:00",
        "product_version": "2.0SP",
        "satellite": "NOAA-21",
        "status": "valid_data",
    }
    manager._validate_cached_download(cache, path, source, region_id, start, end)
    assert path.read_bytes() == body


def test_invalid_existing_raw_csv_is_preserved_as_conflict(tmp_path):
    manager = build_manager(tmp_path)
    region_id = "california-usa"
    source = "VIIRS_NOAA21_SP"
    start, end = "2024-01-17", "2024-01-21"
    folder = manager.raw_root / region_id / source / "2024"
    folder.mkdir(parents=True)
    path = folder / f"{start}_{end}.csv"
    original = b"not a FIRMS CSV\n"
    path.write_bytes(original)
    cache = {"file_path": str(path.relative_to(manager.data_dir)),
             "checksum": hashlib.sha256(original).hexdigest(), "record_count": 1,
             "original_filename": path.name, "downloaded_at": "2024-01-22T00:00:00+00:00",
             "product_version": "2.0SP", "satellite": "NOAA-21", "status": "valid_data"}
    with pytest.raises(RawCsvConflictError, match="failed FIRMS validation"):
        manager._validate_cached_download(cache, path, source, region_id, start, end)
    assert path.read_bytes() == original


def test_fetch_refuses_to_overwrite_existing_raw_file_without_network_calls(tmp_path):
    calls = {"budget": 0, "stream": 0}

    def budget(_days):
        calls["budget"] += 1

    def stream(*_args, **_kwargs):
        calls["stream"] += 1
        raise AssertionError("network stream must not be opened for an existing target")

    manager = build_manager(tmp_path, http_stream=stream)
    manager._budget_check = budget
    region = RegionStore(str(tmp_path)).get("california-usa")
    target = manager.raw_root / region.id / "VIIRS_NOAA21_SP" / "2024" / "2024-01-17_2024-01-21.csv"
    target.parent.mkdir(parents=True)
    original = firms_csv([sample_row()])
    target.write_bytes(original)
    with pytest.raises(RawCsvConflictError, match="already exists"):
        manager._fetch_to_file(region, "VIIRS_NOAA21_SP", date(2024, 1, 17), date(2024, 1, 21), target)
    assert target.read_bytes() == original
    assert calls == {"budget": 0, "stream": 0}


def test_failed_job_resume_keeps_job_and_six_chunk_records(tmp_path):
    regions = RegionStore(str(tmp_path))
    manager = build_manager(tmp_path, regions=regions)
    verified_manifest(manager, start="2024-02-01", end="2024-02-28")
    job = manager.create_job(AcquisitionStartRequest(
        regionId=regions.list()[0].id, product="VIIRS_NOAA21_SP",
        startDate="2024-02-01", endDate="2024-02-28"))
    assert job["totalChunks"] == 6
    manager._set_job(job["id"], "failed", "test worker failure")
    for chunk in job["chunks"]:
        manager._update_chunk(job["id"], chunk["startDate"], chunk["endDate"], status="failed", error="test chunk failure")

    resumed = manager.resume(job["id"])
    assert resumed["id"] == job["id"]
    assert resumed["status"] == "queued"
    assert resumed["totalChunks"] == 6
    assert len(manager.list_jobs()) == 1
    assert all(chunk["status"] == "pending" for chunk in resumed["chunks"])


def test_zero_detections_are_persisted_and_failed_chunk_can_resume(tmp_path):
    regions = RegionStore(str(tmp_path))
    registry = DatasetRegistry(str(tmp_path))
    calls = {"count": 0}
    empty_body = firms_csv([])

    def get(url, **kwargs):
        return FakeResponse(json_body={"transaction_limit": 5000, "current_transactions": 2})

    @contextmanager
    def stream(method, url, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise httpx.ConnectError("temporary outage")
        yield FakeResponse(empty_body)

    manager = build_manager(tmp_path, registry=registry, regions=regions, http_get=get,
                            http_stream=stream, max_retries=0)
    verified_manifest(manager)
    region_id = regions.list()[0].id
    request = AcquisitionStartRequest(regionId=region_id, product="VIIRS_NOAA21_SP",
                                     startDate="2024-01-17", endDate="2024-01-17")
    job = manager.create_job(request)
    manager._run_job(job["id"])
    failed = manager.get_job(job["id"])
    assert failed["status"] == "partial_failure" and failed["chunks"][0]["status"] == "failed"
    resumed = manager.resume(job["id"])
    assert resumed["status"] == "queued"
    manager._run_job(job["id"])
    done = manager.get_job(job["id"])
    assert done["status"] == "completed", f"job={done['message']} chunks={[chunk['error'] for chunk in done['chunks']]}"
    assert done["chunks"][0]["status"] == "zero_detections" and done["recordsDownloaded"] == 0
    assert registry.datasets()[-1].recordCount == 0


def test_large_csv_validation_streams_all_rows(tmp_path):
    path = tmp_path / "large-fixture.csv"
    with path.open("wb") as output:
        output.write(firms_csv([]))
        for _ in range(25_000):
            output.write(sample_row().encode())
    count, _, satellites = AcquisitionManager._validate_firms_csv(path, "VIIRS")
    assert count == 25_000 and satellites == {"N21"}


def test_acquisition_validator_accepts_n_for_snpp_and_rejects_unknown_platform(tmp_path):
    manager = build_manager(tmp_path)
    region_id = "california-usa"
    source = "VIIRS_SNPP_SP"
    start, end = "2024-02-01", "2024-02-01"
    folder = manager.raw_root / region_id / source / "2024"
    folder.mkdir(parents=True)
    path = folder / f"{start}_{end}.csv"
    path.write_bytes(firms_csv([sample_row(satellite="N")]))
    cache = {
        "file_path": str(path.relative_to(manager.data_dir)), "checksum": sha256_file(path),
        "record_count": 1, "original_filename": path.name,
        "downloaded_at": "2024-02-02T00:00:00+00:00", "product_version": "2.0SP",
        "satellite": "N", "status": "valid_data",
    }
    manager._validate_cached_download(cache, path, source, region_id, start, end)
    path.write_bytes(firms_csv([sample_row(satellite="UNKNOWN")]))
    cache["checksum"] = sha256_file(path)
    cache["satellite"] = "UNKNOWN"
    with pytest.raises(RawCsvConflictError, match="source product"):
        manager._validate_cached_download(cache, path, source, region_id, start, end)


def _recovery_fixture(tmp_path, *, create_raw=True, checksum_override=None):
    region_store = RegionStore()
    region = RegionDefinitionSchema(
        id="recovery-region", name="Synthetic recovery region", country="Test",
        boundingBox={"minLatitude": 20, "maxLatitude": 40, "minLongitude": -130, "maxLongitude": -100},
        boundaryNote="Synthetic test region; not used as research data.",
    )
    region_store.upsert(region)
    registry = DatasetRegistry(str(tmp_path))
    def forbid_network(*args, **kwargs):
        raise AssertionError("recovery must never contact NASA")

    manager = build_manager(tmp_path, registry=registry, regions=region_store,
                            http_get=forbid_network, http_stream=forbid_network)
    dataset_id = "fir-existing-snpp-dataset"
    source = "VIIRS_SNPP_SP"
    start, end = "2024-02-01", "2024-02-01"
    filename = f"{start}_{end}.csv"
    raw_path = manager.raw_root / region.id / source / "2024" / filename
    raw_path.parent.mkdir(parents=True)
    raw_bytes = firms_csv([sample_row(satellite="N"), sample_row(satellite="N")])
    if create_raw:
        raw_path.write_bytes(raw_bytes)
    checksum = checksum_override or hashlib.sha256(raw_bytes).hexdigest()

    dataset_dir = manager.data_dir / dataset_id
    dataset_dir.mkdir(parents=True)
    observations_path = dataset_dir / "observations.jsonl"
    observations_path.write_text("", encoding="utf-8")
    (dataset_dir / "original.csv").write_bytes(b"preserve-existing-archive")
    stale_metadata = DatasetMetadataSchema(
        id=dataset_id, title="Existing failed import", sensor="VIIRS", recordCount=0,
        satellite=None, sourceFilename=filename,
        qualityReport={"totalInputRows": 2, "successfullyParsedRows": 0, "rejectedRows": 2,
                       "rejectionReasons": {"invalid_platform": 2}, "platformDistribution": {}},
        provenance={"source": "NASA FIRMS Area API", "regionId": region.id, "sourceId": source},
    )
    (dataset_dir / "metadata.json").write_text(stale_metadata.model_dump_json(), encoding="utf-8")
    registry.register_persisted(stale_metadata, observations_path)
    with manager._connect() as db:
        db.execute("""INSERT INTO downloads(region_id,source_id,start_date,end_date,file_path,checksum,record_count,
            original_filename,downloaded_at,dataset_id,product_version,satellite,status)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (region.id, source, start, end, str(raw_path.relative_to(manager.data_dir)), checksum, 2,
             filename, "2024-02-02T00:00:00+00:00", dataset_id, "2.0SP", "", "valid_data"))
    return manager, registry, dataset_id, raw_path, raw_bytes, dataset_dir


def test_existing_download_recovery_is_checksum_verified_idempotent_and_preserves_dataset_id(tmp_path):
    manager, registry, dataset_id, raw_path, raw_bytes, dataset_dir = _recovery_fixture(tmp_path)
    first = manager.recover_download(dataset_id)
    assert first["status"] == "recovered" and first["datasetId"] == dataset_id
    assert first["datasetRecordCount"] == 2 and first["downloadRecordCount"] == 2
    assert first["platformDistribution"] == {"Suomi-NPP": 2}
    assert registry.get_dataset(dataset_id).satellite == "Suomi-NPP"
    assert registry.get_dataset(dataset_id).qualityReport["platformDistribution"] == {"Suomi-NPP": 2}
    assert registry.count_query(dataset_ids=[dataset_id]) == 2
    assert raw_path.read_bytes() == raw_bytes
    assert (dataset_dir / "original.csv").read_bytes() == b"preserve-existing-archive"

    second = manager.recover_download(dataset_id)
    assert second["datasetId"] == dataset_id
    assert registry.count_query(dataset_ids=[dataset_id]) == 2
    assert registry.datasets()[0].recordCount == 2
    with manager._connect() as db:
        download = db.execute("SELECT record_count,satellite,status FROM downloads WHERE dataset_id=?", (dataset_id,)).fetchone()
    assert tuple(download) == (2, "Suomi-NPP", "valid_data")


@pytest.mark.parametrize(("create_raw", "checksum_override", "expected_code"), [
    (False, None, "RECOVERY_FILE_MISSING"),
    (True, "0" * 64, "RECOVERY_SOURCE_MISMATCH"),
])
def test_recovery_refuses_missing_or_checksum_mismatched_source(tmp_path, create_raw, checksum_override, expected_code):
    manager, registry, dataset_id, raw_path, raw_bytes, _dataset_dir = _recovery_fixture(
        tmp_path, create_raw=create_raw, checksum_override=checksum_override)
    with pytest.raises(AcquisitionRecoveryError) as error:
        manager.recover_download(dataset_id)
    assert error.value.code == expected_code
    assert registry.get_dataset(dataset_id).recordCount == 0
    assert registry.count_query(dataset_ids=[dataset_id]) == 0
    if create_raw:
        assert raw_path.read_bytes() == raw_bytes


def test_recovery_requires_dedicated_secret_and_does_not_leak_it(tmp_path, monkeypatch):
    import app.main as main_module
    from app.main import recover_acquisition_dataset
    from app.config import Settings

    assert "recovery-test-secret" not in repr(Settings(FIRENEXUS_RECOVERY_SECRET="recovery-test-secret"))

    monkeypatch.setattr(main_module, "settings", SimpleNamespace(FIRENEXUS_RECOVERY_SECRET=""))
    with pytest.raises(HTTPException) as unconfigured:
        recover_acquisition_dataset("dataset-1", "anything", object())
    assert unconfigured.value.status_code == 503

    monkeypatch.setattr(main_module, "settings", SimpleNamespace(FIRENEXUS_RECOVERY_SECRET="recovery-test-secret"))
    calls = []
    manager = type("Manager", (), {"recover_download": lambda self, dataset_id: calls.append(dataset_id) or {"status": "recovered"}})()
    with pytest.raises(HTTPException) as error:
        recover_acquisition_dataset("dataset-1", "wrong-secret", manager)
    assert error.value.status_code == 403
    assert "recovery-test-secret" not in str(error.value.detail)
    assert calls == []
    assert recover_acquisition_dataset("dataset-1", "recovery-test-secret", manager) == {"status": "recovered"}
    assert calls == ["dataset-1"]


def test_worker_accepts_psycopg_decoded_jsonb_request_object_without_json_loads(tmp_path):
    from threading import RLock

    request_payload = {
        "regionId": "synthetic-region",
        "sourceId": "VIIRS_NOAA21_SP",
        "nested": {"dateRange": ["2024-02-01", "2024-02-28"]},
    }
    manager = object.__new__(AcquisitionManager)
    manager._lock = RLock()
    manager._active = set()
    manager._raw_job = lambda job_id: {"id": job_id, "request_json": request_payload}
    manager.region_store = type("Regions", (), {"get": lambda self, region_id: {"id": region_id}})()
    statuses = []
    manager._set_job = lambda job_id, status, error=None: statuses.append((job_id, status, error))
    manager._finish_job = lambda job_id: statuses.append((job_id, "completed", None))

    class EmptyRows:
        def fetchall(self): return []

    class EmptyDatabase:
        def execute(self, query, params=()): return EmptyRows()

    @contextmanager
    def connection():
        yield EmptyDatabase()

    manager._connect = connection
    manager._run_job("synthetic-job")
    assert statuses == [
        ("synthetic-job", "running", None),
        ("synthetic-job", "completed", None),
    ]
    assert manager._active == set()


def test_sqlite_job_creation_and_failure_metadata_remain_supported(tmp_path):
    regions = RegionStore(str(tmp_path))
    manager = build_manager(tmp_path, regions=regions)
    verified_manifest(manager, start="2024-01-17", end="2024-01-17")
    job = manager.create_job(AcquisitionStartRequest(
        regionId=regions.list()[0].id, product="VIIRS_NOAA21_SP",
        startDate="2024-01-17", endDate="2024-01-17"))
    stored = manager._raw_job(job["id"])
    assert isinstance(stored["request_json"], str)
    manager._set_job(job["id"], "failed", "synthetic JSONB decoding failure")
    failed = manager.get_job(job["id"])
    assert failed["status"] == "failed"
    assert failed["message"] == "synthetic JSONB decoding failure"


@pytest.mark.parametrize(("value", "expected"), [
    (date(2024, 2, 3), "2024-02-03"),
    (datetime(2024, 2, 3, 22, 15, tzinfo=timezone.utc), "2024-02-03"),
    ("2024-02-03", "2024-02-03"),
    ("2024-02-03T22:15:00+00:00", "2024-02-03"),
])
def test_chunk_date_normalization_accepts_postgres_values_and_sqlite_strings(value, expected):
    normalized = AcquisitionManager._normalize_chunk_dates({"start_date": value, "end_date": value})
    assert normalized["start_date"] == expected
    assert normalized["end_date"] == expected


def test_chunk_date_normalization_preserves_timezone_aware_timestamps():
    downloaded_at = datetime(2024, 2, 3, 22, 15, tzinfo=timezone.utc)
    normalized = AcquisitionManager._normalize_chunk_dates({
        "start_date": date(2024, 2, 3), "end_date": "2024-02-03",
        "downloaded_at": downloaded_at,
    })
    assert normalized["downloaded_at"] is downloaded_at
    assert normalized["downloaded_at"].isoformat() == "2024-02-03T22:15:00+00:00"


def test_worker_uses_normalized_postgres_dates_for_chunk_paths(tmp_path):
    from threading import RLock

    start = date(2024, 2, 1)
    end = datetime(2024, 2, 5, 8, 30, tzinfo=timezone.utc)
    chunk = {"job_id": "synthetic-job", "start_date": start, "end_date": end,
             "status": "pending", "attempts": 0}

    class Rows:
        def fetchall(self): return [chunk]

    class Database:
        def execute(self, query, params=()): return Rows()

    @contextmanager
    def connection():
        yield Database()

    manager = object.__new__(AcquisitionManager)
    manager._lock = RLock()
    manager._active = set()
    manager.data_dir = tmp_path
    manager.raw_root = tmp_path / "raw"
    manager._raw_job = lambda job_id: {
        "id": job_id,
        "request_json": {"regionId": "synthetic-region", "sourceId": "VIIRS_NOAA21_SP"},
    }
    manager.region_store = type("Regions", (), {"get": lambda self, region_id: object()})()
    manager._connect = connection
    manager._set_job = lambda *args, **kwargs: None
    manager._pause_requested = lambda job_id: False
    manager._get_cached_download = lambda *args: None
    manager._update_chunk = lambda *args, **kwargs: None
    manager._now = lambda: "2024-02-06T00:00:00+00:00"
    manager._import_download = lambda *args: None
    manager._finish_job = lambda *args: None
    fetched = {}

    def fetch(region, source, chunk_start, chunk_end, target):
        fetched.update(source=source, start=chunk_start, end=chunk_end, target=target)
        return "a" * 64, 0, None, "NOAA-21"

    manager._fetch_to_file = fetch
    manager._run_job("synthetic-job")

    assert fetched["start"] == start
    assert fetched["end"] == end.date()
    assert fetched["target"].parent == tmp_path / "raw" / "synthetic-region" / "VIIRS_NOAA21_SP" / "2024"
