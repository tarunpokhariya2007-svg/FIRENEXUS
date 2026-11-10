"""Overview metrics derived from the registry and the latest completed job."""
from app.models.schemas import OverviewMetricsSchema
from app.services.registry import DatasetRegistry, JobStore
from app.services.temporal_analytics import NO_DATA_MESSAGE


def get_overview_metrics(registry: DatasetRegistry, jobs: JobStore) -> OverviewMetricsSchema:
    datasets = registry.datasets()
    if not datasets:
        return OverviewMetricsSchema(status="no_dataset", message=NO_DATA_MESSAGE, datasetsLoaded=0)
    counts = registry.count_by_platform()
    modis = counts.get("Terra", 0) + counts.get("Aqua", 0)
    viirs = counts.get("Suomi-NPP", 0) + counts.get("NOAA-20", 0) + counts.get("NOAA-21", 0)
    metrics = OverviewMetricsSchema(
        status="ready", message="Counts computed from loaded datasets.", datasetsLoaded=len(datasets),
        totalDetections=modis + viirs, modisCount=modis, modisTerraCount=counts.get("Terra", 0),
        modisAquaCount=counts.get("Aqua", 0), viirsCount=viirs, viirsNppCount=counts.get("Suomi-NPP", 0),
        viirsN20Count=counts.get("NOAA-20", 0), viirsN21Count=counts.get("NOAA-21", 0),
    )
    entry = jobs.latest_completed()
    if entry:
        r = entry["result"]
        metrics.harmonizedDualSensorClusters = r.confirmedCrossMatches
        metrics.meanTemporalOffsetMin = r.meanTemporalOffsetMin
        metrics.deltaSpatialMeters = r.meanSpatialOffsetM
        metrics.unmatchedViirsObservationCount = r.unmatchedViirsObservations
        if r.viirsCount:
            metrics.matchPercentage = round(r.confirmedCrossMatches / r.viirsCount * 100.0, 2)
    return metrics
