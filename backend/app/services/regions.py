"""Persisted regions of interest and data-derived region coverage."""
import json
from pathlib import Path
from threading import RLock
from typing import Dict, List, Optional

from app.config import settings
from app.models.schemas import RegionDefinitionSchema, RegionSchema
from app.services.registry import DatasetRegistry

DEMO_REGIONS = [
    RegionDefinitionSchema(
        id="amazon-basin-brazil", name="Amazon Basin, Brazil", country="Brazil",
        boundingBox={"minLatitude": -18.2, "maxLatitude": 5.3, "minLongitude": -74.0, "maxLongitude": -44.0},
        boundaryNote="Approximate demonstration bounding box; not an authoritative basin or national boundary.",
    ),
    RegionDefinitionSchema(
        id="california-usa", name="California, USA", country="United States",
        boundingBox={"minLatitude": 32.5, "maxLatitude": 42.1, "minLongitude": -124.5, "maxLongitude": -114.1},
        boundaryNote="Approximate demonstration bounding box; not an authoritative state boundary.",
    ),
    RegionDefinitionSchema(
        id="southeastern-australia", name="Southeastern Australia", country="Australia",
        boundingBox={"minLatitude": -39.2, "maxLatitude": -27.9, "minLongitude": 140.9, "maxLongitude": 153.7},
        boundaryNote="Approximate demonstration bounding box; not an authoritative regional boundary.",
    ),
    RegionDefinitionSchema(
        id="uttarakhand-india", name="Uttarakhand, India", country="India",
        boundingBox={"minLatitude": 28.4, "maxLatitude": 31.5, "minLongitude": 77.5, "maxLongitude": 81.1},
        boundaryNote="Approximate demonstration bounding box; not an authoritative state boundary.",
    ),
]


class RegionStore:
    def __init__(self, data_dir: Optional[str] = None) -> None:
        self.path = Path(data_dir).resolve() / "regions.json" if data_dir else None
        self._regions: Dict[str, RegionDefinitionSchema] = {}
        self._lock = RLock()
        if self.path and self.path.is_file():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                self._regions = {r["id"]: RegionDefinitionSchema.model_validate(r) for r in raw}
            except (OSError, ValueError, KeyError, TypeError):
                self._regions = {}
        if not self._regions:
            self._regions = {r.id: r for r in DEMO_REGIONS}
            self._persist()

    def _persist(self) -> None:
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(json.dumps([r.model_dump(mode="json") for r in self._regions.values()], indent=2), encoding="utf-8")
            temp.replace(self.path)

    def list(self) -> List[RegionDefinitionSchema]:
        with self._lock:
            return list(self._regions.values())

    def get(self, region_id: str) -> Optional[RegionDefinitionSchema]:
        with self._lock:
            return self._regions.get(region_id)

    def upsert(self, definition: RegionDefinitionSchema) -> RegionDefinitionSchema:
        with self._lock:
            self._regions[definition.id] = definition
            self._persist()
            return definition

    def delete(self, region_id: str) -> bool:
        with self._lock:
            if region_id not in self._regions:
                return False
            del self._regions[region_id]
            self._persist()
            return True


def region_responses(store: RegionStore, registry: DatasetRegistry) -> List[RegionSchema]:
    rows = []
    for definition in store.list():
        box = definition.boundingBox
        coverage = registry.region_dataset_coverage((box.minLatitude, box.maxLatitude, box.minLongitude, box.maxLongitude))
        dates = list(coverage.values())
        rows.append(RegionSchema(
            **definition.model_dump(), datasetIds=sorted(coverage),
            dateCoverageStart=min((start for start, _ in dates), default=None),
            dateCoverageEnd=max((end for _, end in dates), default=None),
        ))
    return rows


region_store = RegionStore(settings.DATA_DIR)
