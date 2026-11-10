"""Regression coverage for row factories on PostgreSQL commands/cursors."""
from types import SimpleNamespace

from app.services.database import AcquisitionConnection


class FakeCursor:
    def __init__(self, row_factory):
        self.row_factory = row_factory
        self.description = None
        self.rows = []
        self.row_maker = None

    def execute(self, query, params=()):
        normalized = query.strip().upper()
        if normalized.startswith("SELECT"):
            self.description = [SimpleNamespace(name="id"), SimpleNamespace(name="value")]
            self.rows = [(7, "selected")] if "WHERE" not in normalized else []
        elif "RETURNING" in normalized:
            self.description = [SimpleNamespace(name="id"), SimpleNamespace(name="value")]
            self.rows = [(8, "returned")]
        else:
            self.description = None
            self.rows = []
        # Psycopg configures the row maker using the command's result metadata.
        self.row_maker = self.row_factory(self)
        return self

    def fetchone(self):
        if not self.rows:
            return None
        return self.row_maker(self.rows.pop(0))

    def fetchall(self):
        rows, self.rows = self.rows, []
        return [self.row_maker(row) for row in rows]

    def fetchmany(self, size=1000):
        rows, self.rows = self.rows[:size], self.rows[size:]
        return [self.row_maker(row) for row in rows]

    def __iter__(self):
        return iter(self.fetchall())


class FakeConnection:
    def cursor(self, row_factory=None):
        self.last_cursor = FakeCursor(row_factory)
        return self.last_cursor


def adapter():
    connection = FakeConnection()
    return AcquisitionConnection(connection), connection


def test_select_rows_preserve_mapping_and_integer_access():
    db, _ = adapter()
    row = db.execute("SELECT id, value FROM example").fetchone()
    assert row["id"] == 7
    assert row[0] == 7
    assert row[1] == "selected"


def test_select_zero_rows_preserves_description_without_error():
    db, _ = adapter()
    assert db.execute("SELECT id, value FROM example WHERE id=?", (99,)).fetchone() is None


def test_update_insert_and_delete_without_returning_accept_no_description():
    db, raw = adapter()
    for statement in (
        "UPDATE example SET value=? WHERE id=?",
        "INSERT INTO example(id, value) VALUES (?, ?)",
        "DELETE FROM example WHERE id=?",
    ):
        cursor = db.execute(statement, ("value", 7))
        assert raw.last_cursor.description is None
        assert cursor.fetchone() is None
        assert cursor.fetchall() == []


def test_insert_and_update_returning_build_hybrid_rows():
    db, _ = adapter()
    inserted = db.execute("INSERT INTO example(value) VALUES (?) RETURNING id, value", ("returned",)).fetchone()
    updated = db.execute("UPDATE example SET value=? RETURNING id, value", ("returned",)).fetchone()
    for row in (inserted, updated):
        assert row["id"] == 8
        assert row[0] == 8
        assert row["value"] == "returned"
