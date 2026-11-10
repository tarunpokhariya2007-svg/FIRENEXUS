"""Guards that make sure fabricated scientific data cannot reappear."""
import os
import re

import pytest

from app.services.registry import job_store, registry

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_APP = os.path.join(HERE, "..", "app")
FRONTEND_SRC = os.path.join(HERE, "..", "..", "frontend", "src")

BANNED_TOKENS = [
    "RAW_OBSERVATIONS", "generateSampleHotspots", "generateCalendarMatrix", "generateTemporalData",
    "generateSensorComparisonData", "generateDatasetsMetadata", "DEMO_KEY_PUBLIC_SCIENCE",
    "18667540", "18,667,540", "9418290", "9,418,290", "4891120", "4,891,120", "13365220", "5302320",
    "Rostova", "E. Vance", "10.5067/FIRMS/FNX", "FNX-REP", "cerrado_boundary_v3", "BR-88410",
    "FNX-2024-0819", "MOD-2024-0819", "VII-2024-0819", "CR-2024-0", "FNX_HARMONIZED",
]
BANNED_PATTERNS = [r"Math\.random", r"^\s*(import|from)\s+random\b"]


def _source_files(root, exts):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "__pycache__", "dist")]
        for f in files:
            if f.endswith(exts):
                yield os.path.join(base, f)


def _scan(root, exts):
    hits = []
    if not os.path.isdir(root):
        return hits
    for path in _source_files(root, exts):
        text = open(path, encoding="utf-8").read()
        for token in BANNED_TOKENS:
            if token in text:
                hits.append((os.path.relpath(path, root), token))
        for pat in BANNED_PATTERNS:
            if re.search(pat, text, re.MULTILINE):
                hits.append((os.path.relpath(path, root), pat))
    return hits


def test_backend_source_has_no_fabricated_data():
    assert _scan(BACKEND_APP, (".py",)) == []


def test_frontend_source_has_no_fabricated_data():
    assert _scan(FRONTEND_SRC, (".ts", ".tsx")) == []


def test_default_registry_and_job_store_start_empty():
    assert registry.datasets() == [] and registry.observations() == []
    assert job_store.latest_completed() is None


def test_no_placeholder_firms_key_default():
    from app.config import settings
    assert settings.FIRMS_MAP_KEY == "" or settings.FIRMS_MAP_KEY != "DEMO_KEY_PUBLIC_SCIENCE"
