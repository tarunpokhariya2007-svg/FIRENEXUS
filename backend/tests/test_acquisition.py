import csv
import hashlib
from contextlib import contextmanager
from datetime import date

import httpx
import pytest
from pydantic import ValidationError

from app.models.schemas import AcquisitionStartRequest, RegionDefinitionSchema
from app.services.acquisition import AcquisitionManager, plan_chunks, point_in_geometry, sha256_file
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
    assert result["status"] == "completed"
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
    assert done["status"] == "completed"
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
