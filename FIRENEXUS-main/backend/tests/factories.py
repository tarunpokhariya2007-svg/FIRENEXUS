"""Synthetic observations used ONLY to exercise algorithms inside tests.

These are deliberately artificial (round numbers on an arbitrary grid) and live
under ``tests/``; nothing in ``app/`` may import this module.
"""
from typing import Optional

from app.models.schemas import (
    DatasetMetadataSchema,
    FireObservationSchema,
)
from app.services.registry import DatasetRegistry

PLATFORM_SENSOR = {"Terra": "MODIS", "Aqua": "MODIS", "Suomi-NPP": "VIIRS", "NOAA-20": "VIIRS", "NOAA-21": "VIIRS"}


def obs(platform: str, lat: float, lon: float, date: str = "2020-01-01", time: str = "1200",
        frp: Optional[float] = 10.0, confidence: Optional[float] = 80.0, oid: Optional[str] = None) -> FireObservationSchema:
    return FireObservationSchema(
        id=oid or f"{platform}-{lat}-{lon}-{date}-{time}", source=PLATFORM_SENSOR[platform], platform=platform,
        latitude=lat, longitude=lon, acq_date=date, acq_time=time, frp=frp, confidence=confidence,
    )


def meta(dataset_id: str, sensor: str) -> DatasetMetadataSchema:
    return DatasetMetadataSchema(id=dataset_id, title=f"test {sensor}", sensor=sensor)


def registry_with(modis=(), viirs=()) -> DatasetRegistry:
    reg = DatasetRegistry()
    if modis:
        reg.register(meta("test-modis", "MODIS"), list(modis))
    if viirs:
        reg.register(meta("test-viirs", "VIIRS"), list(viirs))
    return reg
