"""Small versioned SQL migration runner (upgrade/downgrade; no data import)."""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from app.config import settings
from app.services.database import connection

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION_PATTERN = re.compile(r"^(\d{3})_[a-z0-9_]+\.(up|down)\.sql$")


def execute_script(conn, script: str) -> None:
    for statement in script.split(";"):
        if statement.strip():
            conn.execute(statement)


def migration_files() -> list[tuple[int, Path, Path]]:
    ups = {}
    downs = {}
    for path in MIGRATIONS_DIR.glob("*.sql"):
        match = MIGRATION_PATTERN.match(path.name)
        if not match:
            continue
        target = ups if match.group(2) == "up" else downs
        target[int(match.group(1))] = path
    if set(ups) != set(downs):
        raise RuntimeError("Every migration must have matching .up.sql and .down.sql files")
    return [(version, ups[version], downs[version]) for version in sorted(ups)]


def upgrade(database_url: str, ssl_ca: str = "") -> list[int]:
    applied = []
    with connection(database_url, ssl_ca) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        current = {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}
        for version, up, _ in migration_files():
            if version in current:
                continue
            # PostGIS is provisioned by Aiven here; validate it without changing
            # extension ownership, then apply app-owned schema in one transaction.
            if version == 1:
                try:
                    conn.execute("SELECT PostGIS_Full_Version()").fetchone()
                except Exception as exc:
                    raise RuntimeError("PostGIS must be enabled on the target database before migration") from exc
            execute_script(conn, up.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (version,))
            applied.append(version)
    return applied


def downgrade(database_url: str, ssl_ca: str = "", target: int = 0) -> list[int]:
    reverted = []
    with connection(database_url, ssl_ca) as conn:
        current = {row["version"] for row in conn.execute("SELECT version FROM schema_migrations ORDER BY version DESC")}
        for version, _, down in reversed(migration_files()):
            if version not in current or version <= target:
                continue
            execute_script(conn, down.read_text(encoding="utf-8"))
            conn.execute("DELETE FROM schema_migrations WHERE version=%s", (version,))
            reverted.append(version)
    return reverted


def main() -> None:
    parser = argparse.ArgumentParser(description="FIRENEXUS PostgreSQL schema migrations; never imports local data.")
    parser.add_argument("action", choices=("upgrade", "downgrade"))
    parser.add_argument("--target", type=int, default=0, help="For downgrade, retain migrations through this version.")
    args = parser.parse_args()
    if not settings.DATABASE_URL:
        parser.error("Set backend DATABASE_URL before running migrations")
    changed = upgrade(settings.DATABASE_URL, settings.DATABASE_SSL_CA) if args.action == "upgrade" else downgrade(settings.DATABASE_URL, settings.DATABASE_SSL_CA, args.target)
    print(f"{args.action} complete; changed migration versions: {changed}")


if __name__ == "__main__":
    main()
