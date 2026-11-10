"""Resumable, provenance-preserving NASA FIRMS standard-processing acquisition."""
import csv
import hashlib
import httpx
import json
import os
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional

from app.models.schemas import AcquisitionJobSchema, AcquisitionStartRequest, DatasetMetadataSchema, FireObservationSchema, RegionDefinitionSchema
from app.services.ingestion import PLATFORMS, ingest_csv
from app.services.validation import REQUIRED_COLUMNS
from app.services.database import acquisition_connection

FIRMS_API = "https://firms.modaps.eosdis.nasa.gov/api"
PRODUCTS: Dict[str, Dict[str, Any]] = {
    "MODIS_SP": {"sensor": "MODIS", "platforms": ["Terra", "Aqua"], "label": "MODIS Standard Processing"},
    "VIIRS_SNPP_SP": {"sensor": "VIIRS", "platforms": ["Suomi-NPP"], "label": "VIIRS Suomi-NPP Standard Processing, 375 m"},
    "VIIRS_NOAA20_SP": {"sensor": "VIIRS", "platforms": ["NOAA-20"], "label": "VIIRS NOAA-20 Standard Processing, 375 m"},
    "VIIRS_NOAA21_SP": {"sensor": "VIIRS", "platforms": ["NOAA-21"], "label": "VIIRS NOAA-21 Standard Processing, 375 m"},
}
UNAVAILABLE_PREFIX = "unavailable_product_coverage"


def _canonical_platform(sensor: str, satellite: str) -> Optional[str]:
    key = (satellite or "").strip().upper().replace("_", "-")
    return PLATFORMS.get(sensor, {}).get(key) or PLATFORMS.get(sensor, {}).get(key.replace("-", ""))


class RawCsvConflictError(RuntimeError):
    """An existing raw file cannot be proven to match its download manifest."""


class AcquisitionRecoveryError(RuntimeError):
    """Safe, user-facing error raised by explicit existing-file recovery."""

    def __init__(self, code: str, message: str, status_code: int = 409):
        self.code = code
        self.status_code = status_code
        super().__init__(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _days(start: date, end: date) -> Iterable[tuple[date, date]]:
    cursor = start
    while cursor <= end:
        year_end = date(cursor.year, 12, 31)
        chunk_end = min(end, year_end, cursor + timedelta(days=4))
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def plan_chunks(start: date, end: date, min_available: date, max_available: date) -> list[dict[str, str]]:
    """Split requests to <=5 days, year boundaries, and explicit coverage gaps."""
    chunks: list[dict[str, str]] = []
    if start < min_available:
        gap_end = min(end, min_available - timedelta(days=1))
        chunks.append({"startDate": start.isoformat(), "endDate": gap_end.isoformat(), "status": "unavailable_product_coverage"})
    active_start, active_end = max(start, min_available), min(end, max_available)
    if active_start <= active_end:
        chunks.extend({"startDate": a.isoformat(), "endDate": b.isoformat(), "status": "pending"} for a, b in _days(active_start, active_end))
    if end > max_available:
        gap_start = max(start, max_available + timedelta(days=1))
        chunks.append({"startDate": gap_start.isoformat(), "endDate": end.isoformat(), "status": "not_yet_available"})
    return chunks


def _ring_contains(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    for i in range(len(ring) - 1):
        x1, y1 = float(ring[i][0]), float(ring[i][1])
        x2, y2 = float(ring[i + 1][0]), float(ring[i + 1][1])
        if ((y1 > lat) != (y2 > lat)) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def point_in_geometry(lon: float, lat: float, geometry: Optional[dict]) -> bool:
    """GeoJSON Polygon/MultiPolygon containment, including holes."""
    if not geometry:
        return True
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        if polygon and _ring_contains(lon, lat, polygon[0]) and not any(_ring_contains(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


class AcquisitionManager:
    def __init__(self, data_dir: str | Path, map_key: str, registry, region_store,
                 requests_per_minute: int = 6, max_retries: int = 4, retry_base_seconds: float = 1.0,
                 http_get: Optional[Callable] = None, http_stream: Optional[Callable] = None,
                 start_workers: bool = True, database_url: str = "", ssl_ca: str = ""):
        self.data_dir = Path(data_dir).resolve()
        self.root = self.data_dir / "firms_acquisition"
        self.raw_root = self.root / "raw"
        self.root.mkdir(parents=True, exist_ok=True)
        self.raw_root.mkdir(parents=True, exist_ok=True)
        self.map_key = map_key.strip()
        self.registry = registry
        self.region_store = region_store
        self.requests_per_minute = max(1, min(int(requests_per_minute), 30))
        self.max_retries = max(0, int(max_retries))
        self.retry_base_seconds = max(0.0, float(retry_base_seconds))
        self.http_get = http_get or httpx.get
        self.http_stream = http_stream or httpx.stream
        self.start_workers = start_workers
        self.database_url = database_url
        self.ssl_ca = ssl_ca
        self._lock = threading.RLock()
        self._request_lock = threading.Lock()
        self._active: set[str] = set()
        self._last_request = 0.0
        self.db_path = self.root / "acquisition.sqlite3"
        self.availability_path = self.root / "availability_manifest.json"
        self._init_db()

    def _connect(self):
        if self.database_url:
            return acquisition_connection(self.database_url, self.ssl_ca)
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        if self.database_url:
            with self._connect() as db:
                required = db.execute("SELECT to_regclass('public.acquisition_jobs') AS name").fetchone()["name"]
                if not required:
                    raise RuntimeError("FIRENEXUS PostgreSQL schema is missing; run `python -m app.migrations upgrade` first")
                # Interrupted network work remains resumable after a process restart.
                db.execute("UPDATE acquisition_chunks SET status='pending', error='Interrupted by backend restart' WHERE status='downloading'")
                db.execute("UPDATE acquisition_jobs SET status='interrupted', pause_requested=FALSE, updated_at=%s WHERE status IN ('queued','running','pausing')", (self._now(),))
            if not self.availability_path.exists():
                self._write_availability({"status": "not_checked", "checkedAt": None, "sources": self._unverified_sources(),
                                          "message": "Availability has not been checked against NASA FIRMS."})
            return
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, request_json TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT, pause_requested INTEGER NOT NULL DEFAULT 0)""")
            db.execute("""CREATE TABLE IF NOT EXISTS chunks (
                job_id TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0, file_path TEXT, checksum TEXT, record_count INTEGER,
                original_filename TEXT, downloaded_at TEXT, dataset_id TEXT, product_version TEXT, satellite TEXT, error TEXT,
                PRIMARY KEY(job_id, start_date, end_date))""")
            db.execute("""CREATE TABLE IF NOT EXISTS downloads (
                region_id TEXT NOT NULL, source_id TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
                file_path TEXT NOT NULL, checksum TEXT NOT NULL, record_count INTEGER NOT NULL,
                original_filename TEXT NOT NULL, downloaded_at TEXT NOT NULL, dataset_id TEXT,
                product_version TEXT, satellite TEXT, status TEXT NOT NULL,
                UNIQUE(region_id, source_id, start_date, end_date))""")
            for table in ("chunks", "downloads"):
                columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
                if "satellite" not in columns:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN satellite TEXT")
            db.execute("CREATE INDEX IF NOT EXISTS idx_chunks_job_status ON chunks(job_id,status)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_downloads_region_source ON downloads(region_id,source_id)")
            # A process restart converts unfinished work to resumable, persisted state.
            db.execute("UPDATE chunks SET status='pending', error='Interrupted by backend restart' WHERE status='downloading'")
            db.execute("UPDATE jobs SET status='interrupted', pause_requested=0, updated_at=? WHERE status IN ('queued','running','pausing')", (self._now(),))
        if not self.availability_path.exists():
            self._write_availability({"status": "not_checked", "checkedAt": None, "sources": self._unverified_sources(),
                                      "message": "Availability has not been checked against NASA FIRMS."})

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _unverified_sources() -> list[dict]:
        return [{"sourceId": source, "label": value["label"], "sensor": value["sensor"],
                 "platforms": value["platforms"], "minDate": None, "maxDate": None,
                 "status": "unverified"} for source, value in PRODUCTS.items()]

    def _write_availability(self, value: dict):
        tmp = self.availability_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value, indent=2), encoding="utf-8")
        os.replace(tmp, self.availability_path)

    def availability(self, refresh: bool = False) -> dict:
        if not self.map_key:
            if self.availability_path.exists():
                stored = json.loads(self.availability_path.read_text(encoding="utf-8"))
            else:
                stored = {"checkedAt": None, "sources": self._unverified_sources()}
            stored["status"] = "configuration_required"
            stored["message"] = "Set backend FIRMS_MAP_KEY to query NASA FIRMS and start acquisition. No new dates are assumed."
            return stored
        if not refresh and self.availability_path.exists():
            stored = json.loads(self.availability_path.read_text(encoding="utf-8"))
            if stored.get("status") == "verified":
                return stored
        if refresh and self.availability_path.exists() and self.map_key:
            cached = json.loads(self.availability_path.read_text(encoding="utf-8"))
            checked_at = cached.get("checkedAt")
            if cached.get("status") == "verified" and checked_at:
                try:
                    last_checked = datetime.fromisoformat(checked_at)
                    if (datetime.now(timezone.utc) - last_checked).total_seconds() < 60:
                        return cached
                except ValueError:
                    pass
        if not self.map_key:
            value = {"status": "configuration_required", "checkedAt": None, "sources": self._unverified_sources(),
                     "message": "Set backend FIRMS_MAP_KEY to query NASA FIRMS availability. No dates are assumed."}
            self._write_availability(value)
            return value
        url = f"{FIRMS_API}/data_availability/csv/{self.map_key}/ALL"
        try:
            response = self.http_get(url, timeout=30)
            response.raise_for_status()
            reader = csv.DictReader(response.text.splitlines())
            rows = {row.get("data_id", "").strip(): row for row in reader}
            sources = []
            for source, product in PRODUCTS.items():
                row = rows.get(source)
                sources.append({"sourceId": source, "label": product["label"], "sensor": product["sensor"],
                                "platforms": product["platforms"],
                                "minDate": row.get("min_date") if row else None,
                                "maxDate": row.get("max_date") if row else None,
                                "status": "available" if row and row.get("min_date") and row.get("max_date") else "unavailable"})
            if not any(s["status"] == "available" for s in sources):
                raise ValueError("NASA data_availability response did not contain required standard-processing sources")
            value = {"status": "verified", "checkedAt": self._now(), "sources": sources,
                     "message": "Availability dates returned by NASA FIRMS data_availability."}
            self._write_availability(value)
            return value
        except Exception as exc:
            value = {"status": "error", "checkedAt": self._now(), "sources": self._unverified_sources(),
                     "message": f"NASA availability query failed: {type(exc).__name__}. Dates remain unverified."}
            self._write_availability(value)
            return value

    def _source_availability(self, source: str) -> dict:
        manifest = self.availability(refresh=False)
        if manifest["status"] != "verified":
            raise ValueError("NASA product availability has not been verified; refresh availability first.")
        return next((row for row in manifest["sources"] if row["sourceId"] == source), {})

    def create_job(self, request: AcquisitionStartRequest) -> dict:
        region = self.region_store.get(request.regionId)
        if region is None:
            raise KeyError("Region was not found")
        source = request.product
        coverage = self._source_availability(source)
        latest_available = date.fromisoformat(coverage["maxDate"]) if coverage.get("maxDate") else None
        if latest_available and request.endDate > latest_available:
            raise ValueError(f"endDate must not exceed the latest NASA FIRMS SP date verified for {source}: {latest_available.isoformat()}")
        if coverage.get("status") == "available" and coverage.get("minDate") and coverage.get("maxDate"):
            planned = plan_chunks(request.startDate, request.endDate, date.fromisoformat(coverage["minDate"]), date.fromisoformat(coverage["maxDate"]))
        else:
            planned = [{"startDate": request.startDate.isoformat(), "endDate": request.endDate.isoformat(),
                        "status": "unavailable_product_coverage"}]
        job_id = f"acq-{uuid.uuid4().hex}"
        now = self._now()
        payload = {**request.model_dump(mode="json"), "sourceId": source,
                   "boundaryMode": "polygon" if region.boundaryGeometry else "bbox_only",
                   "boundaryNote": region.boundaryNote or ("No polygon configured; this acquisition uses the bounding box only." if not region.boundaryGeometry else "Exact GeoJSON ROI polygon applied after area query.")}
        request_json = payload if self.database_url else json.dumps(payload)
        with self._connect() as db:
            db.execute("INSERT INTO jobs(id,request_json,status,created_at,updated_at) VALUES (?,?,?,?,?)",
                       (job_id, request_json, "queued", now, now))
            for item in planned:
                db.execute("INSERT INTO chunks(job_id,start_date,end_date,status,error) VALUES (?,?,?,?,?)",
                           (job_id, item["startDate"], item["endDate"], item["status"], None if item["status"] == "pending" else "Outside currently available standard-processing coverage"))
        if self.start_workers:
            threading.Thread(target=self._run_job, args=(job_id,), daemon=True, name=f"firms-{job_id}").start()
        return self.get_job(job_id)

    def _budget_check(self, request_days: int):
        # FIRMS documents a 5,000 transaction / 10-minute key limit. Fail closed
        # if live usage cannot be inspected, and leave room for shared-key use.
        response = self.http_get(f"https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY={self.map_key}", timeout=15)
        response.raise_for_status()
        status = response.json()
        limit = int(status.get("transaction_limit", 5000))
        used = int(status.get("current_transactions", 0))
        if used + request_days + 10 >= limit:
            raise RuntimeError("NASA FIRMS MAP_KEY transaction budget is near its limit; acquisition paused safely.")
        spacing = 60 / self.requests_per_minute
        wait = spacing - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)

    def _fetch_to_file(self, region: RegionDefinitionSchema, source: str, start: date, end: date, target: Path) -> tuple[str, int, Optional[str], str]:
        if target.exists():
            raise RawCsvConflictError(f"Raw CSV already exists at {target.name}; it was preserved.")
        box = region.boundingBox
        area = f"{box.minLongitude},{box.minLatitude},{box.maxLongitude},{box.maxLatitude}"
        days = (end - start).days + 1
        url = f"{FIRMS_API}/area/csv/{self.map_key}/{source}/{area}/{days}/{start.isoformat()}"
        last_error = "download failed"
        for attempt in range(self.max_retries + 1):
            temp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.part")
            try:
                with self._request_lock:
                    self._budget_check(days)
                    written = 0
                    digest = hashlib.sha256()
                    try:
                        with self.http_stream("GET", url, timeout=120) as response:
                            response.raise_for_status()
                            expected_length = response.headers.get("content-length")
                            with temp.open("xb") as out:
                                for block in response.iter_bytes(1024 * 1024):
                                    if block:
                                        out.write(block)
                                        digest.update(block)
                                        written += len(block)
                    finally:
                        self._last_request = time.monotonic()
                if written == 0 or (expected_length and written != int(expected_length)):
                    raise IOError("Download byte count did not match the HTTP response")
                record_count, versions, satellites = self._validate_firms_csv(temp, PRODUCTS[source]["sensor"])
                normalized_satellites = {_canonical_platform(PRODUCTS[source]["sensor"], value) for value in satellites}
                allowed_platforms = set(PRODUCTS[source]["platforms"])
                if record_count and (not normalized_satellites or normalized_satellites - allowed_platforms or None in normalized_satellites):
                    raise ValueError("NASA CSV satellite values do not match the requested source product")
                # Exclusive creation fails if another worker created the target;
                # unlike os.replace, it can never clobber an existing raw CSV.
                with temp.open("rb") as source_stream, target.open("xb") as output_stream:
                    while block := source_stream.read(1024 * 1024):
                        output_stream.write(block)
                    output_stream.flush()
                    os.fsync(output_stream.fileno())
                temp.unlink()
                return digest.hexdigest(), record_count, ",".join(sorted(versions)) or None, ",".join(sorted(satellites))
            except Exception as exc:
                temp.unlink(missing_ok=True)
                if isinstance(exc, FileExistsError):
                    raise RawCsvConflictError(f"Raw CSV appeared at {target.name} during download; it was preserved.") from None
                if isinstance(exc, RawCsvConflictError):
                    raise
                if isinstance(exc, httpx.HTTPStatusError):
                    last_error = f"NASA FIRMS returned HTTP {exc.response.status_code}"
                elif isinstance(exc, httpx.RequestError):
                    last_error = f"NASA FIRMS request failed: {type(exc).__name__}"
                else:
                    last_error = str(exc)[:500]
                if isinstance(exc, httpx.HTTPStatusError):
                    retryable = exc.response.status_code in (429, 500, 502, 503, 504)
                else:
                    retryable = isinstance(exc, (httpx.TimeoutException, httpx.TransportError, OSError))
                if not retryable or attempt >= self.max_retries:
                    break
                time.sleep(self.retry_base_seconds * (2 ** attempt))
        raise RuntimeError(last_error)

    @staticmethod
    def _validate_firms_csv(path: Path, sensor: str) -> tuple[int, set[str], set[str]]:
        required = set(REQUIRED_COLUMNS[sensor])
        versions: set[str] = set()
        satellites: set[str] = set()
        count = 0
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, strict=True)
            headers = {str(header).strip().lower() for header in (reader.fieldnames or [])}
            if not required.issubset(headers):
                raise ValueError("NASA response did not contain the expected FIRMS CSV fields")
            for row in reader:
                if None in row:
                    raise ValueError("NASA response contains malformed CSV rows")
                count += 1
                if row.get("version"):
                    versions.add(row["version"].strip())
                if row.get("satellite"):
                    satellites.add(row["satellite"].strip())
        return count, versions, satellites

    def _get_cached_download(self, region_id: str, source: str, start: str, end: str):
        with self._connect() as db:
            return db.execute("SELECT * FROM downloads WHERE region_id=? AND source_id=? AND start_date=? AND end_date=?",
                              (region_id, source, start, end)).fetchone()

    def _validate_cached_download(self, cache, path: Path, source: str, region_id: str,
                                  start: str, end: str, *, allow_missing_manifest_platform: bool = False) -> None:
        expected_dir = (self.raw_root / region_id / source / start[:4]).resolve()
        resolved_path = path.resolve()
        if resolved_path.parent != expected_dir:
            raise RawCsvConflictError("Download metadata points outside the expected region/source/year folder.")
        if not path.is_file():
            raise RawCsvConflictError("The download metadata file is missing from disk.")
        if not cache:
            raise RawCsvConflictError("An unregistered raw CSV already exists; its contents were preserved.")
        checksum = cache["checksum"] or ""
        if len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum.lower()):
            raise RawCsvConflictError("The download manifest has no valid SHA-256 checksum.")
        if sha256_file(path) != checksum.lower():
            raise RawCsvConflictError("The raw CSV checksum does not match its download manifest.")
        try:
            count, versions, satellites = self._validate_firms_csv(path, PRODUCTS[source]["sensor"])
        except Exception as exc:
            raise RawCsvConflictError(f"The existing raw CSV failed FIRMS validation ({type(exc).__name__}).") from None
        version = ",".join(sorted(versions)) or None
        if count != int(cache["record_count"] or 0):
            raise RawCsvConflictError("The CSV row count does not match its download manifest.")
        expected_status = "valid_data" if count else "zero_detections"
        if cache["status"] != expected_status:
            raise RawCsvConflictError("The manifest status does not match the CSV row count.")
        if cache["product_version"] != version:
            raise RawCsvConflictError("The CSV product version does not match its download manifest.")
        if not cache["downloaded_at"] or cache["original_filename"] != path.name:
            raise RawCsvConflictError("The filename or import timestamp does not match its download manifest.")
        sensor = PRODUCTS[source]["sensor"]

        raw_platforms = {_canonical_platform(sensor, platform) for platform in satellites}
        manifest_tokens = [platform for platform in (cache["satellite"] or "").split(",") if platform.strip()]
        manifest_platforms = {_canonical_platform(sensor, platform) for platform in manifest_tokens}
        allowed = set(PRODUCTS[source]["platforms"])
        manifest_mismatch = bool(count and ((manifest_tokens and raw_platforms != manifest_platforms)
                                             or (not manifest_tokens and not allow_missing_manifest_platform)))
        if raw_platforms - allowed or manifest_platforms - allowed or manifest_mismatch:
            raise RawCsvConflictError("The CSV satellite values do not match the download manifest or source product.")

    def _prepare_download_import(self, path: Path, region: RegionDefinitionSchema, source: str,
                                 raw_count: int, version: Optional[str], data_dir: Optional[Path] = None):
        from app.services.ingestion import safe_source_filename
        output_dir = Path(data_dir or self.data_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        stage_root = output_dir / ".acquisition-stage"
        stage_root.mkdir(parents=True, exist_ok=True)
        filtered_path = path
        temp_dir = None
        try:
            if region.boundaryGeometry:
                temp_dir = tempfile.TemporaryDirectory(prefix="roi-", dir=stage_root)
                filtered_path = Path(temp_dir.name) / path.name
                with path.open("r", encoding="utf-8-sig", newline="") as source_stream, filtered_path.open("w", encoding="utf-8", newline="") as output:
                    reader = csv.DictReader(source_stream)
                    writer = csv.DictWriter(output, fieldnames=reader.fieldnames)
                    writer.writeheader()
                    for row in reader:
                        try:
                            lon, lat = float(row["longitude"]), float(row["latitude"])
                        except (TypeError, ValueError, KeyError):
                            continue
                        if point_in_geometry(lon, lat, region.boundaryGeometry):
                            writer.writerow(row)
            metadata, obs_path = ingest_csv(filtered_path, output_dir, PRODUCTS[source]["sensor"], safe_source_filename(path.name), max(path.stat().st_size, 1))
            metadata.title = f"{region.name} · {PRODUCTS[source]['label']} · {path.stem}"
            metadata.attributes.update({"acquisitionProduct": source, "acquisitionRegionId": region.id,
                                        "roiFilter": "GeoJSON polygon" if region.boundaryGeometry else "Bounding box only; approximate ROI"})
            checksum = sha256_file(path)
            metadata.provenance.update({"source": "NASA FIRMS Area API", "sourceId": source, "regionId": region.id,
                                        "rawFile": str(path.relative_to(self.root)), "checksumSha256": checksum,
                                        "sourcePath": str(path.resolve()), "sourceSha256": checksum,
                                        "productVersion": version or "not present in response"})
            metadata.qualityReport["acquisition"] = {"recordsBeforeRoiFilter": raw_count,
                "boundaryMode": "polygon" if region.boundaryGeometry else "bbox_only",
                "boundaryNote": region.boundaryNote or "No authoritative polygon configured; bbox-only filtering.",
                "recordsAfterRoiFilter": metadata.recordCount}
            (obs_path.parent / "metadata.json").write_text(metadata.model_dump_json(indent=2), encoding="utf-8")
            return metadata, obs_path
        finally:
            if temp_dir:
                temp_dir.cleanup()

    def _import_download(self, path: Path, region: RegionDefinitionSchema, source: str,
                         raw_count: int, version: Optional[str]) -> Optional[str]:
        metadata, observations_path = self._prepare_download_import(path, region, source, raw_count, version)
        self.registry.register_persisted(metadata, observations_path)
        return metadata.id

    def _rewrite_observation_ids(self, observations_path: Path, dataset_id: str) -> None:
        """Retain deterministic source-row suffixes while recovering a dataset ID."""
        rewritten = observations_path.with_name(f".observations-recovery-{uuid.uuid4().hex}.tmp")
        try:
            with observations_path.open("r", encoding="utf-8") as source, rewritten.open("w", encoding="utf-8") as output:
                for line in source:
                    if not line.strip():
                        continue
                    observation = FireObservationSchema.model_validate_json(line)
                    row_number = observation.id.rsplit(":", 1)[-1]
                    observation.id = f"{dataset_id}:{row_number}"
                    output.write(observation.model_dump_json() + "\n")
            os.replace(rewritten, observations_path)
        finally:
            rewritten.unlink(missing_ok=True)

    def _persist_recovery_artifacts(self, metadata: DatasetMetadataSchema, observations_path: Path) -> Path:
        """Persist derived files without touching original.csv or any raw download."""
        dataset_dir = self.data_dir / metadata.id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        targets = {
            "observations.jsonl": observations_path,
            "metadata.json": None,
            "validation_report.json": None,
        }
        metadata_text = metadata.model_dump_json(indent=2)
        report_text = json.dumps(metadata.qualityReport, indent=2)
        final_observations = dataset_dir / "observations.jsonl"
        for name, source_path in targets.items():
            target = dataset_dir / name
            temp = dataset_dir / f".{name}.{uuid.uuid4().hex}.tmp"
            try:
                if source_path is not None:
                    with source_path.open("rb") as source, temp.open("xb") as output:
                        while block := source.read(1024 * 1024):
                            output.write(block)
                else:
                    temp.write_text(metadata_text if name == "metadata.json" else report_text, encoding="utf-8")
                os.replace(temp, target)
            finally:
                temp.unlink(missing_ok=True)
        return final_observations

    def recover_download(self, dataset_id: str) -> dict:
        """Rebuild one registered dataset from its verified raw CSV; never contacts NASA."""
        recovery_id = f"recovery:{dataset_id}"
        with self._lock:
            if recovery_id in self._active:
                raise AcquisitionRecoveryError("RECOVERY_IN_PROGRESS", "Recovery for this dataset is already running.")
            self._active.add(recovery_id)
        try:
            return self._recover_download(dataset_id)
        finally:
            with self._lock:
                self._active.discard(recovery_id)

    def _recover_download(self, dataset_id: str) -> dict:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM downloads WHERE dataset_id=?", (dataset_id,)).fetchall()
        if len(rows) != 1:
            raise AcquisitionRecoveryError(
                "RECOVERY_SOURCE_NOT_UNIQUE", "Dataset must reference exactly one acquisition download.", 404 if not rows else 409)
        cache = dict(rows[0])
        cache.update(self._normalize_chunk_dates(cache))
        source = cache.get("source_id")
        if source not in PRODUCTS:
            raise AcquisitionRecoveryError("RECOVERY_SOURCE_INVALID", "The recorded acquisition source is unsupported.")
        relative_file = cache.get("file_path") or ""
        path = (self.data_dir / relative_file).resolve()
        try:
            path.relative_to(self.raw_root.resolve())
        except ValueError:
            raise AcquisitionRecoveryError("RECOVERY_PATH_INVALID", "The recorded source path is outside raw acquisition storage.") from None
        if not path.is_file():
            raise AcquisitionRecoveryError("RECOVERY_FILE_MISSING", "The recorded raw CSV is missing; no recovery was performed.")
        region_id = cache.get("region_id")
        region = self.region_store.get(region_id)
        if region is None:
            raise AcquisitionRecoveryError("RECOVERY_REGION_MISSING", "The acquisition region is unavailable.")
        try:
            self._validate_cached_download(cache, path, source, region_id,
                                           cache["start_date"], cache["end_date"],
                                           allow_missing_manifest_platform=True)
        except RawCsvConflictError as exc:
            raise AcquisitionRecoveryError("RECOVERY_SOURCE_MISMATCH", str(exc)) from None

        current = self.registry.get_dataset(dataset_id)
        if current is None:
            raise AcquisitionRecoveryError("RECOVERY_DATASET_MISSING", "The registered dataset metadata is unavailable.", 404)

        scratch_root = self.data_dir / ".recovery-work"
        scratch_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="rebuild-", dir=scratch_root) as scratch:
            metadata, observations_path = self._prepare_download_import(
                path, region, source, int(cache["record_count"] or 0), cache.get("product_version"), Path(scratch))
            metadata.id = dataset_id
            metadata.sourceFilename = cache.get("original_filename") or metadata.sourceFilename
            metadata.provenance = {**current.provenance, **metadata.provenance}
            metadata.provenance["sourcePath"] = str(path)
            metadata.provenance["sourceSha256"] = str(cache["checksum"]).lower()
            metadata.attributes = {**current.attributes, **metadata.attributes}
            self._rewrite_observation_ids(observations_path, dataset_id)
            metadata.qualityReport["recovery"] = {
                "sourceChecksumSha256": str(cache["checksum"]).lower(),
                "recoveredAt": self._now(),
                "recordsReparsed": metadata.recordCount,
            }
            (observations_path.parent / "metadata.json").write_text(metadata.model_dump_json(indent=2), encoding="utf-8")
            distribution = metadata.qualityReport.get("platformDistribution") or {}
            if not metadata.recordCount or not distribution:
                raise AcquisitionRecoveryError("RECOVERY_NO_VALID_OBSERVATIONS", "The validated source produced no usable observations; database records were not changed.")
            satellite = ",".join(sorted(distribution))
            download_status = "valid_data" if int(cache["record_count"] or 0) else "zero_detections"
            if self.registry.postgres:
                # Dataset, observations, quality report, and acquisition bookkeeping commit together.
                with self.registry._pg() as conn:
                    self.registry._index_jsonl_postgres(
                        dataset_id, observations_path, replace=True, connection=conn, meta=metadata)
                    updated = conn.execute("""UPDATE acquisition_downloads SET satellite=%s,status=%s
                        WHERE dataset_id=%s AND region_id=%s AND source_id=%s AND start_date=%s AND end_date=%s""",
                        (satellite, download_status, dataset_id, region_id, source,
                         cache["start_date"], cache["end_date"]))
                    if updated.rowcount != 1:
                        raise AcquisitionRecoveryError("RECOVERY_LEDGER_UPDATE_FAILED", "The acquisition download ledger did not match the verified source.")
                    conn.execute("UPDATE acquisition_chunks SET satellite=%s WHERE dataset_id=%s",
                                 (satellite, dataset_id))
            else:
                self.registry.register_persisted(metadata, observations_path)
                with self._connect() as db:
                    db.execute("UPDATE downloads SET satellite=?,status=? WHERE dataset_id=?",
                               (satellite, download_status, dataset_id))
                    db.execute("UPDATE chunks SET satellite=? WHERE dataset_id=?", (satellite, dataset_id))
            final_observations = self._persist_recovery_artifacts(metadata, observations_path)
            self.registry.register_postgres_persisted(metadata, final_observations)
            return {
                "datasetId": dataset_id,
                "status": "recovered",
                "datasetRecordCount": int(metadata.recordCount or 0),
                "downloadRecordCount": int(cache["record_count"] or 0),
                "platformDistribution": distribution,
                "sourceChecksumSha256": str(cache["checksum"]).lower(),
            }

    def _run_job(self, job_id: str):
        with self._lock:
            if job_id in self._active:
                return
            self._active.add(job_id)
        try:
            job = self._raw_job(job_id)
            if not job:
                return
            payload = self._decode_request_payload(job["request_json"])
            region = self.region_store.get(payload["regionId"])
            source = payload["sourceId"]
            self._set_job(job_id, "running")
            with self._connect() as db:
                chunks = [self._normalize_chunk_dates(row) for row in
                          db.execute("SELECT * FROM chunks WHERE job_id=? ORDER BY start_date", (job_id,)).fetchall()]
            for chunk in chunks:
                if self._pause_requested(job_id):
                    self._set_job(job_id, "paused")
                    return
                if chunk["status"] in ("unavailable_product_coverage", "not_yet_available", "valid_data", "zero_detections"):
                    continue
                start, end = chunk["start_date"], chunk["end_date"]
                cache = self._get_cached_download(payload["regionId"], source, start, end)
                folder = self.raw_root / payload["regionId"] / source / start[:4]
                target = folder / f"{start}_{end}.csv"
                path = self.data_dir / cache["file_path"] if cache and cache["file_path"] else target
                dataset_id = cache["dataset_id"] if cache else None
                cache_valid = False
                if cache and path.is_file():
                    try:
                        self._validate_cached_download(cache, path, source, payload["regionId"], start, end)
                        cache_valid = True
                    except RawCsvConflictError as exc:
                        self._update_chunk(job_id, start, end, status="failed", error=f"Raw CSV conflict: {exc}")
                        continue
                elif target.exists():
                    self._update_chunk(job_id, start, end, status="failed",
                                       error="Raw CSV conflict: an existing file has no matching download manifest; it was preserved.")
                    continue
                else:
                    path = target

                if not cache_valid:
                    folder.mkdir(parents=True, exist_ok=True)
                    filename = path.name
                    self._update_chunk(job_id, start, end, status="downloading", attempts=chunk["attempts"] + 1, error=None)
                    try:
                        checksum, record_count, version, _satellites = self._fetch_to_file(region, source, date.fromisoformat(start), date.fromisoformat(end), path)
                        downloaded_at = self._now()
                        relative = str(path.relative_to(self.data_dir))
                        status = "valid_data" if record_count else "zero_detections"
                        with self._connect() as db:
                            db.execute("""INSERT INTO downloads(region_id,source_id,start_date,end_date,file_path,checksum,record_count,original_filename,downloaded_at,product_version,satellite,status)
                                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                                ON CONFLICT(region_id,source_id,start_date,end_date) DO UPDATE SET
                                file_path=excluded.file_path,checksum=excluded.checksum,record_count=excluded.record_count,
                                original_filename=excluded.original_filename,downloaded_at=excluded.downloaded_at,
                                product_version=excluded.product_version,satellite=excluded.satellite,status=excluded.status""",
                                (region.id, source, start, end, relative, checksum, record_count, filename, downloaded_at, version, _satellites, status))
                        dataset_id = self._import_download(path, region, source, record_count, version)
                        dataset_meta = self.registry.get_dataset(dataset_id) if dataset_id else None
                        distribution = (dataset_meta.qualityReport.get("platformDistribution") or {}) if dataset_meta else {}
                        if distribution:
                            satellite = ",".join(sorted(distribution))
                        else:
                            normalized = {_canonical_platform(PRODUCTS[source]["sensor"], item) for item in (_satellites or "").split(",") if item}
                            satellite = ",".join(sorted(item for item in normalized if item))
                        with self._connect() as db:
                            db.execute("UPDATE downloads SET dataset_id=?,satellite=? WHERE region_id=? AND source_id=? AND start_date=? AND end_date=?",
                                       (dataset_id, satellite, region.id, source, start, end))
                        self._update_chunk(job_id, start, end, status=status, checksum=checksum, file_path=relative,
                                           record_count=record_count, original_filename=filename, downloaded_at=downloaded_at,
                                           dataset_id=dataset_id, product_version=version, satellite=satellite, error=None)
                    except Exception as exc:
                        relative = str(path.relative_to(self.data_dir)) if path else ""
                        error_message = str(exc)[:500]
                        if path and path.exists():
                            current = self._get_cached_download(payload["regionId"], source, start, end)
                            try:
                                self._validate_cached_download(current, path, source, payload["regionId"], start, end)
                            except RawCsvConflictError as conflict:
                                error_message = f"Raw CSV conflict: {conflict}; the existing file was preserved."
                        else:
                            with self._connect() as db:
                                db.execute("""INSERT INTO downloads(region_id,source_id,start_date,end_date,file_path,checksum,record_count,original_filename,downloaded_at,status,satellite)
                                    VALUES(?,?,?,?,?,?,?,?,?,?,?)
                                    ON CONFLICT(region_id,source_id,start_date,end_date) DO UPDATE SET
                                    file_path=excluded.file_path,checksum=excluded.checksum,record_count=excluded.record_count,
                                    original_filename=excluded.original_filename,downloaded_at=excluded.downloaded_at,
                                    product_version=NULL,satellite=NULL,status=excluded.status""", (region.id, source, start, end, relative,
                                    "", 0, path.name if path else f"{start}_{end}.csv", self._now(), "failed", None))
                        self._update_chunk(job_id, start, end, status="failed", error=error_message)
                else:
                    satellite = cache["satellite"]
                    if dataset_id and self.registry.get_dataset(dataset_id) is None:
                        meta_path = self.data_dir / dataset_id / "metadata.json"
                        obs_path = self.data_dir / dataset_id / "observations.jsonl"
                        if meta_path.is_file() and obs_path.is_file():
                            from app.models.schemas import DatasetMetadataSchema
                            self.registry.register_persisted(DatasetMetadataSchema.model_validate_json(meta_path.read_text(encoding="utf-8")), obs_path)
                    if not dataset_id:
                        dataset_id = self._import_download(path, region, source, cache["record_count"], cache["product_version"])
                        dataset_meta = self.registry.get_dataset(dataset_id) if dataset_id else None
                        satellite = ",".join(sorted((dataset_meta.qualityReport.get("platformDistribution") or {}).keys())) if dataset_meta else cache["satellite"]
                        with self._connect() as db:
                            db.execute("UPDATE downloads SET dataset_id=?,status=?,satellite=? WHERE region_id=? AND source_id=? AND start_date=? AND end_date=?",
                                       (dataset_id, "valid_data" if cache["record_count"] else "zero_detections", satellite, region.id, source, start, end))
                    cached_status = "valid_data" if cache["record_count"] else "zero_detections"
                    self._update_chunk(job_id, start, end, status=cached_status, checksum=cache["checksum"],
                                       file_path=cache["file_path"], record_count=cache["record_count"],
                                       original_filename=cache["original_filename"], dataset_id=dataset_id,
                                       product_version=cache["product_version"], satellite=satellite,
                                       downloaded_at=cache["downloaded_at"], error=None)
            self._finish_job(job_id)
        except Exception as exc:
            self._set_job(job_id, "failed", str(exc)[:500])
        finally:
            with self._lock:
                self._active.discard(job_id)

    def _raw_job(self, job_id: str):
        with self._connect() as db:
            return db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()

    def _set_job(self, job_id: str, status: str, error: Optional[str] = None):
        with self._connect() as db:
            db.execute("UPDATE jobs SET status=?, error=?, updated_at=? WHERE id=?", (status, error, self._now(), job_id))

    def _pause_requested(self, job_id: str) -> bool:
        row = self._raw_job(job_id)
        return not row or bool(row["pause_requested"])

    def _update_chunk(self, job_id: str, start: str, end: str, **values):
        if not values:
            return
        columns = ",".join(f"{key}=?" for key in values)
        with self._connect() as db:
            db.execute(f"UPDATE chunks SET {columns} WHERE job_id=? AND start_date=? AND end_date=?",
                       (*values.values(), job_id, start, end))

    def _finish_job(self, job_id: str):
        with self._connect() as db:
            statuses = [row[0] for row in db.execute("SELECT status FROM chunks WHERE job_id=?", (job_id,))]
        if any(status == "failed" for status in statuses):
            status = "partial_failure"
        elif any(status in ("unavailable_product_coverage", "not_yet_available") for status in statuses):
            status = "completed_with_gaps"
        else:
            status = "completed"
        self._set_job(job_id, status)

    def pause(self, job_id: str) -> dict:
        with self._connect() as db:
            row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError("Acquisition job was not found")
            if row["status"] in ("completed", "completed_with_gaps"):
                raise ValueError("Completed acquisitions cannot be paused")
            db.execute("UPDATE jobs SET pause_requested=1,status='pausing',updated_at=? WHERE id=?", (self._now(), job_id))
        if job_id not in self._active:
            self._set_job(job_id, "paused")
        return self.get_job(job_id)

    def resume(self, job_id: str) -> dict:
        with self._connect() as db:
            row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError("Acquisition job was not found")
            if row["status"] in ("completed", "completed_with_gaps"):
                raise ValueError("Completed acquisitions do not need a resume")
            db.execute("UPDATE jobs SET pause_requested=0,status='queued',updated_at=? WHERE id=?", (self._now(), job_id))
            db.execute("UPDATE chunks SET status='pending',error=NULL WHERE job_id=? AND status='failed'", (job_id,))
        if self.start_workers:
            threading.Thread(target=self._run_job, args=(job_id,), daemon=True, name=f"firms-{job_id}").start()
        return self.get_job(job_id)

    def _raw_job_to_response(self, job) -> dict:
        payload = self._decode_request_payload(job["request_json"])
        with self._connect() as db:
            chunks = [self._normalize_chunk_dates(row) for row in
                      db.execute("SELECT * FROM chunks WHERE job_id=? ORDER BY start_date", (job["id"],))]
        completed = sum(row["status"] not in ("pending", "downloading", "failed") for row in chunks)
        records = sum(row["record_count"] or 0 for row in chunks if row["status"] in ("valid_data", "zero_detections"))
        return {"id": job["id"], "regionId": payload["regionId"], "product": payload["product"],
                "startDate": payload["startDate"], "endDate": payload["endDate"], "status": job["status"],
                "completedChunks": completed, "totalChunks": len(chunks), "recordsDownloaded": records,
                "boundaryMode": payload["boundaryMode"], "boundaryNote": payload["boundaryNote"],
                "createdAt": job["created_at"].isoformat() if hasattr(job["created_at"], "isoformat") else job["created_at"],
                "updatedAt": job["updated_at"].isoformat() if hasattr(job["updated_at"], "isoformat") else job["updated_at"],
                "message": job["error"] or "", "chunks": [{"startDate": row["start_date"], "endDate": row["end_date"],
                    "status": row["status"], "attempts": row["attempts"], "recordCount": row["record_count"],
                    "checksum": row["checksum"], "originalFilename": row["original_filename"], "error": row["error"],
                    "datasetId": row["dataset_id"], "productVersion": row["product_version"], "satellite": row["satellite"]} for row in chunks]}

    @staticmethod
    def _decode_request_payload(value) -> dict:
        # psycopg 3 decodes JSONB columns into their native Python values.
        # SQLite stores the same value as JSON text, so accept both backends.
        payload = json.loads(value) if isinstance(value, (str, bytes, bytearray)) else value
        if not isinstance(payload, dict):
            raise ValueError("Stored acquisition request must be a JSON object")
        return payload

    @staticmethod
    def _normalize_chunk_dates(row) -> dict:
        """Normalize PostgreSQL DATE and SQLite ISO strings at the read boundary."""
        normalized = dict(row)
        for field in ("start_date", "end_date"):
            value = normalized[field]
            if isinstance(value, datetime):
                normalized[field] = value.date().isoformat()
            elif isinstance(value, date):
                normalized[field] = value.isoformat()
            elif isinstance(value, str):
                try:
                    parsed = date.fromisoformat(value)
                except ValueError:
                    try:
                        # Be tolerant of timestamp-shaped values while retaining
                        # their written calendar date; chunk columns are DATEs.
                        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).date()
                    except ValueError as exc:
                        raise ValueError(f"Invalid acquisition chunk {field}: expected an ISO date") from exc
                normalized[field] = parsed.isoformat()
            else:
                raise ValueError(f"Invalid acquisition chunk {field}: expected an ISO date")
        return normalized

    def get_job(self, job_id: str) -> dict:
        job = self._raw_job(job_id)
        if not job:
            raise KeyError("Acquisition job was not found")
        return self._raw_job_to_response(job)

    def list_jobs(self) -> list[dict]:
        with self._connect() as db:
            jobs = db.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
        return [self._raw_job_to_response(job) for job in jobs]


def build_manager(settings, registry, region_store) -> AcquisitionManager:
    return AcquisitionManager(settings.DATA_DIR, settings.FIRMS_MAP_KEY, registry, region_store,
                              requests_per_minute=int(getattr(settings, "FIRMS_REQUESTS_PER_MINUTE", 6)),
                              database_url=getattr(settings, "DATABASE_URL", ""),
                              ssl_ca=getattr(settings, "DATABASE_SSL_CA", ""))
