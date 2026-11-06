// FIRENEXUS types. They mirror the backend Pydantic schemas.
// `null` always means "not computed / not available"; `0` means "computed and actually zero".

export type SensorType = 'MODIS' | 'VIIRS';
export type SatellitePlatform = 'Terra' | 'Aqua' | 'Suomi-NPP' | 'NOAA-20' | 'NOAA-21';
export type HarmonizationStatus = 'raw' | 'harmonized_match' | 'candidate_duplicate' | 'viirs_unmatched' | 'modis_unmatched';
export type DataStatus = 'no_dataset' | 'ready';

export const ALL_PLATFORMS: SatellitePlatform[] = ['Terra', 'Aqua', 'Suomi-NPP', 'NOAA-20', 'NOAA-21'];

export interface DataEnvelope {
  status: DataStatus;
  message: string;
}

export interface FireObservation {
  id: string;
  source: SensorType;
  platform: SatellitePlatform;
  latitude: number;
  longitude: number;
  brightness: number | null;
  scan: number | null;
  track: number | null;
  acq_date: string;
  acq_time: string;
  satellite: string | null;
  confidence: number | null;
  confidence_class: string | null;
  version: string | null;
  bright_t31: number | null;
  bright_ti5?: number | null;
  frp: number | null;
  daynight: 'D' | 'N' | null;
  matched_cluster_id: string | null;
  harmonization_status: HarmonizationStatus;
  delta_time_min: number | null;
  delta_spatial_m: number | null;
  biome: string | null;
  source_columns?: Record<string, string | null>;
}

export interface HotspotsResponse extends DataEnvelope {
  total: number;
  items: FireObservation[];
}

export interface HotspotQuery {
  sensor?: SensorType;
  platform?: SatellitePlatform;
  regionId?: string;
  minConfidence?: number;
  minFrp?: number;
  maxFrp?: number;
  startDate?: string;
  endDate?: string;
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

export interface GeographicBoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface RegionOfInterest {
  id: string;
  name: string;
  country: string;
  boundingBox: GeographicBoundingBox;
  boundaryNote: string;
  datasetIds: string[];
  dateCoverageStart: string | null;
  dateCoverageEnd: string | null;
}

export interface DatasetVariable {
  name: string;
  standardName: string | null;
  dtype: string;
  units: string | null;
  fillValue: string | null;
  validRange: string | null;
}

export interface MissingValueItem {
  column: string;
  totalRows: number;
  missingCount: number;
  missingPercentage: number;
}

export interface DatasetMetadata {
  id: string;
  title: string;
  sensor: SensorType;
  satellite: string | null;
  instrument: string | null;
  spatialResolution: string | null;
  temporalCoverage: string | null;
  fileFormat: string | null;
  recordCount: number | null;
  sizeMb: number | null;
  cfVersion: string | null;
  variables: DatasetVariable[];
  attributes: Record<string, string>;
  missingValueAnalysis: MissingValueItem[];
  qualityReport?: Record<string, unknown>;
  importedAt?: string | null;
  sourceFilename?: string | null;
  provenance?: Record<string, string>;
}

export interface DatasetUploadResponse {
  dataset: DatasetMetadata;
  message: string;
}

export interface DatasetInventory extends DataEnvelope {
  datasets: DatasetMetadata[];
}

export interface SensorAvailability {
  sensor: SensorType;
  loaded: boolean;
  datasetIds: string[];
  recordCount: number;
}

export interface DatasetStatus extends DataEnvelope {
  datasetsLoaded: number;
  sensors: SensorAvailability[];
  harmonizationReady: boolean;
  backendVersion: string;
}

export interface SchemaValidationResult {
  sensor: SensorType;
  valid: boolean;
  expectedColumns: string[];
  missingRequired: string[];
  unexpectedColumns: string[];
  duplicateColumns: string[];
  message: string;
}

export interface IngestionBatch {
  id: string;
  orbitPass: string;
  timeUtc: string;
  platform: string;
  anomaliesCount: number;
  frpMw: number | null;
  status: 'VALIDATED' | 'PROCESSING' | 'FLAGGED';
}

export interface OverviewMetrics extends DataEnvelope {
  datasetsLoaded: number;
  totalDetections: number | null;
  modisCount: number | null;
  modisTerraCount: number | null;
  modisAquaCount: number | null;
  viirsCount: number | null;
  viirsNppCount: number | null;
  viirsN20Count: number | null;
  viirsN21Count: number | null;
  harmonizedDualSensorClusters: number | null;
  matchPercentage: number | null;
  meanTemporalOffsetMin: number | null;
  deltaSpatialMeters: number | null;
  unmatchedViirsObservationCount: number | null;
  spatialConfidence: number | null;
  processedTiles: string[];
  recentBatches: IngestionBatch[];
}

export interface HarmonizationParameters {
  region: string;
  startDate: string;
  endDate: string;
  spatialToleranceMeters: number;
  temporalWindowMinutes: number;
  modisMinConfidence: number;
  viirsMinConfidence: number;
  frpCalibrationSlope: number;
  enablePsfDeconvolution: boolean;
  selectedSensors: SatellitePlatform[];
}

export interface HarmonizedClusterExcerpt {
  clusterId: string;
  latitude: number;
  longitude: number;
  modisTimestamp: string | null;
  viirsTimestamp: string | null;
  deltaSpatialM: number | null;
  deltaTemporalMin: number | null;
  modisFrp: number | null;
  viirsFrp: number | null;
  status: HarmonizationStatus;
}

export interface HarmonizationResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  executionTimeMs: number | null;
  totalRawRecords: number | null;
  modisCount: number | null;
  viirsCount: number | null;
  harmonizedUniqueEvents: number | null;
  confirmedCrossMatches: number | null;
  unmatchedViirsObservations: number | null;
  unmatchedModisObservations: number | null;
  candidateDuplicates: number | null;
  meanTemporalOffsetMin: number | null;
  meanSpatialOffsetM: number | null;
  pearsonR: number | null;
  rSquared: number | null;
  logs: string[];
  sampleMatches: HarmonizedClusterExcerpt[];
  error: string | null;
}

export interface HarmonizationInputStatus {
  platform: SatellitePlatform;
  product: string;
  available: boolean;
  recordCount: number;
}

export interface HarmonizationReadiness {
  ready: boolean;
  reason: string;
  inputs: HarmonizationInputStatus[];
  missing: string[];
}

export type CalendarMetric = 'frp_sum' | 'count' | 'mean_frp';
export type CalendarSensor = 'all' | 'modis' | 'viirs';

export interface CalendarMonthData {
  year: number;
  month: number; // 1-12
  monthName: string;
  frpSumGw: number;
  detectionCount: number;
  meanFrpMw: number | null;
  isAnomaly: boolean;
  anomalyPercent: number | null;
}

export interface CalendarResponse extends DataEnvelope {
  startYear: number;
  endYear: number;
  metric: CalendarMetric;
  cells: CalendarMonthData[];
}

export interface TemporalDecompositionPoint {
  date: string;
  year: number;
  month: number;
  observed: number;
  trend: number;
  seasonal: number;
  remainder: number;
}

export interface TemporalAnalytics extends DataEnvelope {
  kpis: {
    mannKendallTrend: string | null;
    mannKendallTau: number | null;
    pValue: number | null;
    sensSlopePerYear: number | null;
    sampleSize: number;
  };
  stlDecomposition: TemporalDecompositionPoint[];
  annualTrends: { year: number; value: number; trendLine: number | null }[];
  monthlySeasonality: { month: string; meanValue: number; stdValue: number; years: number; seasonalAmplitude: number | null }[];
  frpDistribution: { frpBin: string; modisCount: number; viirsCount: number }[];
}

export interface SensorComparisonData extends DataEnvelope {
  timeOffsetBins: { range: string; count: number }[];
  frpScatterPairs: { modisFrp: number; viirsFrp: number; deltaM: number; confidence: number | null }[];
  frpDistributionHistogram: { frpBin: string; modisCount: number; viirsCount: number }[];
  regressionStats: {
    slope: number | null;
    intercept: number | null;
    rSquared: number | null;
    pearsonR: number | null;
    rmseMw: number | null;
    meanBiasMw: number | null;
    nPairs: number;
    methodology: string;
  };
}

export interface ReportAvailability extends DataEnvelope {
  canGenerate: boolean;
  reason: string;
  availableSections: string[];
}

export interface ReportConfig {
  title: string;
  author: string;
  includeSections: string[];
}

export interface ScientificReport {
  title: string;
  reportId: string;
  generatedAt: string;
  author: string | null;
  sections: { id: string; title: string; summary: string; status: 'COMPLETE' | 'REVIEW' }[];
  provenanceHash: string;
  sourceJobId: string;
}
