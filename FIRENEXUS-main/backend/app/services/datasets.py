"""Dataset inventory and availability, derived from the registry."""
from app.config import settings
from app.models.schemas import (
    DatasetInventoryResponse,
    DatasetStatusResponse,
    SensorAvailability,
)
from app.services.harmonization import get_readiness
from app.services.registry import DatasetRegistry
from app.services.temporal_analytics import NO_DATA_MESSAGE


def get_inventory(registry: DatasetRegistry) -> DatasetInventoryResponse:
    datasets = registry.datasets()
    if not datasets:
        return DatasetInventoryResponse(status="no_dataset", message=NO_DATA_MESSAGE)
    return DatasetInventoryResponse(status="ready", message=f"{len(datasets)} dataset(s) loaded.", datasets=datasets)


def get_status(registry: DatasetRegistry) -> DatasetStatusResponse:
    sensors = []
    for sensor in ("MODIS", "VIIRS"):
        sensors.append(SensorAvailability(
            sensor=sensor, loaded=registry.is_loaded(sensor), datasetIds=registry.dataset_ids_for(sensor),
            recordCount=registry.count_observations(sensor),
        ))
    loaded = len(registry.datasets())
    return DatasetStatusResponse(
        status="ready" if loaded else "no_dataset",
        message=f"{loaded} dataset(s) loaded." if loaded else NO_DATA_MESSAGE,
        datasetsLoaded=loaded, sensors=sensors, harmonizationReady=get_readiness(registry).ready,
        backendVersion=settings.VERSION,
    )
