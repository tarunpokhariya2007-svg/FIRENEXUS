"""Transactional, idempotent import of an existing local NASA FIRMS CSV.

This module deliberately has no NASA HTTP client or acquisition-manager imports.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
from typing import Any, Optional
import uuid

from app.models.schemas import DatasetMetadataSchema
from app.services.database import connection as postgres_connection
from app.services.ingestion import UploadRejected, ingest_csv

logger = logging.getLogger(__name__)

SOURCE_PRODUCTS = {
    "MODIS_SP": {"sensor": "MODIS", "platforms": {"Terra", "Aqua"}},
    "VIIRS_SNPP_SP": {"sensor": "VIIRS", "platforms": {"Suomi-NPP"}},
}


class ExistingCsvImportError(RuntimeError):
    def __init__(self, code: str, message: str, report: Optional[dict] = None):
        self.code = code
        self.report = report
        super().__init__(message)


@dataclass(frozen=True)
class ImportProvenance:
    region_id: str
    source_id: str
    start_date: date
    end_date: date
    processing_level: str = "SP"
    source: str = "NASA FIRMS"

    def validate(self) -> str:
        product = SOURCE_PRODUCTS.get(self.source_id)
        if not product:
            raise ExistingCsvImportError("INVALID_SOURCE", "Supported sources are MODIS_SP and VIIRS_SNPP_SP.")
        if product["sensor"] not in ("MODIS", "VIIRS"):
            raise ExistingCsvImportError("INVALID_SOURCE", "Source and sensor mapping is invalid.")
        if self.region_id != "amazon_basin":
            raise ExistingCsvImportError("INVALID_REGION", "This import command currently supports region amazon_basin only.")
        if self.processing_level != "SP" or self.source != "NASA FIRMS":
            raise ExistingCsvImportError("INVALID_PROVENANCE", "Pilot provenance must identify NASA FIRMS Standard Processing (SP).")
        if self.start_date > self.end_date:
            raise ExistingCsvImportError("INVALID_DATE_RANGE", "Start date must not be after end date.")
        return str(product["sensor"])

    def as_dict(self, sensor: str, filename: str, source_path: str, sha256: str) -> dict[str, str]:
        return {
            "regionId": self.region_id,
            "sourceId": self.source_id,
            "sensor": sensor,
            "startDate": self.start_date.isoformat(),
            "endDate": self.end_date.isoformat(),
            "processingLevel": self.processing_level,
            "source": self.source,
            "sourceFilename": filename,
            "sourcePath": source_path,
            "sourceSha256": sha256,
        }


@dataclass
class PreparedImport:
    source_path: Path
    source_sha256: str
    provenance: dict[str, str]
    metadata: DatasetMetadataSchema
    observations_path: Path
    report: dict


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ExistingCsvImporter:
    """Prepare outside the database, then commit all normalized rows atomically."""

    def __init__(self, registry, data_dir: str | Path, max_bytes: int,
                 database_url: str, ssl_ca: str = "") -> None:
        if not database_url:
            raise ExistingCsvImportError("DATABASE_REQUIRED", "Configure backend DATABASE_URL before importing.")
        self.registry = registry
        self.data_dir = Path(data_dir).resolve()
        self.max_bytes = int(max_bytes)
        self.database_url = database_url
        self.ssl_ca = ssl_ca

    def import_file(self, file_path: str | Path, provenance: ImportProvenance,
                    expected_observations: Optional[int] = None) -> dict:
        sensor = provenance.validate()
        source = Path(file_path).expanduser()
        try:
            source = source.resolve(strict=True)
        except OSError as exc:
            raise ExistingCsvImportError("SOURCE_NOT_FOUND", "The source CSV path does not exist or is inaccessible.") from None
        if not source.is_file() or source.suffix.lower() != ".csv":
            raise ExistingCsvImportError("UNSUPPORTED_FILE", "Provide an existing .csv file.")
        if expected_observations is not None and expected_observations < 0:
            raise ExistingCsvImportError("INVALID_EXPECTED_COUNT", "Expected observations must be zero or greater.")

        source_hash = sha256_file(source)
        prov = provenance.as_dict(sensor, source.name, str(source), source_hash)
        # Fast path avoids even creating a normalized staging dataset on retries.
        try:
            existing = self._lookup(source_hash)
        except ExistingCsvImportError:
            raise
        except Exception as exc:
            logger.error("Existing CSV import check failed: category=database_error type=%s", type(exc).__name__)
            raise ExistingCsvImportError("DATABASE_UNAVAILABLE", "Could not check import status; no dataset was changed.") from None
        if existing:
            existing_result = self._existing_result(existing, prov)
            if existing_result["status"] != "retry_allowed":
                return existing_result
        else:
            try:
                self._check_legacy_dataset_hash(source_hash)
            except ExistingCsvImportError:
                raise
            except Exception as exc:
                logger.error("Existing CSV checksum check failed: category=database_error type=%s", type(exc).__name__)
                raise ExistingCsvImportError("DATABASE_UNAVAILABLE", "Could not check for an existing dataset; no dataset was changed.") from None

        prepared: Optional[PreparedImport] = None
        try:
            prepared = self._prepare(source, source_hash, prov, sensor, provenance, expected_observations)
            result = self._commit(prepared, expected_observations)
            if result["status"] == "already_imported":
                self._discard_artifacts(prepared)
                return result
            self.registry.register_postgres_persisted(prepared.metadata, prepared.observations_path)
            return result
        except ExistingCsvImportError as exc:
            non_failure_codes = {"PROVENANCE_CONFLICT", "IMPORT_IN_PROGRESS", "DATASET_REMOVED",
                                 "EXISTING_DATASET_REQUIRES_REVIEW", "MIGRATION_REQUIRED"}
            if prepared:
                self._discard_artifacts(prepared)
                if exc.code not in non_failure_codes:
                    self._record_failure(prepared, expected_observations, exc.code, str(exc))
            elif exc.code not in non_failure_codes:
                self._record_failure_values(source_hash, prov, source.name, str(source), expected_observations,
                                            exc.code, str(exc), exc.report)
            raise
        except Exception as exc:
            logger.error("Existing CSV import failed: category=database_or_import_error type=%s", type(exc).__name__)
            if prepared:
                self._discard_artifacts(prepared)
                self._record_failure(prepared, expected_observations, "DATABASE_IMPORT_FAILED",
                                     "Database transaction failed; no dataset was committed.")
            else:
                self._record_failure_values(source_hash, prov, source.name, str(source), expected_observations,
                                            "IMPORT_FAILED", "CSV preparation failed; no dataset was committed.", None)
            raise ExistingCsvImportError("DATABASE_IMPORT_FAILED", "Import transaction failed; no dataset was committed.") from None

    def _prepare(self, source: Path, source_hash: str, provenance: dict[str, str], sensor: str,
                 requested: ImportProvenance, expected: Optional[int]) -> PreparedImport:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        try:
            metadata, observations_path = ingest_csv(source, self.data_dir, sensor, source.name, self.max_bytes)
        except UploadRejected as exc:
            raise ExistingCsvImportError(exc.code, str(exc)) from None
        prepared = PreparedImport(source, source_hash, provenance, metadata, observations_path, metadata.qualityReport)
        try:
            self._validate_prepared(prepared, requested, expected)
            return prepared
        except ExistingCsvImportError:
            self._discard_artifacts(prepared)
            raise

    def _validate_prepared(self, prepared: PreparedImport, requested: ImportProvenance,
                           expected: Optional[int]) -> None:
        metadata, source, source_hash = prepared.metadata, prepared.source_path, prepared.source_sha256
        report = prepared.report
        total = int(report.get("totalInputRows", 0))
        parsed = int(report.get("successfullyParsedRows", 0))
        rejected = int(report.get("rejectedRows", 0))
        if rejected:
            raise ExistingCsvImportError("REJECTED_ROWS", f"CSV contains {rejected} rejected row(s); import was not committed.", report)
        if not parsed:
            raise ExistingCsvImportError("EMPTY_DATASET", "CSV contains no successfully parsed observations.", report)
        lo = report.get("minimumAcquisitionDate")
        hi = report.get("maximumAcquisitionDate")
        if not lo or not hi or lo < requested.start_date.isoformat() or hi > requested.end_date.isoformat():
            raise ExistingCsvImportError("DATE_COVERAGE_MISMATCH", "Observation dates fall outside the requested acquisition interval.", report)
        allowed = SOURCE_PRODUCTS[requested.source_id]["platforms"]
        platform_counts = report.get("platformDistribution") or {}
        if not platform_counts or set(platform_counts) - allowed:
            raise ExistingCsvImportError("SOURCE_PLATFORM_MISMATCH", "CSV satellite/platform values do not match the declared FIRMS source.", report)
        if expected is not None and parsed != expected:
            raise ExistingCsvImportError("EXPECTED_COUNT_MISMATCH", f"Parsed {parsed} observation(s); expected-count check was {expected}. No data was committed.", report)
        if sha256_file(source) != source_hash:
            raise ExistingCsvImportError("SOURCE_CHANGED", "Source CSV changed while it was being validated.", report)

        metadata.sourceFilename = source.name
        metadata.title = f"Amazon Basin · {requested.source_id} · {requested.start_date} to {requested.end_date}"
        metadata.attributes.update({
            "regionId": requested.region_id,
            "sourceId": requested.source_id,
            "processingLevel": requested.processing_level,
            "source": requested.source,
            "startDate": requested.start_date.isoformat(),
            "endDate": requested.end_date.isoformat(),
        })
        metadata.provenance = prepared.provenance
        metadata.qualityReport["existingCsvImport"] = {
            "sourceSha256": source_hash,
            "expectedObservations": expected,
            "sourceRows": total,
            "parsedRows": parsed,
            "rejectedRows": rejected,
            "duplicateSourceRecords": int(report.get("duplicateRecords", 0)),
            "duplicatePolicy": "Retained; duplicates are reported and assigned source-row-based observation IDs.",
        }
        prepared.report = metadata.qualityReport

    def _lookup(self, sha256: str):
        with postgres_connection(self.database_url, self.ssl_ca) as conn:
            self._require_v2(conn)
            return conn.execute(self._lookup_sql(), (sha256,)).fetchone()

    @staticmethod
    def _lookup_sql() -> str:
        return """SELECT i.source_sha256,i.dataset_id,i.provenance,i.import_status,
            i.total_input_rows,i.parsed_rows,i.rejected_rows,i.duplicate_records,
            i.failure_code,i.failure_reason,d.metadata
            FROM dataset_imports i LEFT JOIN datasets d ON d.id=i.dataset_id
            WHERE i.source_sha256=%s"""

    @staticmethod
    def _require_v2(conn) -> None:
        if not conn.execute("SELECT to_regclass('public.dataset_imports') AS name").fetchone()["name"]:
            raise ExistingCsvImportError("MIGRATION_REQUIRED", "Database migration 2 is required before existing-CSV imports.")

    def _check_legacy_dataset_hash(self, sha256: str) -> None:
        with postgres_connection(self.database_url, self.ssl_ca) as conn:
            row = conn.execute("SELECT id FROM datasets WHERE source_checksum_sha256=%s LIMIT 1", (sha256,)).fetchone()
            if row:
                raise ExistingCsvImportError("EXISTING_DATASET_REQUIRES_REVIEW", "This file checksum is already registered outside the idempotent import ledger; review the existing dataset before importing.")

    def _existing_result(self, row, provenance: dict[str, str]) -> dict:
        stored = row["provenance"]
        if stored != provenance:
            raise ExistingCsvImportError("PROVENANCE_CONFLICT", "This exact file checksum is already registered with different acquisition provenance.")
        if row["import_status"] == "completed":
            if not row["dataset_id"] or not row["metadata"]:
                raise ExistingCsvImportError("DATASET_REMOVED", "The ledger shows this file was imported, but its dataset is no longer present; refusing to recreate it automatically.")
            return self._format_result(row, "already_imported")
        if row["import_status"] == "processing":
            raise ExistingCsvImportError("IMPORT_IN_PROGRESS", "An import for this file is already in progress.")
        return {"status": "retry_allowed", "sourceSha256": row["source_sha256"],
                "failureCode": row["failure_code"], "failureReason": row["failure_reason"]}

    def _commit(self, prepared: PreparedImport, expected: Optional[int]) -> dict:
        provenance_json = json.dumps(prepared.provenance, sort_keys=True)
        with postgres_connection(self.database_url, self.ssl_ca) as conn:
            self._require_v2(conn)
            # Serialize attempts for the same content hash before examining or
            # creating its ledger row. The unique primary key remains the final
            # guard; the transaction-scoped lock makes concurrent retries
            # observe the committed winner and return `already_imported`.
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                         (prepared.source_sha256,))
            row = conn.execute(self._lookup_sql() + " FOR UPDATE OF i", (prepared.source_sha256,)).fetchone()
            if row:
                if row["provenance"] != prepared.provenance:
                    raise ExistingCsvImportError("PROVENANCE_CONFLICT", "This exact file checksum is already registered with different acquisition provenance.")
                if row["import_status"] == "completed":
                    if not row["dataset_id"] or not row["metadata"]:
                        raise ExistingCsvImportError("DATASET_REMOVED", "The ledger shows this file was imported, but its dataset is no longer present; refusing to recreate it automatically.")
                    return self._format_result(row, "already_imported")
                if row["import_status"] == "processing":
                    raise ExistingCsvImportError("IMPORT_IN_PROGRESS", "An import for this file is already in progress.")
                conn.execute("""UPDATE dataset_imports SET import_status='processing',dataset_id=NULL,
                    expected_record_count=%s,total_input_rows=%s,parsed_rows=%s,rejected_rows=%s,
                    duplicate_records=%s,quality_report=%s::jsonb,failure_code=NULL,failure_reason=NULL,
                    attempts=attempts+1,started_at=now(),completed_at=NULL
                    WHERE source_sha256=%s""",
                    (expected, prepared.report.get("totalInputRows"), prepared.metadata.recordCount,
                     prepared.report.get("rejectedRows", 0), prepared.report.get("duplicateRecords", 0),
                     json.dumps(prepared.report), prepared.source_sha256))
            else:
                legacy = conn.execute("SELECT id FROM datasets WHERE source_checksum_sha256=%s LIMIT 1", (prepared.source_sha256,)).fetchone()
                if legacy:
                    raise ExistingCsvImportError("EXISTING_DATASET_REQUIRES_REVIEW", "This file checksum is already registered outside the idempotent import ledger; review the existing dataset before importing.")
                conn.execute("""INSERT INTO dataset_imports(source_sha256,provenance,import_status,source_filename,
                    source_path,expected_record_count,total_input_rows,parsed_rows,rejected_rows,duplicate_records,quality_report)
                    VALUES (%s,%s::jsonb,'processing',%s,%s,%s,%s,%s,%s,%s,%s::jsonb)""",
                    (prepared.source_sha256, provenance_json, prepared.source_path.name, str(prepared.source_path),
                     expected, prepared.report.get("totalInputRows"), prepared.metadata.recordCount,
                     prepared.report.get("rejectedRows", 0), prepared.report.get("duplicateRecords", 0),
                     json.dumps(prepared.report)))

            self.registry._index_jsonl_postgres(prepared.metadata.id, prepared.observations_path,
                                                replace=False, connection=conn, meta=prepared.metadata)
            row_count = int(conn.execute("SELECT COUNT(*) AS n FROM fire_observations WHERE dataset_id=%s",
                                         (prepared.metadata.id,)).fetchone()["n"])
            if row_count != int(prepared.metadata.recordCount or 0):
                raise ExistingCsvImportError("ROW_COUNT_MISMATCH", "Database observation count did not match the validated CSV; transaction was rolled back.", prepared.report)
            conn.execute("""UPDATE dataset_imports SET dataset_id=%s,import_status='completed',
                completed_at=now(),failure_code=NULL,failure_reason=NULL
                WHERE source_sha256=%s""", (prepared.metadata.id, prepared.source_sha256))
            return {
                "status": "imported", "datasetId": prepared.metadata.id,
                "sourceSha256": prepared.source_sha256, "sourceFilename": prepared.source_path.name,
                "sourcePath": str(prepared.source_path), "provenance": prepared.provenance,
                "totalInputRows": int(prepared.report.get("totalInputRows", 0)),
                "parsedRows": row_count, "rejectedRows": int(prepared.report.get("rejectedRows", 0)),
                "duplicateSourceRecords": int(prepared.report.get("duplicateRecords", 0)),
                "expectedObservations": expected, "qualityReport": prepared.report,
            }

    @staticmethod
    def _format_result(row, status: str) -> dict:
        metadata = DatasetMetadataSchema.model_validate(row["metadata"])
        quality = metadata.qualityReport
        return {
            "status": status, "datasetId": row["dataset_id"], "sourceSha256": row["source_sha256"],
            "sourceFilename": metadata.sourceFilename, "sourcePath": row["provenance"].get("sourcePath"),
            "provenance": row["provenance"], "totalInputRows": row["total_input_rows"],
            "parsedRows": row["parsed_rows"], "rejectedRows": row["rejected_rows"],
            "duplicateSourceRecords": row["duplicate_records"], "qualityReport": quality,
        }

    def _record_failure(self, prepared: PreparedImport, expected: Optional[int], code: str, message: str) -> None:
        self._record_failure_values(prepared.source_sha256, prepared.provenance, prepared.source_path.name,
                                    str(prepared.source_path), expected, code, message, prepared.report)

    def _record_failure_values(self, source_sha: str, provenance: dict[str, str], filename: str,
                               source_path: str, expected: Optional[int], code: str,
                               message: str, report: Optional[dict]) -> None:
        try:
            with postgres_connection(self.database_url, self.ssl_ca) as conn:
                self._require_v2(conn)
                row = conn.execute("SELECT provenance,import_status FROM dataset_imports WHERE source_sha256=%s FOR UPDATE", (source_sha,)).fetchone()
                if row:
                    if row["provenance"] != provenance or row["import_status"] == "completed":
                        return
                    conn.execute("""UPDATE dataset_imports SET dataset_id=NULL,import_status='failed',
                        expected_record_count=%s,total_input_rows=%s,parsed_rows=%s,rejected_rows=%s,
                        duplicate_records=%s,quality_report=%s::jsonb,failure_code=%s,failure_reason=%s,
                        completed_at=NULL WHERE source_sha256=%s""",
                        (expected, (report or {}).get("totalInputRows"), (report or {}).get("successfullyParsedRows"),
                         (report or {}).get("rejectedRows"), (report or {}).get("duplicateRecords"),
                         json.dumps(report) if report is not None else None, code, message, source_sha))
                else:
                    conn.execute("""INSERT INTO dataset_imports(source_sha256,provenance,import_status,source_filename,
                        source_path,expected_record_count,total_input_rows,parsed_rows,rejected_rows,duplicate_records,
                        quality_report,failure_code,failure_reason)
                        VALUES (%s,%s::jsonb,'failed',%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)
                        ON CONFLICT(source_sha256) DO NOTHING""",
                        (source_sha, json.dumps(provenance), filename, source_path, expected,
                         (report or {}).get("totalInputRows"), (report or {}).get("successfullyParsedRows"),
                         (report or {}).get("rejectedRows"), (report or {}).get("duplicateRecords"),
                         json.dumps(report) if report is not None else None, code, message))
        except Exception:
            logger.warning("Could not persist failed CSV import status: category=database_error")

    def _discard_artifacts(self, prepared: PreparedImport) -> None:
        folder = prepared.observations_path.parent.resolve()
        if folder.parent == self.data_dir and folder.name == prepared.metadata.id and folder.name.startswith("fir-"):
            stored_meta = folder / "metadata.json"
            if stored_meta.is_file():
                try:
                    loaded = DatasetMetadataSchema.model_validate_json(stored_meta.read_text(encoding="utf-8"))
                    if loaded.id == prepared.metadata.id:
                        shutil.rmtree(folder)
                except Exception:
                    return
