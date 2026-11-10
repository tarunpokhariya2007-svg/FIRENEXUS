# PostgreSQL and PostGIS storage

FIRENEXUS uses PostgreSQL through `DATABASE_URL` when configured. It uses the existing typed Pydantic models and direct SQL via psycopg 3; no second ORM was added. Without `DATABASE_URL`, the existing SQLite and JSON storage remains active for local development and the pre-existing tests.

`DATABASE_URL` is backend-only. Do not name it with a `VITE_` prefix or add it to frontend deployment variables. `DATABASE_SSL_CA` is optional: without a CA path, the client requires TLS (`sslmode=require`) for Aiven; with a CA path and no explicit mode, it uses certificate and hostname verification (`sslmode=verify-full`). Explicit SSL modes are allowed only when they guarantee encryption: `require`, `verify-ca`, or `verify-full`. The URL is never included in logs or API payloads.

## Read-only production connection check

The command below is separate from the migration runner. It issues only `SELECT` queries for the current database, PostgreSQL server version, PostGIS version, and the current connection's SSL state. It does not inspect migration state, create tables, or import observations.

Set the secret in the backend environment or secret manager, then run from `backend/`:

```powershell
$env:DATABASE_URL = "<Aiven PostgreSQL URL>"
# Optional when using Aiven's CA certificate:
$env:DATABASE_SSL_CA = "<path to Aiven CA certificate>"
python -m pip install -r requirements.txt
python -m app.database_check
```

The command prints a JSON result with `connected`, `database`, `postgres_version`, `postgis_version`, `ssl_enabled`, and a safe parse summary (`username_present`, port, `database_present`, `sslmode`). On failure it prints a categorized diagnostic and general troubleshooting guidance; it does not print driver error text, username, hostname, passwords, or the URL. Do not run `python -m app.migrations upgrade` for connectivity verification; that command changes schema.

## Migration commands

Run from `backend/` after setting the secret in the backend process environment. These commands change schema only and never read or import local observations:

```powershell
$env:DATABASE_URL = "<Aiven PostgreSQL URL>"
python -m app.migrations upgrade
```

```sh
export DATABASE_URL='<Aiven PostgreSQL URL>'
python -m app.migrations upgrade
```

To reverse application schema migration 1 (this preserves the Aiven-managed PostGIS extension):

```powershell
python -m app.migrations downgrade --target 0
```

The migration runner first verifies that PostGIS is enabled, applies versioned SQL in a transaction, records `schema_migrations`, and prints version numbers only. Back up the target database before using downgrade; it drops FIRENEXUS tables.

## Stored information

- `datasets` stores dataset metadata, source filename/path/checksum, record count and provenance.
- `fire_observations` stores source identifiers when present, original source columns, payload, sensor/platform, confidence in sensor-appropriate columns, UTC acquisition date/time, FRP, WGS84 coordinates and a PostGIS point. Dataset plus observation ID is unique; inserts use batches of 1,000 and `ON CONFLICT DO NOTHING`.
- `data_quality_reports` stores the ingestion report.
- `acquisition_jobs`, `acquisition_chunks` and `acquisition_downloads` persist resumable acquisition state while raw CSV files and the availability manifest remain in `FIRENEXUS_DATA_DIR` unchanged.
- `harmonization_jobs`, `observation_matches` and `harmonized_observations` provide persistent job/result and association schemas. The current harmonization response only contains sample excerpts, so only those returned excerpts can be represented as harmonized observation rows; full edge persistence requires the existing result contract to expose complete associations and is not fabricated here.

Indexes cover dataset, sensor, platform, acquisition date/timestamp and PostGIS geometry. Existing SQLite databases, JSON manifests, CSV files and JSONL files are not deleted or automatically imported when PostgreSQL is enabled. PostgreSQL starts with only data already present in PostgreSQL; local archives remain available for a later, separately reviewed migration plan.

## Pilot-data migration boundary

The two local February 2024 pilot files are **not** imported by application startup, migration commands or tests. Before any pilot import, produce and review a dry-run plan that compares source CSV/manifest checksums and row totals against the pilot facts (Amazon MODIS SP 11,907; VIIRS S-NPP SP 45,513), states duplicate keys and failure handling, and confirms local files will remain intact. No pilot import or historical acquisition is started in this phase.

## Explicit acquisition dataset recovery

The protected endpoint `POST /api/admin/recovery/acquisitions/{dataset_id}` rebuilds one already-registered acquisition dataset from its recorded local raw CSV. It does not call NASA. It verifies the SHA-256 and download metadata before parsing, retains the dataset ID and deterministic source-row IDs, and never replaces the original raw CSV. A missing or mismatched source returns a conflict without changing database rows. PostgreSQL dataset metadata, observations, quality report, and acquisition ledger updates are committed in one transaction. The operation must be triggered manually; it is not part of startup.

Set a high-entropy `FIRENEXUS_RECOVERY_SECRET` in the Render backend environment only. Keep it out of `VITE_*`, source control, request URLs, and logs. If unset, recovery returns `RECOVERY_NOT_CONFIGURED`; invalid credentials are rejected. After deploying the code and configuring the secret, invoke one dataset at a time from PowerShell (the secret must already be available in the local process environment):

```powershell
$api = "https://firenexus-api-3izj.onrender.com"
$datasetId = "<existing-dataset-id>"
$headers = @{ "X-FIRENEXUS-RECOVERY-SECRET" = $env:FIRENEXUS_RECOVERY_SECRET }
Invoke-RestMethod -Method Post -Uri "$api/api/admin/recovery/acquisitions/$datasetId" -Headers $headers
```

The response reports dataset ID, parsed dataset count, original downloaded row count, normalized platform distribution, and source checksum. It does not include credentials or the full raw path. Review each response and dataset inventory before triggering the next recovery. Do not call the endpoint until the deployed `FIRENEXUS_RECOVERY_SECRET` is configured and the existing raw files are confirmed to reside on the Render instance's configured `FIRENEXUS_DATA_DIR`.

## Integration tests

Unit tests cover TLS URL handling and migration pairing. Live database tests require an explicitly disposable PostgreSQL/PostGIS test database and both variables below; they never use `DATABASE_URL` as their target:

```powershell
$env:FIRENEXUS_TEST_DATABASE_URL = "<disposable test database URL>"
$env:FIRENEXUS_ALLOW_DATABASE_TESTS = "1"
python -m pytest tests/test_postgres_integration.py -q
```

The opt-in test applies migrations and writes/deletes one clearly labeled software fixture dataset. Do not set it to a production database. The default test suite never connects to `DATABASE_URL`.
