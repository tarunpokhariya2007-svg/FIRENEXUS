"""PostgreSQL connection helpers. No credentials are logged or returned."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
import importlib.metadata
import logging
import socket
import ssl
from typing import Iterator
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit
import re

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ParsedDatabaseUrl:
    dsn: str = field(repr=False)
    username_present: bool
    port: int
    database_present: bool
    sslmode: str


def parse_database_url(database_url: str, ssl_ca: str = "") -> ParsedDatabaseUrl:
    """Validate an Aiven-style PostgreSQL URL without exposing its components."""
    if not database_url:
        raise ValueError("DATABASE_URL is not configured")
    parts = urlsplit(database_url)
    if parts.scheme not in ("postgres", "postgresql", "postgresql+psycopg"):
        raise ValueError("DATABASE_URL must be a PostgreSQL URL")
    try:
        hostname = parts.hostname
        username = parts.username
        port = parts.port
    except ValueError as exc:
        raise ValueError("DATABASE_URL has invalid authority or port syntax") from exc
    database = unquote(parts.path.lstrip("/"))
    if not hostname or not username or not database or port is None:
        raise ValueError("DATABASE_URL must include username, hostname, port, and database")

    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    query = dict(query_pairs)
    sslmodes = [value.lower() for key, value in query_pairs if key.lower() == "sslmode"]
    if len(sslmodes) > 1:
        raise ValueError("DATABASE_URL must contain at most one sslmode")
    mode = sslmodes[0] if sslmodes else ("verify-full" if ssl_ca else "require")
    if mode not in {"require", "verify-ca", "verify-full"}:
        raise ValueError("DATABASE_URL sslmode must require encrypted PostgreSQL connections")
    query = {key: value for key, value in query.items() if key.lower() not in {"sslmode", "sslrootcert"}}
    query["sslmode"] = mode
    if ssl_ca:
        query["sslrootcert"] = ssl_ca
    # Normalize SQLAlchemy's driver-qualified scheme into a libpq URL.
    dsn = urlunsplit(("postgresql", parts.netloc, parts.path, urlencode(query), parts.fragment))
    return ParsedDatabaseUrl(dsn, bool(username), port, bool(database), mode)

def postgres_dsn(database_url: str, ssl_ca: str = "") -> str:
    """Compatibility helper returning the normalized encrypted libpq DSN."""
    return parse_database_url(database_url, ssl_ca).dsn


def connect(database_url: str, ssl_ca: str = ""):
    """Open one short lived psycopg 3 connection with mapping-like rows."""
    parsed = parse_database_url(database_url, ssl_ca)
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - installation/configuration error
        raise RuntimeError("PostgreSQL support requires psycopg[binary]") from exc
    try:
        installed = importlib.metadata.version("psycopg")
        numeric_version = tuple(int(part) for part in re.match(r"^(\d+)\.(\d+)(?:\.(\d+))?", installed).groups() if part is not None)
    except (importlib.metadata.PackageNotFoundError, AttributeError, ValueError):
        numeric_version = (0, 0)
    if numeric_version < (3, 2):
        raise RuntimeError("Installed psycopg version is too old; FIRENEXUS requires psycopg 3.2 or newer")
    return psycopg.connect(parsed.dsn, row_factory=dict_row)


class _HybridRow(dict):
    """Mapping row with SQLite-compatible integer indexing for acquisition code."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


def _hybrid_row(cursor):
    # Commands such as UPDATE/INSERT/DELETE without RETURNING have no result
    # columns. Psycopg can still ask the configured row factory for a maker.
    names = [column.name for column in (cursor.description or ())]
    return lambda values: _HybridRow(zip(names, values))


def _adapt_explicit_jsonb_params(query: str, params):
    """Wrap mapping/array values only where SQL explicitly casts a placeholder to JSONB."""
    if not isinstance(params, (tuple, list)) or not params:
        return params
    indexes = [len(re.findall(r"%s", query[:match.start()]))
               for match in re.finditer(r"%s\s*::\s*jsonb\b", query, flags=re.I)]
    if not indexes:
        return params
    adapted = list(params)
    needs_adapter = any(index < len(adapted) and isinstance(adapted[index], (dict, list)) for index in indexes)
    if not needs_adapter:
        return params
    try:
        from psycopg.types.json import Jsonb
    except ImportError as exc:  # pragma: no cover - deployment dependency guard
        raise RuntimeError("JSONB parameter support requires psycopg 3") from exc
    for index in indexes:
        if index < len(adapted) and isinstance(adapted[index], (dict, list)):
            adapted[index] = Jsonb(adapted[index])
    return tuple(adapted)


class _CursorAdapter:
    def __init__(self, cursor): self.cursor = cursor
    def fetchone(self): return self.cursor.fetchone()
    def fetchall(self): return self.cursor.fetchall()
    def fetchmany(self, size=1000): return self.cursor.fetchmany(size)
    def __iter__(self): return iter(self.cursor)


class AcquisitionConnection:
    """Small SQL compatibility layer for the acquisition manager's existing queries."""
    _replace = re.compile(r"INSERT\s+OR\s+REPLACE\s+INTO\s+downloads\s*\(([^)]+)\)\s*(VALUES\s*\([^;]+\))", re.I | re.S)

    def __init__(self, conn): self.conn = conn
    def __enter__(self): self.conn.__enter__(); return self
    def __exit__(self, *args): return self.conn.__exit__(*args)
    def execute(self, query, params=()):
        match = self._replace.search(query)
        if match:
            columns = [item.strip() for item in match.group(1).split(",")]
            keys = {"region_id", "source_id", "start_date", "end_date"}
            assignments = ",".join(f"{c}=EXCLUDED.{c}" for c in columns if c not in keys)
            query = self._replace.sub(f"INSERT INTO downloads ({match.group(1)}) {match.group(2)} ON CONFLICT (region_id,source_id,start_date,end_date) DO UPDATE SET {assignments}", query)
        query = re.sub(r"\bjobs\b", "acquisition_jobs", query, flags=re.I)
        query = re.sub(r"\bchunks\b", "acquisition_chunks", query, flags=re.I)
        query = re.sub(r"\bdownloads\b", "acquisition_downloads", query, flags=re.I)
        query = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", query, flags=re.I)
        query = query.replace("?", "%s")
        if re.search(r"INSERT\s+INTO\s+acquisition_jobs\b", query, flags=re.I):
            query = re.sub(r"VALUES\s*\((%s),\s*(%s)", r"VALUES (\1,\2::jsonb", query, count=1, flags=re.I)
        query = re.sub(r"pause_requested\s*=\s*0", "pause_requested=FALSE", query, flags=re.I)
        query = re.sub(r"pause_requested\s*=\s*1", "pause_requested=TRUE", query, flags=re.I)
        params = _adapt_explicit_jsonb_params(query, params)
        cursor = self.conn.cursor(row_factory=_hybrid_row)
        cursor.execute(query, params)
        return _CursorAdapter(cursor)
    def executemany(self, query, params):
        return _CursorAdapter(self.conn.cursor().executemany(query.replace("?", "%s"), params))


@contextmanager
def connection(database_url: str, ssl_ca: str = "") -> Iterator:
    conn = connect(database_url, ssl_ca)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def acquisition_connection(database_url: str, ssl_ca: str = ""):
    conn = connect(database_url, ssl_ca)
    adapter = AcquisitionConnection(conn)
    try:
        with adapter as active:
            yield active
    finally:
        conn.close()


def check_connection(database_url: str, ssl_ca: str = "") -> dict:
    """Backward-compatible alias that returns safe, read-only server details."""
    info = verify_readonly_connection(database_url, ssl_ca)
    return {**info, "postgis": info["postgis_version"]}


class DatabaseVerificationError(RuntimeError):
    """Safe categorized error; deliberately omits driver text and connection data."""

    def __init__(self, category: str, message: str):
        self.category = category
        self.safe_message = message
        super().__init__(message)


def classify_database_error(exc: Exception) -> tuple[str, str]:
    """Map driver/network failures to safe categories without returning raw text."""
    chain = []
    current = exc
    for _ in range(5):
        if current is None or current in chain:
            break
        chain.append(current)
        current = current.__cause__ or current.__context__
    text = " ".join(str(item) for item in chain).lower()
    sqlstates = {str(getattr(item, "sqlstate", "")).upper() for item in chain}
    type_names = {type(item).__name__.lower() for item in chain}

    if any("requires psycopg[binary]" in str(item).lower() for item in chain):
        return "driver_not_installed", "Install backend dependencies with `python -m pip install -r requirements.txt` using the same Python environment."
    if any("psycopg version is too old" in str(item).lower() for item in chain):
        return "driver_version_unsupported", "Upgrade backend dependencies; FIRENEXUS requires psycopg 3.2 or newer."
    if isinstance(exc, ValueError):
        return "invalid_database_url", "Check that DATABASE_URL has a PostgreSQL scheme, username, hostname, port, database, and TLS-enabled sslmode."
    if any(isinstance(item, socket.gaierror) for item in chain) or any(token in text for token in (
        "could not translate host name", "name or service not known", "temporary failure in name resolution",
        "nodename nor servname provided", "getaddrinfo failed", "no address associated with hostname",
    )):
        return "dns_resolution", "Check the Aiven hostname and DNS/network access from the backend runtime."
    if any(isinstance(item, ssl.SSLError) for item in chain) or any(token in text for token in (
        "certificate verify failed", "ssl error", "ssl syscall", "sslmode", "tls handshake",
        "server does not support ssl", "certificate authentication failed",
    )):
        return "tls_ssl_error", "Check Aiven TLS requirements, sslmode, and the configured CA certificate path. Keep SSL enabled."
    if "3D000" in sqlstates or any(token in text for token in ("database does not exist", "role does not exist", "unknown user")):
        return "database_or_user_error", "Check the database name and username in the backend DATABASE_URL against the Aiven service."
    if any(state and state.startswith("28") for state in sqlstates) or any(name in type_names for name in (
        "invalidpassword", "invalidauthorizationspecification", "invalidauthorization")) or any(token in text for token in (
        "password authentication failed", "authentication failed", "no password supplied", "authentication method")):
        return "authentication_failure", "Check the Aiven username/password and rotate the backend secret if it is stale."
    if any("postgis_full_version" in token or "postgis extension" in token for token in text.split(" ")) or any(token in text for token in (
        "function postgis_full_version() does not exist", "postgis is not available", "extension \"postgis\" is not installed")):
        return "postgis_unavailable", "Enable PostGIS for this Aiven database or confirm the connection targets the database where it is enabled."
    if any(isinstance(item, (TimeoutError, ConnectionRefusedError, ConnectionResetError)) for item in chain) or any(token in text for token in (
        "connection timed out", "timeout expired", "connection refused", "could not connect to server",
        "no route to host", "network is unreachable", "server closed the connection unexpectedly",
    )) or "operationalerror" in type_names:
        return "network_timeout_or_refusal", "Check Aiven service availability, allowed inbound access, firewall rules, port, and backend egress."
    if any(state for state in sqlstates) or any(name.endswith(("error", "exception")) for name in type_names):
        return "unexpected_sql_error", "The connection reached PostgreSQL but a read-only verification query failed; inspect server-side diagnostics without sharing secrets."
    return "unexpected_error", "Check backend runtime logs and Aiven service status; share only the category, never connection credentials."


def verify_readonly_connection(database_url: str, ssl_ca: str = "") -> dict:
    """Check Aiven connectivity and server capabilities using SELECT statements only."""
    try:
        parsed = parse_database_url(database_url, ssl_ca)
        with connection(database_url, ssl_ca) as conn:
            row = conn.execute("""SELECT current_database() AS database,
                current_setting('server_version') AS postgres_version,
                PostGIS_Full_Version() AS postgis_version,
                COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()), FALSE) AS ssl_enabled""").fetchone()
            return {
                "connected": True,
                "database": row["database"],
                "postgres_version": row["postgres_version"],
                "postgis_version": row["postgis_version"],
                "ssl_enabled": bool(row["ssl_enabled"]),
                "connection_config": {
                    "username_present": parsed.username_present,
                    "port": parsed.port,
                    "database_present": parsed.database_present,
                    "sslmode": parsed.sslmode,
                },
            }
    except Exception as exc:
        category, message = classify_database_error(exc)
        logger.error("Read-only database verification failed: category=%s", category)
        raise DatabaseVerificationError(category, message) from None
