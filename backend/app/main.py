from datetime import date
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models.schemas import (
    ApiErrorDetail,
    CalendarResponse,
    DatasetInventoryResponse,
    DatasetStatusResponse,
    DatasetUploadResponse,
    FireObservationSchema,
    HarmonizationParametersSchema,
    HarmonizationReadinessResponse,
    HarmonizationResultSchema,
    HotspotsResponse,
    OverviewMetricsSchema,
    PlatformName,
    ReportAvailabilityResponse,
    ReportConfigSchema,
    SchemaValidationRequest,
    SchemaValidationResponse,
    ScientificReportSchema,
    SensorComparisonResponse,
    TemporalAnalyticsResponse,
    RegionDefinitionSchema,
    RegionSchema,
)
from app.services import datasets as dataset_service
from app.services.harmonization import (
    DatasetsUnavailable,
    FeatureNotImplemented,
    execute_harmonization,
    get_readiness,
)
from app.services.ingestion import UploadRejected, ingest_csv, safe_source_filename
from app.services.overview import get_overview_metrics
from app.services.registry import DatasetRegistry, JobStore, job_store, registry
from app.services.reports import NoValidAnalysis, generate_scientific_report, get_report_availability
from app.services.regions import region_responses, region_store
from app.services.sensor_comparison import compute_sensor_comparison
from app.services.temporal_analytics import NO_DATA_MESSAGE, compute_calendar, compute_temporal_analytics
from app.services.validation import validate_columns

app = FastAPI(
    title="FIRENEXUS Geospatial Scientific Platform API",
    description="MODIS/VIIRS active-fire harmonization and analysis API. Returns only values computed from loaded datasets.",
    version=settings.VERSION,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_registry() -> DatasetRegistry:
    return registry


def get_jobs() -> JobStore:
    return job_store


def _error(code_: int, code: str, message: str, missing=None) -> HTTPException:
    return HTTPException(status_code=code_, detail=ApiErrorDetail(code=code, message=message, missing=missing or []).model_dump())


@app.get("/api/health")
def get_health():
    return {"status": "healthy", "service": "FIRENEXUS-API", "version": settings.VERSION, "crs": "EPSG:4326 (WGS 84)"}


@app.get("/api/datasets/status", response_model=DatasetStatusResponse)
def get_dataset_status(reg: DatasetRegistry = Depends(get_registry)):
    return dataset_service.get_status(reg)


@app.get("/api/datasets", response_model=DatasetInventoryResponse)
def get_datasets(reg: DatasetRegistry = Depends(get_registry)):
    return dataset_service.get_inventory(reg)


@app.get("/api/regions", response_model=list[RegionSchema])
def get_regions(reg: DatasetRegistry = Depends(get_registry)):
    return region_responses(region_store, reg)


@app.get("/api/regions/{region_id}", response_model=RegionSchema)
def get_region(region_id: str, reg: DatasetRegistry = Depends(get_registry)):
    for region in region_responses(region_store, reg):
        if region.id == region_id:
            return region
    raise _error(404, "REGION_NOT_FOUND", "Region was not found.")


@app.put("/api/regions/{region_id}", response_model=RegionSchema)
def put_region(region_id: str, body: RegionDefinitionSchema, reg: DatasetRegistry = Depends(get_registry)):
    if body.id != region_id:
        raise _error(422, "REGION_ID_MISMATCH", "Region ID in the body must match the URL.")
    region_store.upsert(body)
    return get_region(region_id, reg)


@app.delete("/api/regions/{region_id}", status_code=204)
def delete_region(region_id: str):
    if not region_store.delete(region_id):
        raise _error(404, "REGION_NOT_FOUND", "Region was not found.")
    return None


@app.post("/api/datasets/upload", response_model=DatasetUploadResponse, status_code=201)
def upload_dataset(
    file: UploadFile = File(...),
    sensor: Literal["MODIS", "VIIRS"] = Form(...),
    reg: DatasetRegistry = Depends(get_registry),
):
    filename = file.filename or "upload.csv"
    if not filename.lower().endswith(".csv"):
        raise _error(415, "UNSUPPORTED_FILE", "Only .csv uploads are supported.")
    data_dir = Path(settings.DATA_DIR).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    staging = data_dir / f".upload-{uuid.uuid4().hex}.csv"
    size = 0
    try:
        with staging.open("wb") as target:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.MAX_UPLOAD_BYTES:
                    raise UploadRejected("Uploaded file exceeds the configured upload-size limit.", "FILE_TOO_LARGE")
                target.write(chunk)
        if size == 0:
            raise UploadRejected("CSV is empty.", "EMPTY_CSV")
        metadata, observations_path = ingest_csv(staging, data_dir, sensor, safe_source_filename(filename), settings.MAX_UPLOAD_BYTES)
        reg.register_persisted(metadata, observations_path)
        return DatasetUploadResponse(dataset=metadata, message=f"Imported {metadata.recordCount} observation(s); {metadata.qualityReport.get('rejectedRows', 0)} row(s) rejected.")
    except UploadRejected as exc:
        status = 413 if exc.code == "FILE_TOO_LARGE" else 400
        raise _error(status, exc.code, str(exc)) from exc
    finally:
        file.file.close()
        if staging.exists():
            staging.unlink()


@app.get("/api/datasets/{dataset_id}/observations", response_model=list[FireObservationSchema])
def get_dataset_observations(
    dataset_id: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500),
    reg: DatasetRegistry = Depends(get_registry),
):
    try:
        return reg.observation_page(dataset_id, offset, limit)
    except KeyError:
        raise _error(404, "DATASET_NOT_FOUND", "Dataset was not found.")


@app.delete("/api/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str, reg: DatasetRegistry = Depends(get_registry)):
    if not reg.unregister(dataset_id):
        raise _error(404, "DATASET_NOT_FOUND", "Dataset was not found.")
    return None


@app.post("/api/datasets/validate-schema", response_model=SchemaValidationResponse)
def post_validate_schema(body: SchemaValidationRequest):
    return validate_columns(body.sensor, body.columns)


@app.get("/api/observations/summary", response_model=OverviewMetricsSchema)
def get_summary(reg: DatasetRegistry = Depends(get_registry), jobs: JobStore = Depends(get_jobs)):
    return get_overview_metrics(reg, jobs)


@app.get("/api/explorer/hotspots", response_model=HotspotsResponse)
def get_hotspots(
    sensor: Optional[Literal["MODIS", "VIIRS"]] = Query(None, description="MODIS, VIIRS, or omitted for both"),
    min_confidence: float = Query(0.0, ge=0.0, le=100.0),
    min_frp: float = Query(0.0, ge=0.0),
    max_frp: Optional[float] = Query(None, ge=0.0),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    min_lat: float = Query(-90.0, ge=-90.0, le=90.0),
    max_lat: float = Query(90.0, ge=-90.0, le=90.0),
    min_lon: float = Query(-180.0, ge=-180.0, le=180.0),
    max_lon: float = Query(180.0, ge=-180.0, le=180.0),
    limit: int = Query(5000, ge=1, le=50000),
    platform: Optional[PlatformName] = Query(None),
    region_id: Optional[str] = Query(None),
    reg: DatasetRegistry = Depends(get_registry),
):
    if max_frp is not None and min_frp > max_frp:
        raise _error(422, "INVALID_RANGE", "min_frp must not exceed max_frp")
    if start_date and end_date and start_date > end_date:
        raise _error(422, "INVALID_RANGE", "start_date must not be after end_date")
    if min_lat > max_lat or min_lon > max_lon:
        raise _error(422, "INVALID_BBOX", "Bounding box minimum must not exceed maximum")
    if platform and sensor and reg.sensor_of(platform) != sensor:
        raise _error(422, "SENSOR_PLATFORM_MISMATCH", "The selected platform does not belong to the selected sensor.")
    if not reg.datasets():
        return HotspotsResponse(status="no_dataset", message=NO_DATA_MESSAGE)
    dataset_ids = None
    if region_id:
        definition = region_store.get(region_id)
        if definition is None:
            raise _error(404, "REGION_NOT_FOUND", "Region was not found.")
        box = definition.boundingBox
        min_lat, max_lat = max(min_lat, box.minLatitude), min(max_lat, box.maxLatitude)
        min_lon, max_lon = max(min_lon, box.minLongitude), min(max_lon, box.maxLongitude)
        coverage = reg.region_dataset_coverage((box.minLatitude, box.maxLatitude, box.minLongitude, box.maxLongitude))
        dataset_ids = list(coverage)
    bbox = (min_lat, max_lat, min_lon, max_lon)
    filters = dict(sensor=sensor, platform=platform, start_date=start_date.isoformat() if start_date else None,
                   end_date=end_date.isoformat() if end_date else None, bbox=bbox, min_frp=min_frp,
                   max_frp=max_frp, min_confidence=min_confidence, dataset_ids=dataset_ids)
    total = reg.count_query(**filters)
    items = reg.query_observations(**filters, limit=limit)
    return HotspotsResponse(status="ready", message=f"{total} observation(s) match the filters.", total=total, items=items)


@app.get("/api/harmonization/readiness", response_model=HarmonizationReadinessResponse)
def get_harmonization_readiness(reg: DatasetRegistry = Depends(get_registry)):
    return get_readiness(reg)


@app.post("/api/harmonization/run", response_model=HarmonizationResultSchema)
def run_harmonization(
    params: HarmonizationParametersSchema,
    reg: DatasetRegistry = Depends(get_registry),
    jobs: JobStore = Depends(get_jobs),
):
    try:
        return execute_harmonization(params, reg, jobs)
    except DatasetsUnavailable as exc:
        raise _error(409, "DATASETS_UNAVAILABLE", str(exc), exc.missing)
    except FeatureNotImplemented as exc:
        raise _error(501, exc.code, str(exc))


@app.get("/api/harmonization/jobs/{job_id}", response_model=HarmonizationResultSchema)
def get_job_status(job_id: str, jobs: JobStore = Depends(get_jobs)):
    job = jobs.get(job_id)
    if job is None:
        raise _error(404, "JOB_NOT_FOUND", f"No harmonization job with id '{job_id}'.")
    return job


def _year_range(start_year: int, end_year: int):
    if start_year > end_year:
        raise _error(422, "INVALID_RANGE", "start_year must not exceed end_year")


@app.get("/api/calendar", response_model=CalendarResponse)
def get_calendar(
    start_year: int = Query(2000, ge=1990, le=date.today().year),
    end_year: int = Query(date.today().year, ge=1990, le=date.today().year),
    metric: Literal["frp_sum", "count", "mean_frp"] = Query("frp_sum"),
    sensor: Literal["all", "modis", "viirs"] = Query("all"),
    reg: DatasetRegistry = Depends(get_registry),
):
    _year_range(start_year, end_year)
    obs = reg.observations(None if sensor == "all" else sensor.upper())
    return compute_calendar(obs, start_year, end_year, metric)


@app.get("/api/analytics/temporal", response_model=TemporalAnalyticsResponse)
def get_temporal_analytics(
    start_year: int = Query(2000, ge=1990, le=date.today().year),
    end_year: int = Query(date.today().year, ge=1990, le=date.today().year),
    metric: Literal["frp_sum", "count", "mean_frp"] = Query("frp_sum"),
    reg: DatasetRegistry = Depends(get_registry),
):
    _year_range(start_year, end_year)
    return compute_temporal_analytics(reg.observations(), start_year, end_year, metric)


@app.get("/api/analytics/sensors", response_model=SensorComparisonResponse)
def get_sensor_comparison(
    spatial_tolerance_m: float = Query(750.0, gt=0.0, le=5000.0),
    temporal_window_min: float = Query(30.0, gt=0.0, le=180.0),
    reg: DatasetRegistry = Depends(get_registry),
):
    return compute_sensor_comparison(reg.observations(), spatial_tolerance_m, temporal_window_min)


@app.get("/api/reports", response_model=ReportAvailabilityResponse)
def get_report_status(jobs: JobStore = Depends(get_jobs)):
    return get_report_availability(jobs)


@app.post("/api/reports/generate", response_model=ScientificReportSchema)
def post_generate_report(config: ReportConfigSchema, jobs: JobStore = Depends(get_jobs)):
    try:
        return generate_scientific_report(jobs, config.title or None, config.author or None, config.includeSections)
    except NoValidAnalysis as exc:
        raise _error(409, "NO_VALID_ANALYSIS", str(exc))
