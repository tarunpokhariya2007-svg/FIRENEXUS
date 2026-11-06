"""Chunked, provenance-preserving ingestion for NASA FIRMS CSV products."""
import csv
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Tuple

from app.models.schemas import DatasetMetadataSchema, FireObservationSchema, MissingValueItem
from app.services.validation import REQUIRED_COLUMNS, validate_columns

PLATFORMS = {
    "MODIS": {"TERRA": "Terra", "T": "Terra", "AQUA": "Aqua", "A": "Aqua"},
    "VIIRS": {
        "SUOMI-NPP": "Suomi-NPP", "SUOMI NPP": "Suomi-NPP", "NPP": "Suomi-NPP", "SNPP": "Suomi-NPP",
        "NOAA-20": "NOAA-20", "NOAA20": "NOAA-20", "J1": "NOAA-20",
        "NOAA-21": "NOAA-21", "NOAA21": "NOAA-21", "J2": "NOAA-21",
    },
}


class UploadRejected(ValueError):
    def __init__(self, message: str, code: str = "INVALID_CSV"):
        self.code = code
        super().__init__(message)


def safe_source_filename(filename: str) -> str:
    # Treat both POSIX and Windows separators as untrusted input; this value is
    # provenance only and is never used to construct a storage path.
    base = filename.replace("\\", "/").split("/")[-1]
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")
    return (base or "upload.csv")[:180]


def _number(value: str) -> float | None:
    if not value.strip():
        return None
    result = float(value.strip())
    if not math.isfinite(result):
        raise ValueError("not a finite number")
    return result


def _date(value: str) -> str:
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError as exc:
        raise ValueError("invalid acq_date") from exc


def _time(value: str) -> str:
    raw = value.strip()
    if not raw.isdigit() or len(raw) > 4:
        raise ValueError("expected HHMM UTC")
    normalized = raw.zfill(4)
    try:
        datetime.strptime(normalized, "%H%M")
    except ValueError as exc:
        raise ValueError("invalid acq_time; expected HHMM UTC") from exc
    return normalized


def _platform(sensor: str, satellite: str) -> str:
    key = satellite.strip().upper().replace("_", "-")
    platform = PLATFORMS[sensor].get(key) or PLATFORMS[sensor].get(key.replace("-", ""))
    if platform is None:
        raise ValueError(f"unsupported {sensor} satellite/platform: {satellite or '(missing)'}")
    return platform


def _why(exc: Exception) -> str:
    message = str(exc)
    if message.startswith("unsupported "):
        return "invalid_platform"
    if "coordinate" in message:
        return "invalid_coordinates"
    if "acq_date" in message or "date" in message:
        return "invalid_acquisition_date"
    if "acq_time" in message or "HHMM" in message or "does not match format" in message:
        return "invalid_acquisition_time"
    if "numeric" in message or "number" in message or "finite" in message:
        return "invalid_numeric_value"
    return "invalid_record"


def _parse_row(sensor: str, row: Dict[str, str], dataset_id: str, row_number: int) -> FireObservationSchema:
    get = lambda key: (row.get(key) or "").strip()
    try:
        try:
            lat = _number(get("latitude"))
            lon = _number(get("longitude"))
        except ValueError as exc:
            raise ValueError("invalid coordinates") from exc
        if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError("invalid coordinates")
        acq_date = _date(get("acq_date"))
        acq_time = _time(get("acq_time"))
        platform = _platform(sensor, get("satellite"))
        brightness_name = "brightness" if sensor == "MODIS" else "bright_ti4"
        confidence_raw = get("confidence")
        confidence = _number(confidence_raw) if sensor == "MODIS" else None
        confidence_class = None if sensor == "MODIS" or not confidence_raw else confidence_raw
        daynight = get("daynight").upper() or None
        if daynight not in (None, "D", "N"):
            raise ValueError("daynight must be D or N")
        brightness = _number(get(brightness_name))
        scan = _number(get("scan"))
        track = _number(get("track"))
        frp = _number(get("frp"))
        thermal = _number(get("bright_t31" if sensor == "MODIS" else "bright_ti5"))
        return FireObservationSchema(
            id=f"{dataset_id}:{row_number}", source=sensor, platform=platform,
            latitude=lat, longitude=lon, brightness=brightness, scan=scan, track=track,
            acq_date=acq_date, acq_time=acq_time, satellite=get("satellite") or platform,
            confidence=confidence, confidence_class=confidence_class,
            version=get("version") or None,
            bright_t31=thermal if sensor == "MODIS" else None,
            bright_ti5=thermal if sensor == "VIIRS" else None,
            frp=frp, daynight=daynight,
            source_columns={k: (v if v != "" else None) for k, v in row.items()},
        )
    except Exception as exc:
        raise ValueError(f"{_why(exc)}: {exc}") from exc


def ingest_csv(csv_path: Path, data_dir: Path, sensor: str, original_filename: str, max_bytes: int) -> Tuple[DatasetMetadataSchema, Path]:
    if sensor not in REQUIRED_COLUMNS:
        raise UploadRejected("Sensor must be MODIS or VIIRS.", "INVALID_SENSOR")
    if csv_path.stat().st_size > max_bytes:
        raise UploadRejected("Uploaded file exceeds the configured upload-size limit.", "FILE_TOO_LARGE")
    dataset_id = f"fir-{uuid.uuid4().hex}"
    stage_dir = Path(tempfile.mkdtemp(prefix=".ingest-", dir=data_dir))
    raw_target = stage_dir / "original.csv"
    obs_target = stage_dir / "observations.jsonl"
    seen_db = stage_dir / "seen.sqlite3"
    conn = None
    try:
        shutil.copyfile(csv_path, raw_target)
        try:
            with raw_target.open("r", encoding="utf-8-sig", newline="") as f:
                reader = csv.reader(f, strict=True)
                try:
                    headers = next(reader)
                except StopIteration:
                    raise UploadRejected("CSV is empty.", "EMPTY_CSV")
                checked = validate_columns(sensor, headers)
                if not checked.valid:
                    raise UploadRejected(checked.message, "INVALID_SCHEMA")
                # The documented NASA layouts use canonical lowercase headers.
                # Preserve spelling in source values while normalizing keys for parsing.
                original_headers = [h.strip() for h in headers]
                normalized_headers = [h.strip().lower() for h in headers]
                conn = sqlite3.connect(seen_db)
                conn.execute("CREATE TABLE seen (digest TEXT PRIMARY KEY)")
                total_rows = parsed = invalid_coordinates = duplicate_records = 0
                rejected: Counter[str] = Counter()
                missing: Counter[str] = Counter()
                platforms: Counter[str] = Counter()
                date_min = date_max = None
                min_lat = min_lon = float("inf")
                max_lat = max_lon = float("-inf")
                with obs_target.open("w", encoding="utf-8", newline="") as out:
                    for raw_row in reader:
                        total_rows += 1
                        normalized_row = {normalized_headers[i]: raw_row[i] for i in range(min(len(raw_row), len(normalized_headers)))}
                        for col in REQUIRED_COLUMNS[sensor]:
                            if not (normalized_row.get(col) or "").strip():
                                missing[col] += 1
                        digest = hashlib.sha256(json.dumps(raw_row, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
                        try:
                            conn.execute("INSERT INTO seen VALUES (?)", (digest,))
                        except sqlite3.IntegrityError:
                            duplicate_records += 1
                        if len(raw_row) != len(normalized_headers):
                            rejected["malformed_row_width"] += 1
                            continue
                        raw_columns = {original_headers[i]: raw_row[i] for i in range(len(raw_row))}
                        # Reconstruct with the original header spellings for provenance.
                        canonical = {normalized_headers[i]: raw_columns[original_headers[i]] for i in range(len(raw_row))}
                        try:
                            obs = _parse_row(sensor, canonical, dataset_id, total_rows)
                        except ValueError as exc:
                            reason = str(exc).split(":", 1)[0]
                            rejected[reason] += 1
                            if reason == "invalid_coordinates":
                                invalid_coordinates += 1
                            continue
                        obs.source_columns = {original_headers[i]: raw_row[i] or None for i in range(len(raw_row))}
                        out.write(obs.model_dump_json() + "\n")
                        parsed += 1
                        platforms[obs.platform] += 1
                        date_min = obs.acq_date if date_min is None else min(date_min, obs.acq_date)
                        date_max = obs.acq_date if date_max is None else max(date_max, obs.acq_date)
                        min_lat, max_lat = min(min_lat, obs.latitude), max(max_lat, obs.latitude)
                        min_lon, max_lon = min(min_lon, obs.longitude), max(max_lon, obs.longitude)
                conn.commit()
                conn.close()
                conn = None
        except (UnicodeDecodeError, csv.Error) as exc:
            raise UploadRejected(f"Malformed CSV content: {exc}", "MALFORMED_CSV") from exc

        rejected_rows = sum(rejected.values())
        report = {
            "totalInputRows": total_rows, "successfullyParsedRows": parsed,
            "rejectedRows": rejected_rows, "rejectionReasons": dict(rejected),
            "missingValues": {col: {"missingCount": missing[col], "missingPercentage": round(missing[col] * 100 / total_rows, 2) if total_rows else 0.0} for col in REQUIRED_COLUMNS[sensor]},
            "invalidCoordinates": invalid_coordinates, "duplicateRecords": duplicate_records,
            "minimumAcquisitionDate": date_min if parsed else None,
            "maximumAcquisitionDate": date_max if parsed else None,
            "geographicBoundingBox": {"minLatitude": min_lat, "maxLatitude": max_lat, "minLongitude": min_lon, "maxLongitude": max_lon} if parsed else None,
            "platformDistribution": dict(platforms),
        }
        missing_items = [MissingValueItem(column=c, totalRows=total_rows, missingCount=missing[c], missingPercentage=report["missingValues"][c]["missingPercentage"]) for c in REQUIRED_COLUMNS[sensor]]
        original_safe = safe_source_filename(original_filename)
        imported = datetime.now(timezone.utc).isoformat()
        size = raw_target.stat().st_size
        metadata = DatasetMetadataSchema(
            id=dataset_id, title=Path(original_safe).stem or f"{sensor} FIRMS upload", sensor=sensor,
            satellite=next(iter(platforms)) if len(platforms) == 1 else ("Multiple" if platforms else None),
            instrument=sensor, temporalCoverage=f"{date_min} to {date_max}" if parsed else None,
            fileFormat="NASA FIRMS CSV", recordCount=parsed, sizeMb=round(size / (1024 * 1024), 4),
            variables=[{"name": h, "dtype": "string", "units": None} for h in original_headers],
            attributes={"source": "User-uploaded NASA FIRMS CSV", "sensorSelection": sensor},
            missingValueAnalysis=missing_items, qualityReport=report, importedAt=imported,
            sourceFilename=original_safe,
            provenance={"source": "user_upload", "sensorSelection": sensor, "uploadedFilename": original_safe, "importedAt": imported},
        )
        (stage_dir / "metadata.json").write_text(metadata.model_dump_json(indent=2), encoding="utf-8")
        (stage_dir / "validation_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        if seen_db.exists(): seen_db.unlink()
        final_dir = Path(data_dir) / dataset_id
        os.replace(stage_dir, final_dir)
        return metadata, final_dir / "observations.jsonl"
    except Exception:
        if conn is not None:
            conn.close()
        shutil.rmtree(stage_dir, ignore_errors=True)
        raise
