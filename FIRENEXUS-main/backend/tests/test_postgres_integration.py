"""Opt-in PostgreSQL/PostGIS tests. Use only a disposable test database."""
from contextlib import contextmanager
import os
import socket
import ssl
import uuid

import pytest

from app.migrations import migration_files
from app.models.schemas import DatasetMetadataSchema, FireObservationSchema
from app.services import database as database_service
from app.services.database import (
    AcquisitionConnection, DatabaseVerificationError, check_connection,
    classify_database_error, parse_database_url, postgres_dsn,
)
from app.services.registry import DatasetRegistry

TEST_DATABASE_URL = os.getenv("FIRENEXUS_TEST_DATABASE_URL", "")
RUN_DB_TESTS = os.getenv("FIRENEXUS_ALLOW_DATABASE_TESTS") == "1" and bool(TEST_DATABASE_URL)
def test_aiven_tls_and_reversible_migration_files():
    configured = postgres_dsn("postgresql://user:password@db.example:1234/defaultdb")
    assert "sslmode=require" in configured
    assert "sslmode=disable" not in postgres_dsn("postgres://user:password@db.example:1234/defaultdb")
    with pytest.raises(ValueError, match="encrypted"):
        postgres_dsn("postgresql://user:password@db.example:1234/defaultdb?sslmode=prefer")
    stronger = postgres_dsn("postgresql://user:password@db.example:1234/defaultdb?sslmode=verify-full", "ca.pem")
    assert "sslmode=verify-full" in stronger and "sslrootcert=ca.pem" in stronger
    uppercase_mode = postgres_dsn("postgresql://user:password@db.example:1234/defaultdb?SSLMODE=require")
    assert uppercase_mode.count("sslmode=") == 1
    files = migration_files()
    assert files and all(up.exists() and down.exists() for _, up, down in files)


def test_aiven_url_components_are_parsed_without_returning_secrets():
    parsed = parse_database_url(
        "postgresql://fir%40nexus:secret%40value@aiven.example:25432/defaultdb?sslmode=verify-full"
    )
    assert parsed.username_present is True
    assert parsed.port == 25432
    assert parsed.database_present is True
    assert parsed.sslmode == "verify-full"
    assert "aiven.example" not in repr(parsed)
    assert "secret%40value" not in repr(parsed)


@pytest.mark.parametrize(("error", "category"), [
    (socket.gaierror("host resolution detail contains private-host"), "dns_resolution"),
    (TimeoutError("connection timed out"), "network_timeout_or_refusal"),
    (ssl.SSLError("certificate verify failed for private-host"), "tls_ssl_error"),
    (RuntimeError("PostgreSQL support requires psycopg[binary]"), "driver_not_installed"),
    (RuntimeError("Installed psycopg version is too old"), "driver_version_unsupported"),
    (ValueError("DATABASE_URL has invalid authority"), "invalid_database_url"),
])
def test_database_failure_categories(error, category):
    assert classify_database_error(error)[0] == category


def test_database_sqlstate_categories_and_redaction(monkeypatch, caplog):
    class DriverError(Exception):
        def __init__(self, message, sqlstate):
            super().__init__(message)
            self.sqlstate = sqlstate

    cases = [
        ("password authentication failed for user secret-user", "28P01", "authentication_failure"),
        ("database private-name does not exist", "3D000", "database_or_user_error"),
        ("function postgis_full_version() does not exist", "42883", "postgis_unavailable"),
        ("syntax error at secret-token", "42601", "unexpected_sql_error"),
    ]
    for message, sqlstate, expected in cases:
        assert classify_database_error(DriverError(message, sqlstate))[0] == expected

    private_url = "postgresql://user:private-password@host-with-secret:1234/private-db"

    @contextmanager
    def failed_connection(*args, **kwargs):
        raise socket.gaierror(f"cannot resolve host-with-secret from {private_url}")
        yield  # pragma: no cover

    monkeypatch.setattr(database_service, "connection", failed_connection)
    with pytest.raises(DatabaseVerificationError) as err:
        database_service.verify_readonly_connection(private_url)
    assert err.value.category == "dns_resolution"
    assert "category=dns_resolution" in caplog.text
    assert "private-password" not in caplog.text
    assert "host-with-secret" not in caplog.text
    assert "private-db" not in caplog.text
    assert "private-password" not in str(err.value)
    assert "host-with-secret" not in str(err.value)
    assert "private-db" not in str(err.value)


def test_readonly_verifier_does_not_leak_connection_failure(monkeypatch):
    password = "not-for-output"
    dsn = f"postgresql://user:{password}@db.example/defaultdb"

    @contextmanager
    def failed_connection(*args, **kwargs):
        raise RuntimeError(f"connection failed for {dsn}")
        yield  # pragma: no cover

    monkeypatch.setattr(database_service, "connection", failed_connection)
    with pytest.raises(DatabaseVerificationError) as exc:
        database_service.verify_readonly_connection(dsn)
    assert password not in str(exc.value)
    assert dsn not in str(exc.value)


def test_acquisition_sql_adapter_targets_postgres_tables_and_jsonb():
    class Cursor:
        description = []
        def execute(self, query, params):
            self.query, self.params = query, params
        def fetchone(self): return None
        def fetchall(self): return []
        def fetchmany(self, size): return []
        def __iter__(self): return iter(())

    class Connection:
        def cursor(self, **kwargs):
            self.last_cursor = Cursor()
            return self.last_cursor
        def execute(self, query, params):
            return self.cursor().execute(query, params)

    raw = Connection()
    adapter = AcquisitionConnection(raw)
    adapter.execute("INSERT INTO jobs(id,request_json,status,created_at,updated_at) VALUES (?,?,?,?,?)", ("job", "{}", "queued", "now", "now"))
    assert "INSERT INTO acquisition_jobs" in raw.last_cursor.query
    assert "%s::jsonb" in raw.last_cursor.query and "?" not in raw.last_cursor.query
    adapter.execute("SELECT * FROM chunks WHERE job_id=?", ("job",))
    assert "acquisition_chunks" in raw.last_cursor.query


@pytest.mark.parametrize("value", [
    {"regionId": "amazon-basin", "sourceId": "MODIS_SP"},
    {"nested": {"dates": ["2024-02-01", "2024-02-28"], "metadata": {"version": 1}}},
    ["MODIS_SP", {"platforms": ["Terra", "Aqua"]}],
])
def test_acquisition_wrapper_adapts_values_only_for_explicit_jsonb_placeholders(value):
    from psycopg.types.json import Jsonb

    class Cursor:
        description = []
        def execute(self, query, params): self.query, self.params = query, params

    class Connection:
        def cursor(self, **kwargs):
            self.last_cursor = Cursor()
            return self.last_cursor

    raw = Connection()
    adapter = AcquisitionConnection(raw)
    adapter.execute("INSERT INTO payloads(payload) VALUES (%s::jsonb)", (value,))
    adapted = raw.last_cursor.params[0]
    assert isinstance(adapted, Jsonb)
    assert adapted.obj == value


def test_acquisition_job_insert_adapts_native_request_json_for_postgres():
    from psycopg.types.json import Jsonb

    class Cursor:
        description = []
        def execute(self, query, params): self.query, self.params = query, params

    class Connection:
        def cursor(self, **kwargs):
            self.last_cursor = Cursor()
            return self.last_cursor

    raw = Connection()
    adapter = AcquisitionConnection(raw)
    request = {"regionId": "amazon-basin", "metadata": {"dates": ["2024-02-01", "2024-02-28"]}}
    adapter.execute("INSERT INTO jobs(id,request_json,status,created_at,updated_at) VALUES (?,?,?,?,?)",
                    ("synthetic-job", request, "queued", "now", "now"))
    assert "INSERT INTO acquisition_jobs" in raw.last_cursor.query
    assert "%s::jsonb" in raw.last_cursor.query
    assert isinstance(raw.last_cursor.params[1], Jsonb)
    assert raw.last_cursor.params[1].obj == request


def test_acquisition_json_null_and_ordinary_parameters_keep_their_meaning():
    from psycopg.types.json import Jsonb

    class Cursor:
        description = []
        def execute(self, query, params): self.query, self.params = query, params

    class Connection:
        def cursor(self, **kwargs):
            self.last_cursor = Cursor()
            return self.last_cursor

    raw = Connection()
    adapter = AcquisitionConnection(raw)
    json_null = Jsonb(None)
    adapter.execute("INSERT INTO payloads(payload) VALUES (%s::jsonb)", (json_null,))
    assert raw.last_cursor.params[0] is json_null

    text = "acquisition failed"
    count = 6
    adapter.execute("UPDATE acquisition_jobs SET error=%s WHERE chunk_count=%s", (text, count))
    assert raw.last_cursor.params == (text, count)

    ordinary_mapping = {"not": "jsonb"}
    adapter.execute("UPDATE acquisition_jobs SET error=%s WHERE id=%s", (ordinary_mapping, "job-id"))
    assert raw.last_cursor.params[0] is ordinary_mapping


@pytest.mark.skipif(not RUN_DB_TESTS, reason="Set FIRENEXUS_TEST_DATABASE_URL and FIRENEXUS_ALLOW_DATABASE_TESTS=1 for disposable PostgreSQL tests")
def test_postgis_migrations_batch_import_duplicates_and_spatiotemporal_queries(tmp_path):
    # This test mutates its target database. The explicit opt-in must point to a
    # disposable database, never the production Aiven DATABASE_URL.
    # Never run migrations from a test. Provision version 1 explicitly on a
    # disposable database before opting in; this assertion is read-only.
    with database_service.connection(TEST_DATABASE_URL, os.getenv("DATABASE_SSL_CA", "")) as conn:
        database_name = conn.execute("SELECT current_database() AS name").fetchone()["name"].lower()
        assert "test" in database_name or "disposable" in database_name, "Refusing to mutate a database not named as disposable/test"
        assert conn.execute("SELECT to_regclass('public.datasets') AS name").fetchone()["name"]
    capabilities = check_connection(TEST_DATABASE_URL, os.getenv("DATABASE_SSL_CA", ""))
    assert capabilities["connected"] and "POSTGIS" in capabilities["postgis"].upper()

    dataset_id = f"fir-test-{uuid.uuid4().hex}"
    dataset_dir = tmp_path / dataset_id
    dataset_dir.mkdir()
    (dataset_dir / "original.csv").write_text("source test fixture\n", encoding="utf-8")
    observation = FireObservationSchema(
        id=f"{dataset_id}:1", source="MODIS", platform="Terra", latitude=1.25, longitude=2.5,
        acq_date="2024-02-10", acq_time="1234", satellite="Terra", frp=3.2, confidence=87,
        source_columns={"latitude": "1.25", "longitude": "2.5", "acq_date": "2024-02-10", "acq_time": "1234"},
    )
    observations_path = dataset_dir / "observations.jsonl"
    observations_path.write_text(observation.model_dump_json() + "\n", encoding="utf-8")
    metadata = DatasetMetadataSchema(
        id=dataset_id, title="PostGIS integration fixture", sensor="MODIS", satellite="Terra",
        recordCount=1, sourceFilename="fixture.csv", importedAt="2024-02-11T00:00:00+00:00",
        qualityReport={"totalInputRows": 1, "successfullyParsedRows": 1},
        provenance={"source": "software_test_fixture"},
    )
    registry = DatasetRegistry(str(tmp_path), database_url=TEST_DATABASE_URL,
                               ssl_ca=os.getenv("DATABASE_SSL_CA", ""))
    try:
        registry.register_persisted(metadata, observations_path)
        # Re-index the same source to exercise the (dataset_id, observation_id) conflict key.
        registry._index_jsonl(dataset_id, observations_path, replace=False)
        assert registry.count_query(dataset_ids=[dataset_id]) == 1
        assert registry.count_query(dataset_ids=[dataset_id], start_date="2024-02-10", end_date="2024-02-10",
                                    bbox=(1.0, 1.5, 2.0, 3.0)) == 1
        assert registry.count_query(dataset_ids=[dataset_id], start_date="2024-02-11") == 0
        rows = registry.query_observations(dataset_ids=[dataset_id], bbox=(1.0, 1.5, 2.0, 3.0))
        assert len(rows) == 1 and rows[0].id == observation.id
        assert metadata.qualityReport["successfullyParsedRows"] == registry.count_query(dataset_ids=[dataset_id])
    finally:
        registry.unregister(dataset_id)
