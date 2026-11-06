"""Pydantic response/request schemas.

Every aggregate that depends on a loaded dataset is Optional: ``None`` means
"not computed because no dataset is loaded", while ``0`` means "computed and
actually zero". Responses carry an explicit ``status`` so clients never have
to guess whether data is available.
"""
from typing import Any, Dict, List, Literal, Optional
from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator

SensorName = Literal["MODIS", "VIIRS"]
PlatformName = Literal["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"]
HarmonizationStatus = Literal["raw", "harmonized_match", "candidate_duplicate", "viirs_unmatched", "modis_unmatched"]
DataStatus = Literal["no_dataset", "ready"]

ALL_PLATFORMS: List[str] = ["Terra", "Aqua", "Suomi-NPP", "NOAA-20", "NOAA-21"]
MODIS_PLATFORMS = {"Terra", "Aqua"}
VIIRS_PLATFORMS = {"Suomi-NPP", "NOAA-20", "NOAA-21"}


class DataEnvelope(BaseModel):
    """Base for every dataset-dependent response."""

    status: DataStatus = "no_dataset"
    message: str = "No dataset loaded. Awaiting NASA dataset."


# --------------------------------------------------------------------------- observations
class FireObservationSchema(BaseModel):
    id: str
    source: SensorName
    platform: PlatformName
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    brightness: Optional[float] = None
    scan: Optional[float] = None
    track: Optional[float] = None
    acq_date: str
    acq_time: str
    satellite: Optional[str] = None
    confidence: Optional[float] = None
    confidence_class: Optional[str] = None
    version: Optional[str] = None
    bright_t31: Optional[float] = None
    bright_ti5: Optional[float] = None
    frp: Optional[float] = None
    daynight: Optional[Literal["D", "N"]] = None
    matched_cluster_id: Optional[str] = None
    harmonization_status: HarmonizationStatus = "raw"
    delta_time_min: Optional[float] = None
    delta_spatial_m: Optional[float] = None
    biome: Optional[str] = None
    source_columns: Dict[str, Optional[str]] = Field(default_factory=dict)


class HotspotsResponse(DataEnvelope):
    total: int = 0
    items: List[FireObservationSchema] = Field(default_factory=list)


# --------------------------------------------------------------------------- datasets
class DatasetVariableSchema(BaseModel):
    name: str
    standardName: Optional[str] = None
    dtype: str
    units: Optional[str] = None
    fillValue: Optional[str] = None
    validRange: Optional[str] = None


class MissingValueItem(BaseModel):
    column: str
    totalRows: int
    missingCount: int
    missingPercentage: float  # 0-100


class DatasetMetadataSchema(BaseModel):
    id: str
    title: str
    sensor: SensorName
    satellite: Optional[str] = None
    instrument: Optional[str] = None
    spatialResolution: Optional[str] = None
    temporalCoverage: Optional[str] = None
    fileFormat: Optional[str] = None
    recordCount: Optional[int] = None
    sizeMb: Optional[float] = None
    cfVersion: Optional[str] = None
    variables: List[DatasetVariableSchema] = Field(default_factory=list)
    attributes: Dict[str, str] = Field(default_factory=dict)
    missingValueAnalysis: List[MissingValueItem] = Field(default_factory=list)
    qualityReport: Dict[str, Any] = Field(default_factory=dict)
    importedAt: Optional[str] = None
    sourceFilename: Optional[str] = None
    provenance: Dict[str, str] = Field(default_factory=dict)


class DatasetInventoryResponse(DataEnvelope):
    datasets: List[DatasetMetadataSchema] = Field(default_factory=list)


class GeographicBoundingBoxSchema(BaseModel):
    minLatitude: float = Field(ge=-90.0, le=90.0)
    maxLatitude: float = Field(ge=-90.0, le=90.0)
    minLongitude: float = Field(ge=-180.0, le=180.0)
    maxLongitude: float = Field(ge=-180.0, le=180.0)

    @model_validator(mode="after")
    def _valid_extent(self) -> "GeographicBoundingBoxSchema":
        if self.minLatitude > self.maxLatitude or self.minLongitude > self.maxLongitude:
            raise ValueError("Bounding box minima must not exceed maxima")
        return self


class RegionDefinitionSchema(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    name: str = Field(min_length=1, max_length=160)
    country: str = Field(min_length=1, max_length=100)
    boundingBox: GeographicBoundingBoxSchema
    boundaryGeometry: Optional[Dict[str, Any]] = None
    boundaryNote: str = Field(default="", max_length=240)

    @field_validator("boundaryGeometry")
    @classmethod
    def _validate_boundary_geometry(cls, value):
        if value is None:
            return value
        kind = value.get("type")
        coordinates = value.get("coordinates")
        if kind not in ("Polygon", "MultiPolygon") or not isinstance(coordinates, list):
            raise ValueError("boundaryGeometry must be a GeoJSON Polygon or MultiPolygon")
        polygons = [coordinates] if kind == "Polygon" else coordinates
        if not polygons:
            raise ValueError("boundaryGeometry must contain polygon rings")
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                raise ValueError("boundaryGeometry must contain polygon rings")
            for ring in polygon:
                if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError("GeoJSON polygon rings must be closed and contain at least four points")
                for point in ring:
                    if not isinstance(point, (list, tuple)) or len(point) < 2:
                        raise ValueError("GeoJSON coordinates must be [longitude, latitude]")
                    lon, lat = float(point[0]), float(point[1])
                    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                        raise ValueError("GeoJSON coordinates must be within WGS 84 bounds")
        return value


AcquisitionProduct = Literal["MODIS_SP", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP"]


class AcquisitionStartRequest(BaseModel):
    regionId: str = Field(min_length=1, max_length=80)
    product: AcquisitionProduct
    startDate: date
    endDate: date

    @model_validator(mode="after")
    def _valid_range(self):
        if self.startDate < date(2022, 1, 1):
            raise ValueError("Historical acquisition starts on 2022-01-01")
        if self.startDate > self.endDate:
            raise ValueError("startDate must not be after endDate")
        return self


class AcquisitionChunkSchema(BaseModel):
    startDate: str
    endDate: str
    status: str
    attempts: int = 0
    recordCount: Optional[int] = None
    checksum: Optional[str] = None
    originalFilename: Optional[str] = None
    datasetId: Optional[str] = None
    productVersion: Optional[str] = None
    satellite: Optional[str] = None
    error: Optional[str] = None


class AcquisitionJobSchema(BaseModel):
    id: str
    regionId: str
    product: AcquisitionProduct
    startDate: str
    endDate: str
    status: str
    completedChunks: int = 0
    totalChunks: int = 0
    recordsDownloaded: int = 0
    boundaryMode: Literal["polygon", "bbox_only"] = "bbox_only"
    boundaryNote: str = ""
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    chunks: List[AcquisitionChunkSchema] = Field(default_factory=list)
    message: str = ""


class RegionSchema(RegionDefinitionSchema):
    datasetIds: List[str] = Field(default_factory=list)
    dateCoverageStart: Optional[str] = None
    dateCoverageEnd: Optional[str] = None


class DatasetUploadResponse(BaseModel):
    dataset: DatasetMetadataSchema
    message: str


class SensorAvailability(BaseModel):
    sensor: SensorName
    loaded: bool
    datasetIds: List[str] = Field(default_factory=list)
    recordCount: int = 0


class DatasetStatusResponse(DataEnvelope):
    datasetsLoaded: int = 0
    sensors: List[SensorAvailability] = Field(default_factory=list)
    harmonizationReady: bool = False
    backendVersion: str = ""


class SchemaValidationRequest(BaseModel):
    sensor: SensorName
    columns: List[str] = Field(min_length=1, max_length=512)


class SchemaValidationResponse(BaseModel):
    sensor: SensorName
    valid: bool
    expectedColumns: List[str]
    missingRequired: List[str]
    unexpectedColumns: List[str]
    duplicateColumns: List[str]
    message: str


# --------------------------------------------------------------------------- overview
class IngestionBatchSchema(BaseModel):
    id: str
    orbitPass: str
    timeUtc: str
    platform: str
    anomaliesCount: int
    frpMw: Optional[float] = None
    status: Literal["VALIDATED", "PROCESSING", "FLAGGED"]


class OverviewMetricsSchema(DataEnvelope):
    datasetsLoaded: int = 0
    totalDetections: Optional[int] = None
    modisCount: Optional[int] = None
    modisTerraCount: Optional[int] = None
    modisAquaCount: Optional[int] = None
    viirsCount: Optional[int] = None
    viirsNppCount: Optional[int] = None
    viirsN20Count: Optional[int] = None
    viirsN21Count: Optional[int] = None
    harmonizedDualSensorClusters: Optional[int] = None
    matchPercentage: Optional[float] = None
    meanTemporalOffsetMin: Optional[float] = None
    deltaSpatialMeters: Optional[float] = None
    unmatchedViirsObservationCount: Optional[int] = None
    spatialConfidence: Optional[float] = None
    processedTiles: List[str] = Field(default_factory=list)
    recentBatches: List[IngestionBatchSchema] = Field(default_factory=list)


# --------------------------------------------------------------------------- harmonization
class HarmonizationParametersSchema(BaseModel):
    region: str = Field(default="", max_length=200)
    startDate: str
    endDate: str
    spatialToleranceMeters: float = Field(default=750.0, gt=0.0, le=5000.0)
    temporalWindowMinutes: float = Field(default=30.0, gt=0.0, le=180.0)
    modisMinConfidence: float = Field(default=30.0, ge=0.0, le=100.0)
    viirsMinConfidence: float = Field(default=40.0, ge=0.0, le=100.0)
    frpCalibrationSlope: float = Field(default=1.0, gt=0.0, le=10.0)
    enablePsfDeconvolution: bool = False
    selectedSensors: List[PlatformName] = Field(default_factory=lambda: list(ALL_PLATFORMS))

    @field_validator("startDate", "endDate")
    @classmethod
    def _iso_date(cls, v: str) -> str:
        from datetime import date

        try:
            date.fromisoformat(v)
        except ValueError as exc:
            raise ValueError("must be an ISO date (YYYY-MM-DD)") from exc
        return v

    @model_validator(mode="after")
    def _check_range_and_sensors(self) -> "HarmonizationParametersSchema":
        if self.startDate > self.endDate:
            raise ValueError("startDate must not be after endDate")
        if not self.selectedSensors:
            raise ValueError("selectedSensors must contain at least one platform")
        if not (set(self.selectedSensors) & MODIS_PLATFORMS) or not (set(self.selectedSensors) & VIIRS_PLATFORMS):
            raise ValueError("selectedSensors must include at least one MODIS and one VIIRS platform")
        return self


class HarmonizedClusterExcerptSchema(BaseModel):
    clusterId: str
    latitude: float
    longitude: float
    modisTimestamp: Optional[str] = None
    viirsTimestamp: Optional[str] = None
    deltaSpatialM: Optional[float] = None
    deltaTemporalMin: Optional[float] = None
    modisFrp: Optional[float] = None
    viirsFrp: Optional[float] = None
    status: HarmonizationStatus


class HarmonizationResultSchema(BaseModel):
    jobId: str
    status: Literal["pending", "processing", "completed", "failed"]
    executionTimeMs: Optional[float] = None
    totalRawRecords: Optional[int] = None
    modisCount: Optional[int] = None
    viirsCount: Optional[int] = None
    harmonizedUniqueEvents: Optional[int] = None
    confirmedCrossMatches: Optional[int] = None
    unmatchedViirsObservations: Optional[int] = None
    unmatchedModisObservations: Optional[int] = None
    candidateDuplicates: Optional[int] = None
    meanTemporalOffsetMin: Optional[float] = None
    meanSpatialOffsetM: Optional[float] = None
    pearsonR: Optional[float] = None
    rSquared: Optional[float] = None
    logs: List[str] = Field(default_factory=list)
    sampleMatches: List[HarmonizedClusterExcerptSchema] = Field(default_factory=list)
    error: Optional[str] = None


class HarmonizationInputStatus(BaseModel):
    platform: PlatformName
    product: str
    available: bool
    recordCount: int = 0


class HarmonizationReadinessResponse(BaseModel):
    ready: bool
    reason: str
    inputs: List[HarmonizationInputStatus]
    missing: List[str]


class ApiErrorDetail(BaseModel):
    code: str
    message: str
    missing: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- analytics
class CalendarMonthDataSchema(BaseModel):
    year: int
    month: int
    monthName: str
    frpSumGw: float
    detectionCount: int
    meanFrpMw: Optional[float] = None
    isAnomaly: bool
    anomalyPercent: Optional[int] = None


class CalendarResponse(DataEnvelope):
    startYear: int
    endYear: int
    metric: str = "frp_sum"
    cells: List[CalendarMonthDataSchema] = Field(default_factory=list)


class TemporalDecompositionPointSchema(BaseModel):
    date: str
    year: int
    month: int
    observed: float
    trend: float
    seasonal: float
    remainder: float


class TemporalKpis(BaseModel):
    mannKendallTrend: Optional[str] = None
    mannKendallTau: Optional[float] = None
    pValue: Optional[float] = None
    sensSlopePerYear: Optional[float] = None
    sampleSize: int = 0


class TemporalAnalyticsResponse(DataEnvelope):
    kpis: TemporalKpis = Field(default_factory=TemporalKpis)
    stlDecomposition: List[TemporalDecompositionPointSchema] = Field(default_factory=list)
    annualTrends: List[Dict[str, Any]] = Field(default_factory=list)
    monthlySeasonality: List[Dict[str, Any]] = Field(default_factory=list)
    frpDistribution: List[Dict[str, Any]] = Field(default_factory=list)


class RegressionStats(BaseModel):
    slope: Optional[float] = None
    intercept: Optional[float] = None
    rSquared: Optional[float] = None
    pearsonR: Optional[float] = None
    rmseMw: Optional[float] = None
    meanBiasMw: Optional[float] = None
    nPairs: int = 0
    methodology: str = "Ordinary least squares on coincident MODIS/VIIRS FRP pairs"


class SensorComparisonResponse(DataEnvelope):
    timeOffsetBins: List[Dict[str, Any]] = Field(default_factory=list)
    frpScatterPairs: List[Dict[str, Any]] = Field(default_factory=list)
    frpDistributionHistogram: List[Dict[str, Any]] = Field(default_factory=list)
    regressionStats: RegressionStats = Field(default_factory=RegressionStats)


# --------------------------------------------------------------------------- reports
class ReportConfigSchema(BaseModel):
    title: str = Field(default="", max_length=300)
    author: str = Field(default="", max_length=200)
    includeSections: List[str] = Field(default_factory=list)


class ReportSectionSchema(BaseModel):
    id: str
    title: str
    summary: str
    status: Literal["COMPLETE", "REVIEW"] = "COMPLETE"


class ReportAvailabilityResponse(DataEnvelope):
    canGenerate: bool = False
    reason: str = "No valid analysis exists. Load NASA datasets and run harmonization first."
    availableSections: List[str] = Field(default_factory=list)


class ScientificReportSchema(BaseModel):
    title: str
    reportId: str
    generatedAt: str
    author: Optional[str] = None
    sections: List[ReportSectionSchema]
    provenanceHash: str
    sourceJobId: str
