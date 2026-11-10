import React, { useState } from 'react';
import { api } from '../services/api';
import { ALL_PLATFORMS, HarmonizationResult, HarmonizedClusterExcerpt, SatellitePlatform } from '../types/firenexus';
import { ApiError } from '../services/api';
import { useApiResource } from '../hooks/useApi';
import { EmptyState, LoadingState } from '../components/common/StatePanel';
import { Alert } from '../components/ui/Alert';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, inputClass } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { Skeleton } from '../components/ui/Skeleton';
import { EMPTY, fmtInt } from '../utils/format';
import { cn } from '../utils/cn';

const PLATFORM_LABELS: Record<SatellitePlatform, { badge: string; tone: 'modis' | 'viirs'; orbit: string; res: string }> = {
  Terra: { badge: 'MODIS Terra', tone: 'modis', orbit: 'Terra', res: '1000m nadir' },
  Aqua: { badge: 'MODIS Aqua', tone: 'modis', orbit: 'Aqua', res: '1000m nadir' },
  'Suomi-NPP': { badge: 'VIIRS S-NPP', tone: 'viirs', orbit: 'Suomi-NPP', res: '375m I-Band' },
  'NOAA-20': { badge: 'VIIRS NOAA-20', tone: 'viirs', orbit: 'NOAA-20', res: '375m I-Band' },
  'NOAA-21': { badge: 'VIIRS NOAA-21', tone: 'viirs', orbit: 'NOAA-21', res: '375m I-Band' },
};

const StepHeading: React.FC<{ n: number; id: string; title: string; description?: string; right?: React.ReactNode }> = ({
  n, id, title, description, right,
}) => (
  <div id={id} className="flex scroll-mt-24 flex-wrap items-start justify-between gap-3">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-body text-body-sm font-semibold text-on-primary">{n}</span>
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>
        {description && <p className="mt-0.5 font-body text-body-sm text-on-surface-variant">{description}</p>}
      </div>
    </div>
    {right}
  </div>
);

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
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

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

  const executionStatus: { label: string; tone: BadgeTone } = isRunning
    ? { label: 'Running…', tone: 'primary' }
    : runError
    ? { label: 'Run failed', tone: 'error' }
    : result
    ? result.status === 'completed'
      ? { label: 'Job completed', tone: 'success' }
      : result.status === 'failed'
      ? { label: 'Job failed', tone: 'error' }
      : { label: result.status.charAt(0).toUpperCase() + result.status.slice(1), tone: 'neutral' }
    : !datasetsReady
    ? { label: 'Awaiting NASA dataset', tone: 'neutral' }
    : errors.length
    ? { label: 'Parameters incomplete', tone: 'warning' }
    : { label: 'Ready to run', tone: 'success' };

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

  const loadedCatalogs = readiness ? readiness.inputs.filter((i) => i.available).length : null;
  const calibrationInvalid = !(calibrationSlope > 0 && calibrationSlope <= 10);
  const advancedVisible = advancedOpen || calibrationInvalid; // never hide an invalid advanced field

  // Workflow overview. Every status is derived from real state.
  const steps: { id: string; label: string; status: string; done: boolean }[] = [
    {
      id: 'step-data',
      label: 'Data',
      status: readinessRes.error ? 'Unavailable' : loadedCatalogs === null ? 'Checking…' : `${loadedCatalogs} of 5 catalogs loaded`,
      done: datasetsReady,
    },
    { id: 'step-parameters', label: 'Parameters', status: errors.length === 0 ? 'Valid' : `${errors.length} to fix`, done: errors.length === 0 },
    { id: 'step-run', label: 'Run', status: executionStatus.label, done: result?.status === 'completed' },
    { id: 'step-results', label: 'Results', status: result ? 'Available' : 'No run yet', done: !!result },
  ];

  const prerequisites: { ok: boolean; text: string }[] = [
    {
      ok: datasetsReady,
      text: datasetsReady
        ? 'MODIS and VIIRS datasets are loaded'
        : readinessRes.error
        ? `Cannot verify dataset availability: ${readinessRes.error.message}`
        : readiness?.reason ?? 'Checking dataset availability…',
    },
    ...(errors.length === 0
      ? [{ ok: true, text: 'Processing parameters are valid' }]
      : errors.map((text) => ({ ok: false, text }))),
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-space-xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Harmonization Studio"
        description="Match MODIS and VIIRS detections that coincide in space and time, using the datasets loaded in the platform."
      />

      {/* Workflow overview */}
      <nav aria-label="Harmonization workflow">
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex items-center gap-3 rounded-lg border border-border-grid bg-surface-container-lowest px-3 py-2.5 transition-colors hover:bg-surface-container-low"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-body text-label-xs font-semibold',
                    s.done ? 'bg-validated text-on-primary' : 'bg-surface-container-high text-on-surface-variant',
                  )}
                >
                  {s.done ? <span className="material-symbols-outlined text-[16px] leading-none">check</span> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-body text-body-sm font-semibold text-on-surface">{s.label}</span>
                  <span className="block truncate font-label-xs text-label-xs text-on-surface-variant">{s.status}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ================= 1. DATA ================= */}
      <section aria-labelledby="step-data" className="flex flex-col gap-4">
        <StepHeading
          n={1}
          id="step-data"
          title="Data"
          description="Choose which platforms to include. You need at least one MODIS and one VIIRS platform."
          right={<span className="font-body text-body-sm text-on-surface-variant">{loadedCatalogs === null ? (readinessRes.error ? 'Unavailable' : 'Checking…') : `${loadedCatalogs} of 5 catalogs loaded`}</span>}
        />

        {readinessRes.error && (
          <Alert tone="error" title="Can’t verify dataset availability" onRetry={readinessRes.reload}>
            {readinessRes.error.message}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ALL_PLATFORMS.map((p) => {
            const meta = PLATFORM_LABELS[p];
            const input = inputFor(p);
            const available = input?.available ?? false;
            const selected = selectedSensors.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={selected}
                title={selected ? 'Click to exclude from processing' : 'Click to include in processing'}
                onClick={() => toggleSensor(p)}
                className={cn(
                  'flex flex-col gap-3 rounded-xl border bg-surface-container-lowest p-4 text-left shadow-card transition-colors hover:bg-surface-container-low',
                  selected ? 'border-primary' : 'border-border-grid opacity-70',
                )}
              >
                <span className="flex"><Badge tone={meta.tone}>{meta.badge}</Badge></span>

                <span className="flex flex-col">
                  <span className="font-label-xs text-label-xs text-on-surface-variant">Records ingested</span>
                  <span className="font-headline-md text-headline-md leading-tight text-on-surface">
                    {readiness ? fmtInt(input?.recordCount ?? 0) : readinessRes.error ? EMPTY : <Skeleton className="mt-1 h-6 w-16" />}
                  </span>
                </span>

                <dl className="flex flex-col gap-1 font-body text-body-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-on-surface-variant">Product</dt>
                    <dd className="font-mono text-label-xs text-on-surface">{input?.product ?? EMPTY}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-on-surface-variant">Nadir resolution</dt>
                    <dd className="text-on-surface">{meta.res}</dd>
                  </div>
                </dl>

                <span className="flex items-center justify-between gap-2">
                  <span className={cn('flex items-center gap-1.5 font-label-xs text-label-xs', available ? 'text-validated' : 'text-on-surface-variant')}>
                    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', available ? 'bg-validated' : 'bg-outline')} />
                    {readiness ? (available ? 'Loaded' : 'Not loaded') : readinessRes.error ? 'Unavailable' : 'Checking…'}
                  </span>
                  <span className={cn('flex items-center gap-1 font-label-xs text-label-xs', selected ? 'font-semibold text-primary' : 'text-on-surface-variant')}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
                      {selected ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    {selected ? 'Included' : 'Excluded'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ================= 2. PARAMETERS ================= */}
      <section aria-labelledby="step-parameters" className="flex flex-col gap-4">
        <StepHeading
          n={2}
          id="step-parameters"
          title="Parameters"
          description="Detections are matched when they lie within the chosen spatial distance and temporal window. Only matches computed from the loaded datasets are reported."
        />

        <Card padding="lg">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            <div className="flex flex-col gap-6 lg:col-span-3">
              <Field
                label="Analysis window (UTC)"
                right={<span className="font-mono text-label-xs text-on-surface-variant">EPSG:4326 (WGS 84)</span>}
                hint={`${selectedSensors.length} of 5 platforms selected`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    aria-label="Start date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={cn(inputClass, 'min-w-0 flex-1 sm:flex-none')}
                  />
                  <span aria-hidden="true" className="text-outline">→</span>
                  <input
                    type="date"
                    aria-label="End date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={cn(inputClass, 'min-w-0 flex-1 sm:flex-none')}
                  />
                </div>
              </Field>

              <Field
                label="Temporal coincidence window (Δt)"
                htmlFor="temporal-window"
                right={<span className="font-body text-body-sm font-semibold text-primary">± {temporalWindow} minutes</span>}
              >
                <input
                  id="temporal-window"
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={temporalWindow}
                  onChange={(e) => setTemporalWindow(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-container-high accent-primary"
                />
                <div className="flex gap-1.5">
                  {[15, 30, 45, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTemporalWindow(m)}
                      aria-pressed={temporalWindow === m}
                      className={cn(
                        'rounded-md px-2.5 py-1 font-label-xs text-label-xs transition-colors',
                        temporalWindow === m ? 'bg-primary/10 font-semibold text-primary' : 'text-on-surface-variant hover:bg-surface-container',
                      )}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label="Spatial matching distance (Δs)"
                htmlFor="spatial-distance"
                hint="Maximum great-circle distance between a VIIRS and a MODIS detection to be considered coincident."
              >
                <div className="flex items-center gap-2">
                  <input
                    id="spatial-distance"
                    type="number"
                    min={1}
                    max={5000}
                    aria-label="Spatial distance in meters"
                    value={spatialDistance}
                    onChange={(e) => setSpatialDistance(Number(e.target.value))}
                    className={cn(inputClass, 'w-28 font-mono')}
                  />
                  <span className="font-body text-body-md text-on-surface-variant">meters</span>
                </div>
              </Field>
            </div>

            {/* Schematic: live values, no data */}
            <div className="flex flex-col gap-2 rounded-lg bg-surface-container-low p-4 lg:col-span-2">
              <span className="font-body text-body-sm font-medium text-on-surface">Matching footprint (schematic)</span>
              <svg className="h-24 w-full text-on-surface-variant" fill="none" viewBox="0 0 380 90" role="img" aria-label="Schematic of a MODIS and a VIIRS detection footprint overlapping at the centre">
                <line opacity="0.3" stroke="currentColor" strokeWidth="1" x1="20" x2="360" y1="75" y2="75" />
                <line opacity="0.3" stroke="currentColor" strokeDasharray="2 2" strokeWidth="1" x1="190" x2="190" y1="10" y2="80" />
                <path className="text-modis" d="M 40 75 Q 190 -20 340 75" fill="none" opacity="0.9" stroke="currentColor" strokeWidth="2" />
                <path className="text-primary" d="M 120 75 Q 190 5 260 75" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle className="text-tertiary" cx="160" cy="55" fill="currentColor" r="3" />
                <circle className="text-primary" cx="190" cy="20" fill="currentColor" r="3" />
                <circle className="text-tertiary" cx="220" cy="55" fill="currentColor" r="3" />
                <text className="text-secondary" fill="currentColor" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="600" x="50" y="45">MODIS</text>
                <text className="text-primary" fill="currentColor" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="600" x="235" y="30">VIIRS</text>
                <text fill="currentColor" fontFamily="Inter, sans-serif" fontSize="9" x="165" y="87">Δs = 0 (centre)</text>
              </svg>
              <div className="flex items-center justify-between font-mono text-label-xs text-on-surface-variant">
                <span>Δs ≤ {spatialDistance} m</span>
                <span>Δt ≤ {temporalWindow} min</span>
              </div>
            </div>
          </div>

          {/* Advanced parameters (collapsed by default) */}
          <details
            open={advancedVisible}
            onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
            className="group mt-6 border-t border-border-grid pt-4"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md font-body text-body-md font-medium text-on-surface [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none text-on-surface-variant transition-transform group-open:rotate-90">chevron_right</span>
              Advanced parameters
              <span className="font-body text-body-sm font-normal text-on-surface-variant">Confidence thresholds, FRP calibration, PSF</span>
            </summary>

            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
              <Field label="MODIS minimum confidence" htmlFor="modis-min-conf" hint="MODIS numeric confidence is filtered.">
                <input
                  id="modis-min-conf"
                  type="number"
                  min={0}
                  max={100}
                  aria-label="MODIS minimum confidence"
                  value={modisMinConf}
                  onChange={(e) => setModisMinConf(Number(e.target.value))}
                  className={cn(inputClass, 'w-28 font-mono')}
                />
              </Field>

              <Field label="VIIRS minimum confidence" htmlFor="viirs-min-conf" hint="VIIRS confidence classes are preserved; no numeric VIIRS threshold is applied.">
                <input
                  id="viirs-min-conf"
                  type="number"
                  min={0}
                  max={100}
                  aria-label="VIIRS minimum confidence"
                  value={viirsMinConf}
                  disabled
                  onChange={(e) => setViirsMinConf(Number(e.target.value))}
                  className={cn(inputClass, 'w-28 font-mono')}
                />
              </Field>

              <Field
                label="FRP empirical calibration (k)"
                htmlFor="frp-slope"
                hint="Reserved calibration factor (1 = none). Validated now; applied once calibration is implemented."
              >
                <input
                  id="frp-slope"
                  type="number"
                  step="0.001"
                  min={0}
                  aria-label="FRP calibration slope"
                  aria-invalid={calibrationInvalid || undefined}
                  value={calibrationSlope}
                  onChange={(e) => setCalibrationSlope(Number(e.target.value))}
                  className={cn(inputClass, 'w-28 font-mono', calibrationInvalid && 'border-error')}
                />
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-container-low p-4">
              <span className="font-body text-body-md font-medium text-on-surface">Gaussian PSF weighting</span>
              <Badge>Not implemented</Badge>
              <p className="basis-full font-body text-body-sm text-on-surface-variant">
                PSF deconvolution is not available in this build. The run always uses point-to-point matching.
              </p>
            </div>
          </details>
        </Card>
      </section>

      {/* ================= 3. RUN ================= */}
      <section aria-labelledby="step-run" className="flex flex-col gap-4">
        <StepHeading
          n={3}
          id="step-run"
          title="Run"
          right={<Badge tone={executionStatus.tone} dot>{executionStatus.label}</Badge>}
        />

        <Card padding="lg">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Before you run</h3>
              <ul id="run-prerequisites" className="flex flex-col gap-2">
                {prerequisites.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 font-body text-body-md text-on-surface">
                    <span
                      aria-hidden="true"
                      className={cn('material-symbols-outlined mt-0.5 text-[18px] leading-none', c.ok ? 'text-validated' : 'text-error')}
                    >
                      {c.ok ? 'check_circle' : 'cancel'}
                    </span>
                    <span>
                      <span className="sr-only">{c.ok ? 'Done: ' : 'Needs attention: '}</span>
                      {c.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Configuration</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 font-body text-body-sm">
                <dt className="text-on-surface-variant">Window</dt>
                <dd className="font-mono text-label-xs text-on-surface">{startDate && endDate ? `${startDate} → ${endDate}` : 'Not selected'}</dd>
                <dt className="text-on-surface-variant">Platforms</dt>
                <dd className="text-on-surface">{selectedSensors.length} of 5</dd>
                <dt className="text-on-surface-variant">Δs / Δt</dt>
                <dd className="font-mono text-label-xs text-on-surface">≤ {spatialDistance} m / ± {temporalWindow} min</dd>
                <dt className="text-on-surface-variant">Min. confidence</dt>
                <dd className="font-mono text-label-xs text-on-surface">MODIS {modisMinConf}</dd>
              </dl>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t border-border-grid pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                icon="play_arrow"
                loading={isRunning}
                disabled={!canRun}
                onClick={handleRunHarmonization}
                title={disabledReason ?? undefined}
                aria-describedby="run-prerequisites"
                className="w-full sm:w-auto"
              >
                {isRunning ? 'Running…' : 'Run Harmonization Engine'}
              </Button>
              {!canRun && !isRunning && (
                <p role="status" className="font-body text-body-sm text-on-surface-variant">
                  Complete the items marked above to enable the run.
                </p>
              )}
            </div>

            {runError && (
              <Alert tone="error" title="The harmonization run did not complete" onRetry={canRun ? handleRunHarmonization : undefined}>
                {runError.message}
              </Alert>
            )}
            {result?.status === 'failed' && (
              <Alert tone="error" title="The job finished with status “failed”">
                Job <span className="font-mono">{result.jobId}</span> did not produce results. Check the processing log in the results section if one was returned.
              </Alert>
            )}
          </div>
        </Card>
      </section>

      {/* ================= 4. RESULTS ================= */}
      <section aria-labelledby="step-results" className="flex flex-col gap-4">
        <StepHeading
          n={4}
          id="step-results"
          title="Results"
          description={result ? undefined : 'Cross-sensor matches appear here after a run.'}
          right={
            <div className="flex flex-wrap items-center gap-2">
              {result && <span className="font-mono text-label-xs text-on-surface-variant">Job {result.jobId}</span>}
              <Button size="sm" icon="download" disabled title="Export is available after a completed harmonization run">Export NetCDF-4</Button>
              <Button size="sm" icon="table_view" disabled title="Export is available after a completed harmonization run">CSV / Parquet</Button>
            </div>
          }
        />

        {!result && isRunning && (
          <Card><LoadingState label="Running harmonization…" className="py-10" /></Card>
        )}

        {!result && !isRunning && (
          <Card>
            <EmptyState
              icon="analytics"
              title="No harmonization run yet"
              detail="Load the datasets, set the parameters and run the engine to see cross-sensor matches."
            />
          </Card>
        )}

        {result && (
          <>
            {/* Summary metrics: one surface, hairline separators */}
            <div className="overflow-hidden rounded-xl border border-border-grid bg-border-grid shadow-card">
              <div className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-5">
                <div className="flex flex-col gap-1 bg-surface-container-lowest p-5">
                  <span className="font-body text-body-sm text-on-surface-variant">Selected input observations</span>
                  <span className="font-headline-md text-headline-md text-on-surface">{fmtInt(result.totalRawRecords)}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">Sum of selected satellite catalogs</span>
                </div>

                <div className="flex flex-col gap-1 bg-surface-container-lowest p-5">
                  <span className="font-body text-body-sm text-on-surface-variant">Association-based event estimate</span>
                  <span className="font-headline-md text-headline-md text-primary">{fmtInt(result.harmonizedUniqueEvents)}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {total ? `${((total - (result.harmonizedUniqueEvents ?? 0)) / total * 100).toFixed(1)}% reduction · ` : ''}after one-to-one confirmed associations
                  </span>
                </div>

                <div className="flex flex-col gap-1 bg-surface-container-lowest p-5">
                  <span className="font-body text-body-sm text-on-surface-variant">Confirmed cross-matches</span>
                  <span className="font-headline-md text-headline-md text-secondary">{fmtInt(result.confirmedCrossMatches)}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">{pct(result.confirmedCrossMatches)} of input · coincident MODIS + VIIRS hits</span>
                </div>

                <div className="flex flex-col gap-1 bg-surface-container-lowest p-5">
                  <span className="font-body text-body-sm text-on-surface-variant">Unmatched VIIRS observations</span>
                  <span className="font-headline-md text-headline-md text-tertiary">{fmtInt(result.unmatchedViirsObservations)}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">{pct(result.unmatchedViirsObservations)} of input · no selected MODIS association</span>
                </div>

                <div className="flex flex-col gap-1 bg-surface-container-lowest p-5">
                  <span className="font-body text-body-sm text-on-surface-variant">Cross-sensor FRP agreement</span>
                  <span className="font-headline-md text-headline-md text-on-surface">r = {result.pearsonR ?? EMPTY}</span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {result.pearsonR !== null && result.pearsonR !== undefined ? `R² ${result.rSquared} · ` : ''}Pearson correlation of coincident FRP pairs
                  </span>
                </div>
              </div>
            </div>

            {/* Matches table */}
            <Card padding="none" title="Spatial coincidence matches" description={`Showing ${rows.length} sampled rows; association-based estimate ${fmtInt(result.harmonizedUniqueEvents)}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-left">
                  <thead>
                    <tr className="border-y border-border-grid bg-surface-container-low font-label-xs text-label-xs text-on-surface-variant">
                      <th scope="col" className="px-5 py-2.5 font-medium">Cluster ID</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Lat / Lon (centroid)</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">MODIS timestamp</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">VIIRS timestamp</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Δs offset</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Δt delta</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">MODIS FRP</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">VIIRS FRP</th>
                      <th scope="col" className="px-5 py-2.5 font-medium">Harmonization status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-grid font-body text-body-sm">
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9}>
                          <EmptyState compact title="No matches in this job" detail="The job produced no coincident or unmatched observations" />
                        </td>
                      </tr>
                    )}
                    {rows.map((row) => (
                      <tr key={row.clusterId} className="transition-colors hover:bg-surface-container-low">
                        <td className="px-5 py-3 font-mono text-label-xs font-medium text-on-surface">{row.clusterId}</td>
                        <td className="px-3 py-3 font-mono text-label-xs text-on-surface-variant">
                          {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
                        </td>
                        <td className="px-3 py-3 font-mono text-label-xs text-on-surface">
                          {row.modisTimestamp || <span className="font-body text-body-sm text-on-surface-variant">Not detected</span>}
                        </td>
                        <td className="px-3 py-3 font-mono text-label-xs text-on-surface">{row.viirsTimestamp || EMPTY}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-on-surface">
                          {row.deltaSpatialM !== null ? `${row.deltaSpatialM} m` : EMPTY}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-on-surface">
                          {row.deltaTemporalMin !== null ? `${row.deltaTemporalMin.toFixed(1)} min` : EMPTY}
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums text-secondary">
                          {row.modisFrp !== null ? `${row.modisFrp.toFixed(1)} MW` : EMPTY}
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums text-primary">
                          {row.viirsFrp !== null ? `${row.viirsFrp.toFixed(1)} MW` : EMPTY}
                        </td>
                        <td className="px-5 py-3">
                          {row.status === 'harmonized_match' && <Badge tone="success" dot>Harmonized match</Badge>}
                          {row.status === 'viirs_unmatched' && <Badge tone="viirs">VIIRS unmatched</Badge>}
                          {row.status === 'candidate_duplicate' && <Badge tone="primary" dot>Candidate duplicate</Badge>}
                          {row.status === 'modis_unmatched' && <Badge tone="modis">MODIS unmatched</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.logs && result.logs.length > 0 && (
                <details className="group border-t border-border-grid px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md font-body text-body-md font-medium text-on-surface [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none text-on-surface-variant transition-transform group-open:rotate-90">chevron_right</span>
                    Processing log
                    <span className="font-body text-body-sm font-normal text-on-surface-variant">{result.logs.length} lines</span>
                  </summary>
                  <div className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg bg-inverse-surface p-4 font-mono text-label-xs text-inverse-on-surface">
                    {result.logs.map((log, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="shrink-0 text-secondary-fixed-dim">[{String(idx + 1).padStart(2, '0')}]</span>
                        <span>{log}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          </>
        )}
      </section>
    </div>
  );
};
