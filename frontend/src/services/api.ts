// FIRENEXUS API client.
// Failures are surfaced as ApiError; nothing is ever replaced with substitute data.
import {
  CalendarMetric,
  CalendarResponse,
  CalendarSensor,
  DatasetInventory,
  DatasetStatus,
  DatasetUploadResponse,
  FireObservation,
  HarmonizationParameters,
  HarmonizationReadiness,
  HarmonizationResult,
  HotspotQuery,
  HotspotsResponse,
  OverviewMetrics,
  ReportAvailability,
  ReportConfig,
  RegionOfInterest,
  ScientificReport,
  SchemaValidationResult,
  SensorComparisonData,
  SensorType,
  TemporalAnalytics,
} from '../types/firenexus';

const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly missing: string[];

  constructor(message: string, status: number, code = 'API_ERROR', missing: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.missing = missing;
  }
}

function describeDetail(detail: unknown): { message: string; code?: string; missing?: string[] } {
  if (typeof detail === 'string') return { message: detail };
  if (Array.isArray(detail)) {
    // FastAPI request-validation errors
    const msg = detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d))).join('; ');
    return { message: msg, code: 'VALIDATION_ERROR' };
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { message?: string; code?: string; missing?: string[] };
    return { message: d.message ?? 'Request failed', code: d.code, missing: d.missing };
  }
  return { message: 'Request failed' };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError('Backend unreachable. Check that the API server is running.', 0, 'NETWORK_ERROR');
  }
  if (!res.ok) {
    let body: { detail?: unknown } | null = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const d = describeDetail(body?.detail);
    throw new ApiError(d.message || `Request failed (${res.status})`, res.status, d.code, d.missing);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  getDatasetStatus: () => request<DatasetStatus>('/datasets/status'),

  getOverviewMetrics: () => request<OverviewMetrics>('/observations/summary'),

  getExplorerHotspots: (p: HotspotQuery = {}) =>
    request<HotspotsResponse>(
      '/explorer/hotspots' +
        qs({
          sensor: p.sensor,
          platform: p.platform,
          region_id: p.regionId,
          min_confidence: p.minConfidence,
          min_frp: p.minFrp,
          max_frp: p.maxFrp,
          start_date: p.startDate,
          end_date: p.endDate,
          min_lat: p.bbox?.minLat,
          max_lat: p.bbox?.maxLat,
          min_lon: p.bbox?.minLon,
          max_lon: p.bbox?.maxLon,
        }),
    ),

  getHarmonizationReadiness: () => request<HarmonizationReadiness>('/harmonization/readiness'),

  runHarmonization: (params: HarmonizationParameters) =>
    request<HarmonizationResult>('/harmonization/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),

  getHarmonizationJob: (jobId: string) => request<HarmonizationResult>(`/harmonization/jobs/${encodeURIComponent(jobId)}`),

  getCalendarData: (p: { startYear: number; endYear: number; metric: CalendarMetric; sensor: CalendarSensor }) =>
    request<CalendarResponse>('/calendar' + qs({ start_year: p.startYear, end_year: p.endYear, metric: p.metric, sensor: p.sensor })),

  getTemporalAnalysis: (p: { startYear: number; endYear: number; metric: CalendarMetric }) =>
    request<TemporalAnalytics>('/analytics/temporal' + qs({ start_year: p.startYear, end_year: p.endYear, metric: p.metric })),

  getSensorComparison: (p: { spatialToleranceM?: number; temporalWindowMin?: number } = {}) =>
    request<SensorComparisonData>(
      '/analytics/sensors' + qs({ spatial_tolerance_m: p.spatialToleranceM, temporal_window_min: p.temporalWindowMin }),
    ),

  getDatasets: () => request<DatasetInventory>('/datasets'),

  getRegions: () => request<RegionOfInterest[]>('/regions'),

  getDatasetObservations: (datasetId: string, offset = 0, limit = 100) =>
    request<FireObservation[]>(`/datasets/${encodeURIComponent(datasetId)}/observations${qs({ offset, limit })}`),

  deleteDataset: (datasetId: string) => request<void>(`/datasets/${encodeURIComponent(datasetId)}`, { method: 'DELETE' }),

  uploadDataset: (file: File, sensor: SensorType, onProgress: (percent: number) => void) =>
    new Promise<DatasetUploadResponse>((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      form.append('sensor', sensor);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/datasets/upload`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new ApiError('Backend unreachable. Check that the API server is running.', 0, 'NETWORK_ERROR'));
      xhr.onload = () => {
        let body: { detail?: unknown } | DatasetUploadResponse;
        try { body = JSON.parse(xhr.responseText); } catch { body = { detail: 'Invalid server response' }; }
        if (xhr.status < 200 || xhr.status >= 300) {
          const d = describeDetail((body as { detail?: unknown }).detail);
          reject(new ApiError(d.message, xhr.status, d.code, d.missing));
        } else resolve(body as DatasetUploadResponse);
      };
      xhr.send(form);
    }),

  validateSchema: (sensor: SensorType, columns: string[]) =>
    request<SchemaValidationResult>('/datasets/validate-schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor, columns }),
    }),

  getReportAvailability: () => request<ReportAvailability>('/reports'),

  generateReport: (config: ReportConfig) =>
    request<ScientificReport>('/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),
};
