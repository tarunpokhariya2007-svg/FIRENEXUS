import React, { useState } from 'react';
import { api } from '../services/api';
import { ALL_PLATFORMS, HarmonizationResult, HarmonizedClusterExcerpt, SatellitePlatform } from '../types/firenexus';
import { ApiError } from '../services/api';
import { useApiResource } from '../hooks/useApi';
import { EmptyState } from '../components/common/StatePanel';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtInt } from '../utils/format';

const PLATFORM_LABELS: Record<SatellitePlatform, { badge: string; tone: 'secondary' | 'tertiary'; orbit: string; res: string }> = {
  Terra: { badge: 'MODIS TERRA', tone: 'secondary', orbit: 'Terra', res: '1000m nadir' },
  Aqua: { badge: 'MODIS AQUA', tone: 'secondary', orbit: 'Aqua', res: '1000m nadir' },
  'Suomi-NPP': { badge: 'VIIRS S-NPP', tone: 'tertiary', orbit: 'Suomi-NPP', res: '375m I-Band' },
  'NOAA-20': { badge: 'VIIRS NOAA-20', tone: 'tertiary', orbit: 'NOAA-20', res: '375m I-Band' },
  'NOAA-21': { badge: 'VIIRS NOAA-21', tone: 'tertiary', orbit: 'NOAA-21', res: '375m I-Band' },
};

export const HarmonizationStudio: React.FC = () => {
  const readinessRes = useApiResource(() => api.getHarmonizationReadiness(), []);
  const readiness = readinessRes.data;

  // Configuration (no pre-filled scientific values: calibration defaults to the identity slope)
  const [temporalWindow, setTemporalWindow] = useState<number>(30);
  const [spatialDistance, setSpatialDistance] = useState<number>(750);
  const [calibrationSlope, setCalibrationSlope] = useState<number>(1);
  const [modisMinConf, setModisMinConf] = useState<number>(30);
  const [viirsMinConf, setViirsMinConf] = useState<number>(40);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedSensors, setSelectedSensors] = useState<SatellitePlatform[]>([...ALL_PLATFORMS]);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<HarmonizationResult | null>(null);
  const [runError, setRunError] = useState<ApiError | null>(null);

  const inputFor = (p: SatellitePlatform) => readiness?.inputs.find((i) => i.platform === p);
  const hasModis = selectedSensors.some((p) => p === 'Terra' || p === 'Aqua');
  const hasViirs = selectedSensors.some((p) => p === 'Suomi-NPP' || p === 'NOAA-20' || p === 'NOAA-21');

  // Parameter validation
  const errors: string[] = [];
  if (!startDate || !endDate) errors.push('Select a start and end date.');
  else if (startDate > endDate) errors.push('Start date must not be after end date.');
  if (!(spatialDistance > 0 && spatialDistance <= 5000)) errors.push('Spatial distance must be between 1 and 5000 m.');
  if (!(temporalWindow > 0 && temporalWindow <= 180)) errors.push('Temporal window must be between 1 and 180 min.');
  if (!(calibrationSlope > 0 && calibrationSlope <= 10)) errors.push('Calibration slope must be greater than 0 and at most 10.');
  if (!hasModis || !hasViirs) errors.push('Select at least one MODIS and one VIIRS platform.');

  const datasetsReady = readiness?.ready ?? false;
  const canRun = datasetsReady && errors.length === 0 && !isRunning;
  const disabledReason = readinessRes.error
    ? `Cannot verify dataset availability: ${readinessRes.error.message}`
    : !readiness
    ? 'Checking dataset availability…'
    : !datasetsReady
    ? readiness.reason
    : errors[0] ?? null;

  const executionMessage = isRunning
    ? 'RUNNING…'
    : runError
    ? 'RUN REFUSED'
    : result
    ? result.status === 'completed'
      ? 'JOB COMPLETED'
      : result.status.toUpperCase()
    : !datasetsReady
    ? 'AWAITING NASA DATASET'
    : errors.length
    ? 'PARAMETERS INCOMPLETE'
    : 'PARAMETERS VALIDATED';

  const toggleSensor = (p: SatellitePlatform) =>
    setSelectedSensors((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const handleRunHarmonization = async () => {
    if (!canRun) return;
    setIsRunning(true);
    setRunError(null);
    try {
      const res = await api.runHarmonization({
        region: '',
        startDate,
        endDate,
        spatialToleranceMeters: spatialDistance,
        temporalWindowMinutes: temporalWindow,
        modisMinConfidence: modisMinConf,
        viirsMinConfidence: viirsMinConf,
        frpCalibrationSlope: calibrationSlope,
        enablePsfDeconvolution: false,
        selectedSensors,
      });
      setResult(res);
    } catch (e) {
      setResult(null);
      setRunError(e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : 'Unexpected error', 0));
    } finally {
      setIsRunning(false);
    }
  };

  const total = result?.totalRawRecords ?? null;
  const pct = (n: number | null | undefined) => (n !== null && n !== undefined && total ? `${((n / total) * 100).toFixed(1)}%` : EMPTY);
  const rows: HarmonizedClusterExcerpt[] = result?.sampleMatches ?? [];

  return (
    <div className="flex flex-col w-full">
      {/* Sub-header Breadcrumb & Operational Pipeline Indicator */}
      <div className="bg-surface-container-low px-space-lg py-space-sm flex flex-wrap items-center justify-between gap-space-md shadow-sm border-b border-structural select-none font-mono">
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs font-label-xs text-label-xs uppercase text-on-surface-variant">
            <span className="text-tertiary font-semibold">STAGE 02</span>
            <span>/</span>
            <span className="text-on-surface font-semibold">CROSS-SENSOR HARMONIZATION STUDIO</span>
          </div>
          <div className="hidden md:flex items-center gap-space-xs px-space-sm py-0.5 rounded bg-surface-container text-on-surface font-label-xs text-label-xs border border-structural">
            <span className="w-2 h-2 rounded-full bg-secondary"></span>
            <span>ALGORITHM: SPATIAL-TEMPORAL CROSS-MATCH</span>
          </div>
        </div>

        <div className="flex items-center gap-space-md font-label-xs text-label-xs">
          <div className="flex items-center gap-space-xs px-space-sm py-0.5 rounded bg-surface-container-high text-on-surface border border-structural">
            <span className="material-symbols-outlined text-[14px] text-tertiary">memory</span>
            <span>{datasetsReady ? 'DATASETS READY' : 'AWAITING NASA DATASET'}</span>
          </div>
        </div>
      </div>

      <div className="p-space-lg flex flex-col gap-space-lg">
        {/* ================= STAGE A: INPUT DATASETS ================= */}
        <section className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <span className="px-1.5 py-0.5 rounded bg-inverse-surface text-inverse-on-surface font-label-xs text-label-xs uppercase tracking-wider font-semibold font-mono">
                Stage A
              </span>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Telemetric Input Feeds &amp; Satellite Ingestion
              </h2>
              <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">
                ({readiness ? `${readiness.inputs.filter((i) => i.available).length} of 5 catalogs loaded` : 'checking…'})
              </span>
            </div>
            <div className="flex items-center gap-space-xs font-label-xs text-label-xs text-on-surface-variant font-mono">
              <span className="material-symbols-outlined text-[14px] text-primary">sync</span>
              <span>TIME WINDOW: {startDate && endDate ? `${startDate} → ${endDate}` : 'not selected'}</span>
            </div>
          </div>

          {/* Feed Grid: 5 Satellite Cards (availability comes from the backend) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-space-sm font-mono">
            {ALL_PLATFORMS.map((p) => {
              const meta = PLATFORM_LABELS[p];
              const input = inputFor(p);
              const available = input?.available ?? false;
              return (
                <div
                  key={p}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedSensors.includes(p)}
                  title={selectedSensors.includes(p) ? 'Click to exclude from processing' : 'Click to include in processing'}
                  onClick={() => toggleSensor(p)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleSensor(p)}
                  className={`bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border group hover:bg-surface-container-low transition-colors cursor-pointer ${
                    selectedSensors.includes(p) ? 'border-primary' : 'border-structural opacity-60'
                  }`}
                >
                  <div className="flex flex-col gap-space-xs">
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-space-xs py-0.5 rounded font-label-xs text-label-xs font-semibold ${
                          meta.tone === 'secondary'
                            ? 'bg-secondary-fixed text-on-secondary-fixed-variant'
                            : 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                        }`}
                      >
                        {meta.badge}
                      </span>
                      <span
                        className={`flex items-center gap-1 font-label-xs text-label-xs font-medium ${
                          available ? 'text-secondary' : 'text-on-surface-variant'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${available ? 'bg-secondary' : 'bg-outline'}`}></span>
                        <span>{available ? 'READY' : 'NOT LOADED'}</span>
                      </span>
                    </div>
                    <span className="font-label-xs text-[10px] text-on-surface-variant mt-1">
                      PRODUCT: {input?.product ?? EMPTY}
                    </span>
                    <div className="mt-2 space-y-1 font-label-xs text-[11px]">
                      <div className="flex justify-between text-on-surface-variant">
                        <span>NADIR RES:</span>
                        <span className="text-on-surface font-medium">{meta.res}</span>
                      </div>
                      <div className="flex justify-between text-on-surface-variant">
                        <span>TIMESPAN:</span>
                        <span className="text-on-surface font-medium">{EMPTY}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-space-md pt-space-xs flex items-end justify-between bg-surface-container-low p-space-xs rounded border border-structural">
                    <div className="flex flex-col">
                      <span className="font-label-xs text-[9px] text-on-surface-variant">RECORDS INGESTED</span>
                      <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                        {readiness ? fmtInt(input?.recordCount ?? 0) : EMPTY}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ================= STAGE B: MATCHING & HARMONIZATION CONFIGURATION ================= */}
        <section className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-sm">
            <span className="px-1.5 py-0.5 rounded bg-inverse-surface text-inverse-on-surface font-label-xs text-label-xs uppercase tracking-wider font-semibold font-mono">
              Stage B
            </span>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Matching &amp; Harmonization Parameter Matrix
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md">
            {/* Left Column: Parameter Matrix (7 cols) */}
            <div className="lg:col-span-7 bg-surface-container-lowest p-space-lg rounded shadow-sm flex flex-col gap-space-md border border-structural">
              <div className="flex items-center justify-between pb-space-xs border-b border-structural">
                <span className="font-label-sm text-label-sm text-on-surface font-semibold uppercase tracking-wide font-mono">
                  Spatial &amp; Temporal Calibration Parameters
                </span>
                <span className="font-label-xs text-label-xs text-secondary font-medium font-mono">
                  Input Validation: Active
                </span>
              </div>

              {/* Parameter 1: Analysis window */}
              <div className="flex flex-col gap-1">
                <label className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium flex justify-between font-mono">
                  <span>Analysis Window (UTC)</span>
                  <span className="text-secondary font-semibold">EPSG:4326 (WGS 84)</span>
                </label>
                <div className="flex items-center justify-between px-space-md py-2 rounded bg-surface-container-low border border-structural">
                  <div className="flex items-center gap-space-sm">
                    <span className="material-symbols-outlined text-[18px] text-tertiary">date_range</span>
                    <input
                      type="date"
                      aria-label="Start date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-transparent font-body-sm text-body-sm text-on-surface font-medium font-mono outline-none"
                    />
                    <span className="text-outline">→</span>
                    <input
                      type="date"
                      aria-label="End date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-transparent font-body-sm text-body-sm text-on-surface font-medium font-mono outline-none"
                    />
                  </div>
                  <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">
                    {selectedSensors.length} of 5 platforms
                  </span>
                </div>
              </div>

              {/* Parameter 2: Temporal Coincidence Window Slider */}
              <div className="flex flex-col gap-space-xs font-mono">
                <div className="flex justify-between items-center">
                  <label className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium">
                    Temporal Coincidence Window (Δt)
                  </label>
                  <span className="font-label-sm text-label-sm font-semibold text-primary px-space-xs py-0.5 rounded bg-primary-fixed">
                    ± {temporalWindow} minutes
                  </span>
                </div>
                <div className="py-1">
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={temporalWindow}
                    onChange={(e) => setTemporalWindow(Number(e.target.value))}
                    className="w-full accent-primary cursor-pointer h-1.5 bg-surface-container-high rounded appearance-none"
                  />
                  <div className="flex justify-between text-label-xs font-label-xs text-on-surface-variant mt-1.5 px-0.5">
                    <span onClick={() => setTemporalWindow(15)} className="cursor-pointer hover:text-on-surface">
                      15m
                    </span>
                    <span onClick={() => setTemporalWindow(30)} className="cursor-pointer text-primary font-semibold">
                      30m
                    </span>
                    <span onClick={() => setTemporalWindow(45)} className="cursor-pointer hover:text-on-surface">
                      45m
                    </span>
                    <span onClick={() => setTemporalWindow(60)} className="cursor-pointer hover:text-on-surface">
                      60m
                    </span>
                  </div>
                </div>
              </div>

              {/* Parameter 3 & 4: Two-col split */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md font-mono">
                {/* Spatial Distance */}
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium">
                    Spatial Matching Distance (Δs)
                  </label>
                  <div className="p-space-sm rounded bg-surface-container-low flex flex-col gap-1 border border-structural">
                    <div className="flex justify-between items-center">
                      <span className="font-label-sm text-label-sm font-semibold text-on-surface flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={5000}
                          aria-label="Spatial distance in meters"
                          value={spatialDistance}
                          onChange={(e) => setSpatialDistance(Number(e.target.value))}
                          className="w-16 bg-surface-container-lowest border border-structural rounded px-1 outline-none"
                        />
                        meters
                      </span>
                      <span className="font-label-xs text-label-xs px-1 rounded bg-surface-container-high text-on-surface font-semibold">
                        Great-circle
                      </span>
                    </div>
                    <span className="font-label-xs text-[10px] text-on-surface-variant">
                      Maximum great-circle distance between a VIIRS and a MODIS detection to be considered coincident.
                    </span>
                  </div>
                </div>

                {/* Sensor Resolution Normalization */}
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium">
                    Resolution Normalization
                  </label>
                  <div className="p-space-sm rounded bg-surface-container-low flex flex-col gap-1 border border-structural">
                    <div className="flex justify-between items-center">
                      <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                        Gaussian PSF Weighting
                      </span>
                      <span className="font-label-xs text-label-xs px-1 rounded bg-surface-container-high text-on-surface-variant font-semibold">
                        Not implemented
                      </span>
                    </div>
                    <span className="font-label-xs text-[10px] text-on-surface-variant">
                      PSF deconvolution is not available in this build. The run always uses point-to-point matching.
                    </span>
                  </div>
                </div>
              </div>

              {/* Parameter 5 & 6: Confidence & FRP */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md font-mono">
                {/* Confidence Filtering */}
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium">
                    Confidence Thresholding
                  </label>
                  <div className="p-space-sm rounded bg-surface-container-low flex flex-col gap-1 border border-structural">
                    <div className="flex items-center gap-space-xs">
                      <span className="w-2 h-2 rounded-full bg-primary"></span>
                      <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                        <span className="flex items-center gap-1">
                          Min conf. M
                          <input type="number" min={0} max={100} aria-label="MODIS minimum confidence" value={modisMinConf}
                            onChange={(e) => setModisMinConf(Number(e.target.value))}
                            className="w-12 bg-surface-container-lowest border border-structural rounded px-1 outline-none" />
                          V
                          <input type="number" min={0} max={100} aria-label="VIIRS minimum confidence" value={viirsMinConf} disabled
                            onChange={(e) => setViirsMinConf(Number(e.target.value))}
                            className="w-12 bg-surface-container-lowest border border-structural rounded px-1 outline-none" />
                        </span>
                      </span>
                    </div>
                    <span className="font-label-xs text-[10px] text-on-surface-variant">
                      MODIS numeric confidence is filtered. VIIRS confidence classes are preserved; no numeric VIIRS threshold is applied.
                    </span>
                  </div>
                </div>

                {/* FRP Calibration Factor */}
                <div className="flex flex-col gap-1">
                  <label className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium">
                    FRP Empirical Calibration
                  </label>
                  <div className="p-space-sm rounded bg-surface-container-low flex flex-col gap-1 border border-structural">
                    <div className="flex justify-between items-center">
                      <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                        <span className="flex items-center gap-1">
                          k =
                          <input type="number" step="0.001" min={0} aria-label="FRP calibration slope" value={calibrationSlope}
                            onChange={(e) => setCalibrationSlope(Number(e.target.value))}
                            className="w-16 bg-surface-container-lowest border border-structural rounded px-1 outline-none" />
                        </span>
                      </span>
                      <span className="font-label-xs text-label-xs font-semibold text-secondary">
                        {result?.rSquared !== null && result?.rSquared !== undefined ? `R² = ${result.rSquared}` : 'R² = —'}
                      </span>
                    </div>
                    <span className="font-label-xs text-[10px] text-on-surface-variant">
                      Reserved calibration factor (1 = none). Validated now; applied once calibration is implemented.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Scientific Rationale & Execution Console (5 cols) */}
            <div className="lg:col-span-5 bg-surface-container-lowest p-space-lg rounded shadow-sm flex flex-col justify-between gap-space-md border border-structural">
              <div className="flex flex-col gap-space-md">
                <div className="flex items-center justify-between pb-space-xs border-b border-structural">
                  <span className="font-label-sm text-label-sm text-on-surface font-semibold uppercase tracking-wide font-mono">
                    Scientific Rationale &amp; Mechanics
                  </span>
                  <span className="material-symbols-outlined text-[18px] text-tertiary">science</span>
                </div>

                <div className="p-space-md rounded bg-surface-container-low flex flex-col gap-space-xs border border-structural">
                  <div className="flex items-center gap-space-xs text-tertiary font-mono">
                    <span className="material-symbols-outlined text-[16px]">info</span>
                    <span className="font-label-xs text-label-xs font-semibold uppercase tracking-wider">
                      Matching Rules
                    </span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                    Detections are matched when they lie within the chosen spatial distance and temporal window. Only matches computed from the loaded datasets are reported.</p>
                </div>

                {/* Mathematical Model Diagram Preview (Inline SVG) */}
                <div className="p-space-md rounded bg-surface-container flex flex-col gap-space-xs border border-structural">
                  <span className="font-label-xs text-label-xs uppercase text-on-surface-variant font-medium font-mono">
                    Matching Footprint (schematic)
                  </span>
                  <div className="w-full h-24 flex items-center justify-center">
                    <svg className="w-full h-full text-on-surface-variant" fill="none" viewBox="0 0 380 90">
                      <line opacity="0.3" stroke="currentColor" strokeWidth="1" x1="20" x2="360" y1="75" y2="75" />
                      <line opacity="0.3" stroke="currentColor" strokeDasharray="2 2" strokeWidth="1" x1="190" x2="190" y1="10" y2="80" />
                      <path d="M 40 75 Q 190 -20 340 75" fill="none" opacity="0.8" stroke="#2d6480" strokeWidth="2" />
                      <path d="M 120 75 Q 190 5 260 75" fill="none" stroke="#9e3d19" strokeWidth="2" />
                      <circle cx="160" cy="55" fill="#8b4c0f" r="3" />
                      <circle cx="190" cy="20" fill="#9e3d19" r="3" />
                      <circle cx="220" cy="55" fill="#8b4c0f" r="3" />
                      <text fill="#2d6480" fontFamily="JetBrains Mono" fontSize="9" x="50" y="45">MODIS</text>
                      <text fill="#9e3d19" fontFamily="JetBrains Mono" fontSize="9" x="235" y="30">VIIRS</text>
                      <text fill="currentColor" fontFamily="JetBrains Mono" fontSize="8" x="175" y="86">Δs = 0 (Center)</text>
                    </svg>
                  </div>
                  <div className="flex justify-between items-center text-label-xs font-label-xs text-on-surface-variant font-mono">
                    <span>Δs ≤ {spatialDistance} m</span>
                    <span>Δt ≤ {temporalWindow} min</span>
                  </div>
                </div>

                {/* Validation checklist (real checks) */}
                <div className="space-y-1 font-label-xs text-label-xs font-mono">
                  {[
                    { ok: datasetsReady, text: datasetsReady ? 'MODIS and VIIRS datasets are loaded' : readiness?.reason ?? 'Checking dataset availability…' },
                    { ok: errors.length === 0, text: errors.length === 0 ? 'Processing parameters are valid' : errors[0] },
                  ].map((c, i) => (
                    <div key={i} className="flex items-center gap-space-xs text-on-surface">
                      <span className={`material-symbols-outlined text-[14px] ${c.ok ? 'text-secondary' : 'text-error'}`}>
                        {c.ok ? 'check_circle' : 'cancel'}
                      </span>
                      <span>{c.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Execution Action Panel */}
              <div className="pt-space-md flex flex-col gap-space-sm border-t border-structural">
                <div className="flex items-center justify-between text-label-xs font-label-xs font-mono">
                  <span className="text-on-surface-variant font-medium">EXECUTION ENGINE STATUS:</span>
                  <span className={`font-semibold flex items-center gap-1 ${runError || result?.status === 'failed' ? 'text-error' : canRun || result?.status === 'completed' ? 'text-secondary' : 'text-on-surface-variant'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${runError || result?.status === 'failed' ? 'bg-error' : canRun || result?.status === 'completed' ? 'bg-secondary' : 'bg-outline'}`}></span>
                    <span>{executionMessage}</span>
                  </span>
                </div>
                <button
                  onClick={handleRunHarmonization}
                  disabled={!canRun}
                  title={disabledReason ?? undefined}
                  className="w-full py-3 px-space-md rounded bg-inverse-surface hover:bg-on-surface text-inverse-on-surface font-body-sm text-body-sm font-semibold transition-all flex items-center justify-center gap-space-sm shadow-md active:scale-[0.99] select-none font-mono"
                >
                  <span className={`material-symbols-outlined text-[18px] text-primary-fixed ${isRunning ? 'animate-spin' : ''}`}>
                    {isRunning ? 'sync' : 'play_arrow'}
                  </span>
                  <span>{isRunning ? 'Running…' : 'Run Harmonization Engine'}</span>
                </button>
                {disabledReason && !isRunning && (
                  <p role="status" className="font-label-xs text-[11px] text-on-surface-variant font-mono">
                    {disabledReason}
                  </p>
                )}
                {runError && (
                  <p role="alert" className="font-label-xs text-[11px] text-error font-mono">
                    {runError.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ================= STAGE C: RESULTS & CROSS-SENSOR VALIDATION ================= */}
        <section className="flex flex-col gap-space-sm">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <div className="flex items-center gap-space-sm">
              <span className="px-1.5 py-0.5 rounded bg-inverse-surface text-inverse-on-surface font-label-xs text-label-xs uppercase tracking-wider font-semibold font-mono">
                Stage C
              </span>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Cross-Sensor Harmonization Analytics &amp; Event Telemetry
              </h2>
            </div>
            <div className="flex items-center gap-space-xs font-mono">
              <button
                disabled
                title="Export is available after a completed harmonization run"
                className="px-space-sm py-1 rounded bg-surface-container-highest text-on-surface font-label-xs text-label-xs hover:bg-surface-container-high transition-colors flex items-center gap-1 border border-structural"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span>EXPORT NETCDF-4</span>
              </button>
              <button
                disabled
                title="Export is available after a completed harmonization run"
                className="px-space-sm py-1 rounded bg-surface-container-highest text-on-surface font-label-xs text-label-xs hover:bg-surface-container-high transition-colors flex items-center gap-1 border border-structural"
              >
                <span className="material-symbols-outlined text-[14px]">table_view</span>
                <span>CSV PARQUET</span>
              </button>
            </div>
          </div>

          {/* Summary Metrics Bar (5 KPIs) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-sm font-mono">
            <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Selected Input Observations</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-headline-md text-headline-md text-on-surface font-semibold">
                  {fmtInt(result?.totalRawRecords)}
                </span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">{result ? '100%' : EMPTY}</span>
              </div>
              <span className="font-label-xs text-[10px] text-on-surface-variant mt-1">Sum of selected satellite catalogs</span>
            </div>

            <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Association-Based Event Estimate</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-headline-md text-headline-md text-primary font-semibold">
                  {fmtInt(result?.harmonizedUniqueEvents)}
                </span>
                <span className="font-label-xs text-label-xs px-1 rounded bg-primary-fixed text-on-primary-fixed font-semibold">
                  {result && total ? `${((total - (result.harmonizedUniqueEvents ?? 0)) / total * 100).toFixed(1)}%` : EMPTY}
                </span>
              </div>
              <span className="font-label-xs text-[10px] text-on-surface-variant mt-1">Observation count after one-to-one confirmed associations</span>
            </div>

            <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Confirmed Cross-Matches</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-headline-md text-headline-md text-secondary font-semibold">
                  {fmtInt(result?.confirmedCrossMatches)}
                </span>
                <span className="font-label-xs text-label-xs px-1 rounded bg-secondary-fixed text-on-secondary-fixed-variant font-semibold">
                  {pct(result?.confirmedCrossMatches)}
                </span>
              </div>
              <span className="font-label-xs text-[10px] text-on-surface-variant mt-1">Coincident MODIS + VIIRS hits</span>
            </div>

            <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Unmatched VIIRS Observations</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-headline-md text-headline-md text-tertiary font-semibold">
                  {fmtInt(result?.unmatchedViirsObservations)}
                </span>
                <span className="font-label-xs text-label-xs px-1 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-semibold">
                  {pct(result?.unmatchedViirsObservations)}
                </span>
              </div>
              <span className="font-label-xs text-[10px] text-on-surface-variant mt-1">VIIRS observations without a selected MODIS association</span>
            </div>

            <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Cross-Sensor FRP Agreement</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="font-headline-md text-headline-md text-on-surface font-semibold">
                  r = {result?.pearsonR ?? EMPTY}
                </span>
                <span className="font-label-xs text-label-xs text-on-surface-variant font-semibold">{result?.pearsonR !== null && result?.pearsonR !== undefined ? `R² ${result.rSquared}` : EMPTY}</span>
              </div>
              <span className="font-label-xs text-[10px] text-on-surface-variant mt-1">Pearson correlation of coincident FRP pairs</span>
            </div>
          </div>

          {/* Detailed Observation Matching Table */}
          <div className="bg-surface-container-lowest rounded shadow-sm overflow-hidden flex flex-col border border-structural">
            <div className="p-space-md bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm border-b border-structural">
              <div className="flex items-center gap-space-sm">
                <span className="font-label-sm text-label-sm font-semibold uppercase text-on-surface font-mono">
                  Spatial Coincidence Event Telemetry Matrix
                </span>
                <span className="font-label-xs text-label-xs px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-medium font-mono">
                  {result ? `Job ${result.jobId}` : 'No job run'}
                </span>
              </div>
              <div className="flex items-center gap-space-sm font-mono">
                <div className="flex items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                  <span>Harmonized Match</span>
                </div>
                <div className="flex items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
                  <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                  <span>VIIRS Unmatched</span>
                </div>
                <div className="flex items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  <span>Candidate Duplicate</span>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse select-text font-mono">
                <thead>
                  <tr className="bg-surface-container text-on-surface-variant font-label-xs text-label-xs uppercase tracking-wider h-8">
                    <th className="px-space-md py-1.5 font-medium">Cluster ID</th>
                    <th className="px-space-md py-1.5 font-medium">Lat / Lon (Centroid)</th>
                    <th className="px-space-md py-1.5 font-medium">MODIS Timestamp</th>
                    <th className="px-space-md py-1.5 font-medium">VIIRS Timestamp</th>
                    <th className="px-space-md py-1.5 font-medium text-right">Δs Offset</th>
                    <th className="px-space-md py-1.5 font-medium text-right">Δt Delta</th>
                    <th className="px-space-md py-1.5 font-medium text-right">MODIS FRP</th>
                    <th className="px-space-md py-1.5 font-medium text-right">VIIRS FRP</th>
                    <th className="px-space-md py-1.5 font-medium text-center">Harmonization Status</th>
                  </tr>
                </thead>
                <tbody className="font-label-sm text-label-sm divide-y divide-surface-container">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
                          compact
                          title={result ? 'No matches in this job' : NO_DATASET}
                          detail={result ? 'The job produced no coincident or unmatched observations' : AWAITING_NASA}
                        />
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.clusterId} className="hover:bg-surface-container-low transition-colors">
                      <td className="px-space-md py-2 font-medium text-on-surface">{row.clusterId}</td>
                      <td className="px-space-md py-2 text-on-surface-variant">
                        {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
                      </td>
                      <td className="px-space-md py-2 text-on-surface">
                        {row.modisTimestamp || <span className="text-on-surface-variant italic">-- Not Detected --</span>}
                      </td>
                      <td className="px-space-md py-2 text-on-surface">{row.viirsTimestamp || '--'}</td>
                      <td className="px-space-md py-2 text-right text-on-surface">
                        {row.deltaSpatialM !== null ? `${row.deltaSpatialM} m` : '--'}
                      </td>
                      <td className="px-space-md py-2 text-right text-on-surface">
                        {row.deltaTemporalMin !== null ? `${row.deltaTemporalMin.toFixed(1)} min` : '--'}
                      </td>
                      <td className="px-space-md py-2 text-right font-medium text-secondary">
                        {row.modisFrp !== null ? `${row.modisFrp.toFixed(1)} MW` : '--'}
                      </td>
                      <td className="px-space-md py-2 text-right font-medium text-primary">
                        {row.viirsFrp !== null ? `${row.viirsFrp.toFixed(1)} MW` : '--'}
                      </td>
                      <td className="px-space-md py-2 text-center">
                        {row.status === 'harmonized_match' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-xs text-label-xs font-semibold bg-secondary-fixed text-on-secondary-fixed-variant">
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                            <span>Harmonized Match</span>
                          </span>
                        )}
                        {row.status === 'viirs_unmatched' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-xs text-label-xs font-semibold bg-tertiary-fixed text-on-tertiary-fixed-variant">
                            <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                            <span>VIIRS Unmatched</span>
                          </span>
                        )}
                        {row.status === 'candidate_duplicate' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-xs text-label-xs font-semibold bg-primary-fixed text-on-primary-fixed">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                            <span>Candidate Duplicate</span>
                          </span>
                        )}
                        {row.status === 'modis_unmatched' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-xs text-label-xs font-semibold bg-surface-container-high text-on-surface-variant">
                            <span>MODIS Unmatched</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Processing Logs Drawer if run */}
            {result?.logs && result.logs.length > 0 && (
              <div className="p-space-md bg-surface-container-low border-t border-structural font-mono text-[11px]">
                <div className="font-semibold uppercase tracking-wider text-on-surface mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-primary">terminal</span>
                  <span>Harmonization Processing Console Output</span>
                </div>
                <div className="bg-inverse-surface text-inverse-on-surface p- space-sm p-3 rounded space-y-1 overflow-x-auto max-h-40">
                  {result.logs.map((log, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="text-secondary-fixed-dim">[{String(idx + 1).padStart(2, '0')}]</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Table Pagination Footer */}
            <div className="px-space-md py-space-sm bg-surface-container-low flex flex-wrap items-center justify-between text-label-xs font-label-xs text-on-surface-variant gap-space-sm border-t border-structural font-mono">
              <span>Showing {rows.length} sampled rows; association-based estimate {fmtInt(result?.harmonizedUniqueEvents)}</span>
              <div className="flex items-center gap-space-sm">
                <span className="text-on-surface font-semibold">Page 1 / 1</span>
                <div className="flex items-center gap-1">
                  <button className="px-2 py-1 rounded bg-surface-container-high text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50" disabled>
                    ← Prev
                  </button>
                  <button className="px-2 py-1 rounded bg-surface-container-high text-on-surface hover:bg-surface-container transition-colors">
                    Next →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
