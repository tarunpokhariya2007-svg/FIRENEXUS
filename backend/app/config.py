"""Application configuration.

All values can be overridden through environment variables so that the
deployment environment (and the future NASA data integration) stays
configurable without code changes.
"""
import os
from dataclasses import dataclass, field

_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _split_csv(value: str) -> list:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    PROJECT_NAME: str = "FIRENEXUS Earth Observation Platform"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    # NASA FIRMS MAP_KEY. Empty until a real key is configured; never a placeholder.
    FIRMS_MAP_KEY: str = field(default_factory=lambda: os.getenv("FIRMS_MAP_KEY", ""))
    DATA_DIR: str = field(default_factory=lambda: os.getenv("FIRENEXUS_DATA_DIR", os.path.join(_BACKEND_ROOT, "data")))
    MAX_UPLOAD_BYTES: int = field(default_factory=lambda: int(os.getenv("FIRENEXUS_MAX_UPLOAD_BYTES", str(100 * 1024 * 1024))))
    CORS_ORIGINS: list = field(
        default_factory=lambda: _split_csv(
            os.getenv("FIRENEXUS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
        )
    )


settings = Settings()
