"""Dataset and job persistence with indexed, paged SQLite observation access."""
import json
import re
import sqlite3
import time
import hashlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

from app.models.schemas import (
    DatasetMetadataSchema, FireObservationSchema, HarmonizationParametersSchema,
    HarmonizationResultSchema, MODIS_PLATFORMS, VIIRS_PLATFORMS,
)
from app.config import settings
from app.services.database import connection as postgres_connection


@dataclass
class LoadedDataset:
    meta: DatasetMetadataSchema
    observations: List[FireObservationSchema] = field(default_factory=list)
    observations_path: Optional[Path] = None


class DatasetRegistry:
    def __init__(self, data_dir: Optional[str] = None, database_url: Optional[str] = None, ssl_ca: Optional[str] = None) -> None:
        self._datasets: Dict[str, LoadedDataset] = {}
        self._lock = RLock()
        self.data_dir = Path(data_dir).resolve() if data_dir else None
        self.database_url = settings.DATABASE_URL if database_url is None else database_url
        self.ssl_ca = settings.DATABASE_SSL_CA if ssl_ca is None else ssl_ca
        self.postgres = bool(self.database_url)
        self.db_path: Optional[Path] = None
        self._has_rtree = False
        if self.postgres:
            self._load_postgres_datasets()
        elif self.data_dir:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = self.data_dir / "observations.sqlite3"
            self._initialize_database()
            self._load_persisted()

    def _pg(self):
        return postgres_connection(self.database_url, self.ssl_ca)

    def _load_postgres_datasets(self) -> None:
        # Switching DATABASE_URL never silently imports local CSV/JSONL archives.
        with self._pg() as conn:
            if not conn.execute("SELECT to_regclass('public.datasets') AS name").fetchone()["name"]:
                raise RuntimeError("FIRENEXUS PostgreSQL schema is missing; run `python -m app.migrations upgrade` first")
            for row in conn.execute("SELECT metadata FROM datasets ORDER BY created_at"):
                raw = row["metadata"]
                self._datasets[raw["id"]] = LoadedDataset(meta=DatasetMetadataSchema.model_validate(raw))

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        if not self.db_path:
            raise RuntimeError("SQLite storage is not configured for this registry")
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _initialize_database(self) -> None:
        with self._connect() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS observations (
                row_id INTEGER PRIMARY KEY,
                dataset_id TEXT NOT NULL,
                observation_id TEXT NOT NULL,
                sensor TEXT NOT NULL,
                platform TEXT NOT NULL,
                acquisition_date TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                frp REAL,
                confidence REAL,
                payload TEXT NOT NULL,
                UNIQUE(dataset_id, observation_id)
            )""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_observations_dataset ON observations(dataset_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_observations_sensor ON observations(sensor)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_observations_platform ON observations(platform)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_observations_date ON observations(acquisition_date)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_observations_lat_lon ON observations(latitude, longitude)")
            try:
                conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS observations_rtree USING rtree(row_id, min_lon, max_lon, min_lat, max_lat)")
                conn.execute("""CREATE TRIGGER IF NOT EXISTS observations_rtree_insert AFTER INSERT ON observations BEGIN
                    INSERT OR REPLACE INTO observations_rtree VALUES (NEW.row_id, NEW.longitude, NEW.longitude, NEW.latitude, NEW.latitude);
                END""")
                conn.execute("""CREATE TRIGGER IF NOT EXISTS observations_rtree_delete AFTER DELETE ON observations BEGIN
                    DELETE FROM observations_rtree WHERE row_id = OLD.row_id;
                END""")
                self._has_rtree = True
            except sqlite3.OperationalError:
                # The ordinary latitude/longitude index remains available if SQLite
                # was built without its optional R*Tree module.
                self._has_rtree = False

    def _index_jsonl(self, dataset_id: str, path: Path, replace: bool = False) -> None:
        if self.postgres:
            self._index_jsonl_postgres(dataset_id, path, replace)
            return
        if not self.db_path:
            return
        with self._connect() as conn:
            if replace:
                conn.execute("DELETE FROM observations WHERE dataset_id = ?", (dataset_id,))
            batch = []
            with path.open("r", encoding="utf-8") as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    obs = FireObservationSchema.model_validate_json(line)
                    batch.append((
                        dataset_id, obs.id, obs.source, obs.platform, obs.acq_date,
                        obs.latitude, obs.longitude, obs.frp, obs.confidence,
                        obs.model_dump_json(),
                    ))
                    if len(batch) >= 1000:
                        conn.executemany("""INSERT OR IGNORE INTO observations
                            (dataset_id, observation_id, sensor, platform, acquisition_date,
                             latitude, longitude, frp, confidence, payload)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", batch)
                        batch.clear()
            if batch:
                conn.executemany("""INSERT OR IGNORE INTO observations
                    (dataset_id, observation_id, sensor, platform, acquisition_date,
                     latitude, longitude, frp, confidence, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", batch)

    def _index_jsonl_postgres(self, dataset_id: str, path: Path, replace: bool = False,
                               connection=None, meta: Optional[DatasetMetadataSchema] = None) -> None:
        if meta is None:
            loaded = self._datasets.get(dataset_id)
            if loaded is None:
                raise RuntimeError("Dataset metadata must be registered before observations")
            meta = loaded.meta
        if connection is None:
            with self._pg() as conn:
                return self._index_jsonl_postgres(dataset_id, path, replace, connection=conn, meta=meta)
        metadata_json = meta.model_dump_json()
        archived_source_path = path.parent / "original.csv"
        source_path = meta.provenance.get("sourcePath")
        checksum = meta.provenance.get("sourceSha256")
        if archived_source_path.is_file():
            if not source_path:
                source_path = str(archived_source_path)
        if not checksum and archived_source_path.is_file():
            digest = hashlib.sha256()
            with archived_source_path.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
            checksum = digest.hexdigest()
        conn = connection
        conn.execute("""INSERT INTO datasets(id,title,sensor,satellite,source_filename,source_path,source_checksum_sha256,
                record_count,imported_at,metadata,provenance)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)
                ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,sensor=EXCLUDED.sensor,satellite=EXCLUDED.satellite,
                source_filename=EXCLUDED.source_filename,source_path=EXCLUDED.source_path,
                source_checksum_sha256=EXCLUDED.source_checksum_sha256,record_count=EXCLUDED.record_count,
                imported_at=EXCLUDED.imported_at,metadata=EXCLUDED.metadata,provenance=EXCLUDED.provenance""",
                (meta.id, meta.title, meta.sensor, meta.satellite, meta.sourceFilename,
                 source_path, checksum, int(meta.recordCount or 0),
                 meta.importedAt, metadata_json, json.dumps(meta.provenance)))
        if replace:
            conn.execute("DELETE FROM fire_observations WHERE dataset_id=%s", (dataset_id,))
            conn.execute("DELETE FROM data_quality_reports WHERE dataset_id=%s", (dataset_id,))
        batch = []
        with path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                obs = FireObservationSchema.model_validate_json(line)
                cols = {str(key).lower(): value for key, value in obs.source_columns.items()}
                nasa_id = cols.get("id") or cols.get("source_id") or cols.get("nasa_source_id")
                try:
                    source_row_number = int(obs.id.rsplit(":", 1)[-1])
                except ValueError:
                    source_row_number = line_number
                acquired = f"{obs.acq_date} {obs.acq_time[:2]}:{obs.acq_time[2:]}:00+00"
                batch.append((dataset_id, obs.id, nasa_id, obs.source, obs.satellite, obs.platform,
                              obs.acq_date, f"{obs.acq_time[:2]}:{obs.acq_time[2:]}:00", acquired,
                              obs.latitude, obs.longitude, obs.frp, obs.confidence, obs.confidence_class,
                              meta.sourceFilename, source_row_number, json.dumps(obs.source_columns), obs.model_dump_json()))
                if len(batch) >= 1000:
                    self._insert_observation_batch(conn, batch)
                    batch.clear()
        if batch:
            self._insert_observation_batch(conn, batch)
        conn.execute("INSERT INTO data_quality_reports(dataset_id,report) VALUES (%s,%s::jsonb)",
                     (dataset_id, json.dumps(meta.qualityReport)))

    def register_postgres_persisted(self, meta: DatasetMetadataSchema, observations_path: Path) -> None:
        """Update this process's view after an external transaction committed the dataset."""
        with self._lock:
            self._datasets[meta.id] = LoadedDataset(meta=meta, observations_path=observations_path)

    @staticmethod
    def _insert_observation_batch(conn, batch) -> None:
        sql = """INSERT INTO fire_observations(dataset_id,observation_id,nasa_source_id,sensor,satellite,platform,
            acquisition_date,acquisition_time_utc,acquired_at,latitude,longitude,geom,frp,confidence_numeric,confidence_class,
            source_filename,source_row_number,source_columns,payload)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)
            ON CONFLICT(dataset_id,observation_id) DO NOTHING"""
        params = [(r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10],r[10],r[9],r[11],r[12],r[13],r[14],r[15],r[16],r[17]) for r in batch]
        conn.cursor().executemany(sql, params)

    def _load_persisted(self) -> None:
        for metadata_path in self.data_dir.glob("fir-*/metadata.json"):
            try:
                meta = DatasetMetadataSchema.model_validate_json(metadata_path.read_text(encoding="utf-8"))
                observations_path = metadata_path.parent / "observations.jsonl"
                if observations_path.is_file():
                    self._datasets[meta.id] = LoadedDataset(meta=meta, observations_path=observations_path)
                    with self._connect() as conn:
                        count = conn.execute("SELECT COUNT(*) FROM observations WHERE dataset_id = ?", (meta.id,)).fetchone()[0]
                    if count < int(meta.recordCount or 0):
                        self._index_jsonl(meta.id, observations_path)
            except (OSError, ValueError, sqlite3.Error):
                # Ignore incomplete/corrupt dataset directories; no observation is synthesized.
                continue

    def register(self, meta: DatasetMetadataSchema, observations: List[FireObservationSchema]) -> None:
        with self._lock:
            self._datasets[meta.id] = LoadedDataset(meta=meta, observations=list(observations))

    def register_persisted(self, meta: DatasetMetadataSchema, observations_path: Path) -> None:
        with self._lock:
            if self.postgres:
                self._datasets[meta.id] = LoadedDataset(meta=meta, observations_path=observations_path)
                try:
                    self._index_jsonl(meta.id, observations_path, replace=True)
                except Exception:
                    self._datasets.pop(meta.id, None)
                    raise
                return
            self._index_jsonl(meta.id, observations_path, replace=True)
            self._datasets[meta.id] = LoadedDataset(meta=meta, observations_path=observations_path)

    def unregister(self, dataset_id: str) -> bool:
        with self._lock:
            loaded = self._datasets.pop(dataset_id, None)
            if loaded is None:
                return False
            if self.db_path:
                with self._connect() as conn:
                    conn.execute("DELETE FROM observations WHERE dataset_id = ?", (dataset_id,))
            if self.postgres:
                with self._pg() as conn:
                    conn.execute("DELETE FROM datasets WHERE id=%s", (dataset_id,))
            if loaded.observations_path and self.data_dir:
                folder = loaded.observations_path.parent.resolve()
                if folder.parent == self.data_dir and folder.name == dataset_id:
                    import shutil
                    shutil.rmtree(folder)
            return True

    def clear(self) -> None:
        # Clear this process's active registry view. Persisted datasets return on restart.
        with self._lock:
            self._datasets.clear()

    def datasets(self) -> List[DatasetMetadataSchema]:
        with self._lock:
            return [d.meta for d in self._datasets.values()]

    def get_dataset(self, dataset_id: str) -> Optional[DatasetMetadataSchema]:
        with self._lock:
            loaded = self._datasets.get(dataset_id)
            return loaded.meta if loaded else None

    def _where(
        self, dataset_ids: Sequence[str], sensor: Optional[str], platform: Optional[str],
        start_date: Optional[str], end_date: Optional[str], bbox: Optional[Tuple[float, float, float, float]],
        min_frp: Optional[float], max_frp: Optional[float], min_confidence: Optional[float],
    ) -> Tuple[str, list]:
        clauses, args = [], []
        clauses.append("o.dataset_id IN (" + ",".join("?" for _ in dataset_ids) + ")")
        args.extend(dataset_ids)
        for col, value in (("sensor", sensor), ("platform", platform)):
            if value is not None:
                clauses.append(f"o.{col} = ?")
                args.append(value)
        if start_date:
            clauses.append("o.acquisition_date >= ?")
            args.append(start_date)
        if end_date:
            clauses.append("o.acquisition_date <= ?")
            args.append(end_date)
        if bbox:
            min_lat, max_lat, min_lon, max_lon = bbox
            if self._has_rtree:
                clauses.extend(["g.min_lon <= ?", "g.max_lon >= ?", "g.min_lat <= ?", "g.max_lat >= ?"])
                args.extend([max_lon, min_lon, max_lat, min_lat])
            clauses.extend(["o.latitude BETWEEN ? AND ?", "o.longitude BETWEEN ? AND ?"])
            args.extend([min_lat, max_lat, min_lon, max_lon])
        if min_frp is not None:
            clauses.append("(o.frp IS NULL OR o.frp >= ?)")
            args.append(min_frp)
        if max_frp is not None:
            clauses.append("(o.frp IS NULL OR o.frp <= ?)")
            args.append(max_frp)
        if min_confidence is not None:
            clauses.append("(o.confidence IS NULL OR o.confidence >= ?)")
            args.append(min_confidence)
        return " AND ".join(clauses), args

    def _query_parts(self, bbox) -> str:
        return "observations o JOIN observations_rtree g ON g.row_id = o.row_id" if bbox and self._has_rtree else "observations o"

    @staticmethod
    def _where_postgres(dataset_ids, sensor, platform, start_date, end_date, bbox, min_frp, max_frp, min_confidence):
        clauses, args = ["o.dataset_id = ANY(%s)"], [list(dataset_ids)]
        for column, value in (("sensor", sensor), ("platform", platform)):
            if value is not None:
                clauses.append(f"o.{column}=%s")
                args.append(value)
        if start_date:
            clauses.append("o.acquisition_date >= %s")
            args.append(start_date)
        if end_date:
            clauses.append("o.acquisition_date <= %s")
            args.append(end_date)
        if bbox:
            min_lat, max_lat, min_lon, max_lon = bbox
            clauses.extend(["o.geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)", "ST_Intersects(o.geom, ST_MakeEnvelope(%s,%s,%s,%s,4326))"])
            env = [min_lon, min_lat, max_lon, max_lat]
            args.extend(env + env)
        if min_frp is not None:
            clauses.append("(o.frp IS NULL OR o.frp >= %s)"); args.append(min_frp)
        if max_frp is not None:
            clauses.append("(o.frp IS NULL OR o.frp <= %s)"); args.append(max_frp)
        if min_confidence is not None:
            clauses.append("(o.confidence_numeric IS NULL OR o.confidence_numeric >= %s)"); args.append(min_confidence)
        return " AND ".join(clauses), args

    def query_observations(
        self, *, sensor: Optional[str] = None, platform: Optional[str] = None,
        start_date: Optional[str] = None, end_date: Optional[str] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        min_frp: Optional[float] = None, max_frp: Optional[float] = None,
        min_confidence: Optional[float] = None, dataset_ids: Optional[Sequence[str]] = None,
        offset: int = 0, limit: Optional[int] = None,
    ) -> List[FireObservationSchema]:
        with self._lock:
            active_ids = list(self._datasets) if self.postgres else [i for i, ds in self._datasets.items() if ds.observations_path]
            memory = [] if self.postgres else [(i, ds.observations) for i, ds in self._datasets.items() if not ds.observations_path]
        ids = list(dataset_ids) if dataset_ids is not None else active_ids
        ids = [i for i in ids if i in active_ids]
        out: List[FireObservationSchema] = []
        if self.postgres and ids:
            where, args = self._where_postgres(ids, sensor, platform, start_date, end_date, bbox, min_frp, max_frp, min_confidence)
            sql = f"SELECT o.payload FROM fire_observations o WHERE {where} ORDER BY o.row_id"
            if limit is not None:
                sql += " LIMIT %s OFFSET %s"; args.extend([limit, offset])
            elif offset:
                sql += " OFFSET %s"; args.append(offset)
            with self._pg() as conn:
                return [FireObservationSchema.model_validate(row["payload"]) for row in conn.execute(sql, args)]
        if ids and self.db_path:
            where, args = self._where(ids, sensor, platform, start_date, end_date, bbox, min_frp, max_frp, min_confidence)
            sql = f"SELECT o.payload FROM {self._query_parts(bbox)} WHERE {where} ORDER BY o.row_id"
            if limit is not None and not memory:
                sql += " LIMIT ? OFFSET ?"
                args += [limit, offset]
            elif offset and not memory:
                sql += " LIMIT -1 OFFSET ?"
                args.append(offset)
            with self._connect() as conn:
                for row in conn.execute(sql, args):
                    out.append(FireObservationSchema.model_validate_json(row[0]))
        if dataset_ids is None or memory:
            requested_memory_ids = set(dataset_ids) if dataset_ids is not None else None
            for memory_id, rows in memory:
                if requested_memory_ids is not None and memory_id not in requested_memory_ids:
                    continue
                for obs in rows:
                    if sensor and obs.source != sensor or platform and obs.platform != platform:
                        continue
                    if start_date and obs.acq_date < start_date or end_date and obs.acq_date > end_date:
                        continue
                    if bbox and not (bbox[0] <= obs.latitude <= bbox[1] and bbox[2] <= obs.longitude <= bbox[3]):
                        continue
                    if min_frp is not None and obs.frp is not None and obs.frp < min_frp:
                        continue
                    if max_frp is not None and obs.frp is not None and obs.frp > max_frp:
                        continue
                    if min_confidence is not None and obs.confidence is not None and obs.confidence < min_confidence:
                        continue
                    out.append(obs)
        return out[offset:offset + limit] if limit is not None and memory else out

    def count_query(
        self, *, sensor: Optional[str] = None, platform: Optional[str] = None,
        start_date: Optional[str] = None, end_date: Optional[str] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        min_frp: Optional[float] = None, max_frp: Optional[float] = None,
        min_confidence: Optional[float] = None, dataset_ids: Optional[Sequence[str]] = None,
    ) -> int:
        with self._lock:
            active_ids = list(self._datasets) if self.postgres else [i for i, ds in self._datasets.items() if ds.observations_path]
            memory = [] if self.postgres else [(i, ds.observations) for i, ds in self._datasets.items() if not ds.observations_path]
        ids = [i for i in (list(dataset_ids) if dataset_ids is not None else active_ids) if i in active_ids]
        total = 0
        if self.postgres and ids:
            where, args = self._where_postgres(ids, sensor, platform, start_date, end_date, bbox, min_frp, max_frp, min_confidence)
            with self._pg() as conn:
                total = int(conn.execute(f"SELECT COUNT(*) AS n FROM fire_observations o WHERE {where}", args).fetchone()["n"])
            return total
        if ids and self.db_path:
            where, args = self._where(ids, sensor, platform, start_date, end_date, bbox, min_frp, max_frp, min_confidence)
            with self._connect() as conn:
                total += conn.execute(f"SELECT COUNT(*) FROM {self._query_parts(bbox)} WHERE {where}", args).fetchone()[0]
        if dataset_ids is None or memory:
            memory_ids = set(dataset_ids) if dataset_ids is not None else None
            total += sum(1 for dataset_id, rows in memory if memory_ids is None or dataset_id in memory_ids for o in rows if
                (sensor is None or o.source == sensor) and (platform is None or o.platform == platform) and
                (start_date is None or o.acq_date >= start_date) and (end_date is None or o.acq_date <= end_date) and
                (bbox is None or bbox[0] <= o.latitude <= bbox[1] and bbox[2] <= o.longitude <= bbox[3]) and
                (min_frp is None or o.frp is None or o.frp >= min_frp) and
                (max_frp is None or o.frp is None or o.frp <= max_frp) and
                (min_confidence is None or o.confidence is None or o.confidence >= min_confidence))
        return int(total)

    def iter_observations(self, sensor: Optional[str] = None) -> Iterator[FireObservationSchema]:
        # Kept as a streaming alternative for read-only consumers; algorithms that
        # need cross-sensor indexing can still opt into observations() explicitly.
        with self._lock:
            ids = list(self._datasets) if self.postgres else [i for i, ds in self._datasets.items() if ds.observations_path]
            memory = [] if self.postgres else [obs for ds in self._datasets.values() if not ds.observations_path for obs in ds.observations]
        if self.postgres and ids:
            where, args = self._where_postgres(ids, sensor, None, None, None, None, None, None, None)
            with self._pg() as conn:
                cursor = conn.execute(f"SELECT o.payload FROM fire_observations o WHERE {where} ORDER BY o.row_id", args)
                while batch := cursor.fetchmany(1000):
                    for row in batch:
                        yield FireObservationSchema.model_validate(row["payload"])
            return
        if ids and self.db_path:
            where, args = self._where(ids, sensor, None, None, None, None, None, None, None)
            with self._connect() as conn:
                cursor = conn.execute(f"SELECT o.payload FROM observations o WHERE {where} ORDER BY o.row_id", args)
                while batch := cursor.fetchmany(1000):
                    for row in batch:
                        yield FireObservationSchema.model_validate_json(row[0])
        for obs in memory:
            if sensor is None or obs.source == sensor:
                yield obs

    def observations(self, sensor: Optional[str] = None) -> List[FireObservationSchema]:
        return list(self.iter_observations(sensor))

    def observation_page(self, dataset_id: str, offset: int = 0, limit: int = 100) -> List[FireObservationSchema]:
        with self._lock:
            loaded = self._datasets.get(dataset_id)
        if loaded is None:
            raise KeyError(dataset_id)
        return self.query_observations(dataset_ids=[dataset_id], offset=offset, limit=limit)

    def count_by_platform(self) -> Dict[str, int]:
        with self._lock:
            ids = list(self._datasets) if self.postgres else [i for i, ds in self._datasets.items() if ds.observations_path]
            memory = [] if self.postgres else [obs for ds in self._datasets.values() if not ds.observations_path for obs in ds.observations]
        counts: Dict[str, int] = {}
        if self.postgres and ids:
            with self._pg() as conn:
                for row in conn.execute("SELECT platform, COUNT(*) AS n FROM fire_observations WHERE dataset_id=ANY(%s) GROUP BY platform", (ids,)):
                    counts[row["platform"]] = int(row["n"])
            return counts
        if ids and self.db_path:
            placeholders = ",".join("?" for _ in ids)
            with self._connect() as conn:
                for row in conn.execute(f"SELECT platform, COUNT(*) n FROM observations WHERE dataset_id IN ({placeholders}) GROUP BY platform", ids):
                    counts[row["platform"]] = row["n"]
        for obs in memory:
            counts[obs.platform] = counts.get(obs.platform, 0) + 1
        return counts

    def count_observations(self, sensor: str) -> int:
        return self.count_query(sensor=sensor)

    def region_dataset_coverage(self, bbox: Tuple[float, float, float, float]) -> Dict[str, Tuple[str, str]]:
        with self._lock:
            active_ids = list(self._datasets)
            memory = [] if self.postgres else [(i, ds.observations) for i, ds in self._datasets.items() if not ds.observations_path]
        coverage: Dict[str, Tuple[str, str]] = {}
        if self.postgres and active_ids:
            where, args = self._where_postgres(active_ids, None, None, None, None, bbox, None, None, None)
            with self._pg() as conn:
                for row in conn.execute(f"SELECT o.dataset_id, MIN(o.acquisition_date)::text AS lo, MAX(o.acquisition_date)::text AS hi FROM fire_observations o WHERE {where} GROUP BY o.dataset_id", args):
                    coverage[row["dataset_id"]] = (row["lo"], row["hi"])
            return coverage
        if active_ids and self.db_path:
            where, args = self._where(active_ids, None, None, None, None, bbox, None, None, None)
            with self._connect() as conn:
                for row in conn.execute(f"SELECT o.dataset_id, MIN(o.acquisition_date) lo, MAX(o.acquisition_date) hi FROM {self._query_parts(bbox)} WHERE {where} GROUP BY o.dataset_id", args):
                    coverage[row["dataset_id"]] = (row["lo"], row["hi"])
        for dataset_id, rows in memory:
            dates = [o.acq_date for o in rows if bbox[0] <= o.latitude <= bbox[1] and bbox[2] <= o.longitude <= bbox[3]]
            if dates:
                coverage[dataset_id] = (min(dates), max(dates))
        return coverage

    def dataset_ids_for(self, sensor: str) -> List[str]:
        with self._lock:
            return [d.meta.id for d in self._datasets.values() if d.meta.sensor == sensor]

    def is_loaded(self, sensor: str) -> bool:
        return len(self.dataset_ids_for(sensor)) > 0

    def platform_available(self, platform: str) -> bool:
        return self.count_by_platform().get(platform, 0) > 0

    @staticmethod
    def sensor_of(platform: str) -> str:
        if platform in MODIS_PLATFORMS:
            return "MODIS"
        if platform in VIIRS_PLATFORMS:
            return "VIIRS"
        raise ValueError(f"Unknown platform: {platform}")


class JobStore:
    """Completed and in-progress harmonization jobs persisted as JSON records."""

    _job_id = re.compile(r"^job-[a-f0-9]{8,64}$")

    def __init__(self, data_dir: Optional[str] = None, database_url: Optional[str] = None, ssl_ca: Optional[str] = None) -> None:
        self._jobs: Dict[str, dict] = {}
        self._order: List[str] = []
        self._lock = RLock()
        self.jobs_dir = Path(data_dir).resolve() / "jobs" if data_dir else None
        self.database_url = settings.DATABASE_URL if database_url is None else database_url
        self.ssl_ca = settings.DATABASE_SSL_CA if ssl_ca is None else ssl_ca
        self.postgres = bool(self.database_url)
        if self.postgres:
            self._load_postgres()
        elif self.jobs_dir:
            self.jobs_dir.mkdir(parents=True, exist_ok=True)
            self._load()

    def _load_postgres(self) -> None:
        with postgres_connection(self.database_url, self.ssl_ca) as conn:
            if not conn.execute("SELECT to_regclass('public.harmonization_jobs') AS name").fetchone()["name"]:
                raise RuntimeError("FIRENEXUS PostgreSQL schema is missing; run `python -m app.migrations upgrade` first")
            for row in conn.execute("SELECT id,params,result,created_at FROM harmonization_jobs ORDER BY created_at"):
                created = row["created_at"].timestamp()
                entry = {"result": HarmonizationResultSchema.model_validate(row["result"]),
                         "params": HarmonizationParametersSchema.model_validate(row["params"]), "createdAt": created}
                self._jobs[row["id"]] = entry
                self._order.append(row["id"])

    def _load(self) -> None:
        loaded = []
        for path in sorted(self.jobs_dir.glob("job-*.json"), key=lambda p: p.stat().st_mtime_ns):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                job_id = raw["result"]["jobId"]
                if not self._job_id.fullmatch(job_id):
                    continue
                created_at = float(raw.get("createdAt", path.stat().st_mtime))
                loaded.append((created_at, job_id, {
                    "result": HarmonizationResultSchema.model_validate(raw["result"]),
                    "params": HarmonizationParametersSchema.model_validate(raw["params"]),
                    "createdAt": created_at,
                }))
            except (OSError, ValueError, KeyError, TypeError):
                continue
        for _, job_id, entry in sorted(loaded, key=lambda item: item[0]):
            self._jobs[job_id] = entry
            self._order.append(job_id)

    def save(self, job_id: str, result, params) -> None:
        with self._lock:
            if job_id not in self._jobs:
                self._order.append(job_id)
                created_at = time.time()
            else:
                created_at = self._jobs[job_id].get("createdAt", time.time())
            self._jobs[job_id] = {"result": result, "params": params, "createdAt": created_at}
            if self.postgres and self._job_id.fullmatch(job_id):
                result_json = result.model_dump(mode="json")
                params_json = params.model_dump(mode="json")
                from datetime import datetime, timezone
                with postgres_connection(self.database_url, self.ssl_ca) as conn:
                    conn.execute("""INSERT INTO harmonization_jobs(id,status,params,result,created_at)
                        VALUES (%s,%s,%s::jsonb,%s::jsonb,%s)
                        ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,params=EXCLUDED.params,result=EXCLUDED.result""",
                        (job_id, result.status, json.dumps(params_json), json.dumps(result_json), datetime.fromtimestamp(created_at, timezone.utc)))
                    for excerpt in result.sampleMatches:
                        details = excerpt.model_dump(mode="json")
                        conn.execute("""INSERT INTO harmonized_observations(job_id,cluster_id,status,geom,details)
                            VALUES (%s,%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),%s::jsonb)
                            ON CONFLICT(job_id,cluster_id) DO UPDATE SET status=EXCLUDED.status,geom=EXCLUDED.geom,details=EXCLUDED.details""",
                            (job_id, excerpt.clusterId, excerpt.status, excerpt.longitude, excerpt.latitude, json.dumps(details)))
            if self.jobs_dir and self._job_id.fullmatch(job_id):
                payload = {"createdAt": created_at, "result": result.model_dump(mode="json"), "params": params.model_dump(mode="json")}
                target = self.jobs_dir / f"{job_id}.json"
                temp = self.jobs_dir / f".{job_id}.tmp"
                temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                temp.replace(target)

    def get(self, job_id: str):
        with self._lock:
            entry = self._jobs.get(job_id)
            return entry["result"] if entry else None

    def get_entry(self, job_id: str):
        with self._lock:
            return self._jobs.get(job_id)

    def latest_completed(self):
        with self._lock:
            for job_id in reversed(self._order):
                entry = self._jobs[job_id]
                if entry["result"].status == "completed":
                    return entry
            return None

    def clear(self) -> None:
        with self._lock:
            self._jobs.clear()
            self._order.clear()


from app.config import settings

registry = DatasetRegistry(settings.DATA_DIR)
job_store = JobStore(settings.DATA_DIR)
