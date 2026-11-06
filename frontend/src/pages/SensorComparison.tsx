import React, { useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import { FireObservation } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtInt, fmtNum } from '../utils/format';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';
import { MapLibreCanvas } from '../components/maps/MapLibreCanvas';

const MODIS_PLATFORMS = ['Terra', 'Aqua'] as const;
const VIIRS_PLATFORMS = ['Suomi-NPP', 'NOAA-20', 'NOAA-21'] as const;

const NULL_STATS = { slope: null, intercept: null, rSquared: null, pearsonR: null, rmseMw: null, meanBiasMw: null, nPairs: 0, methodology: '' };

export const SensorComparison: React.FC = () => {
  const [spatialLock, setSpatialLock] = useState<boolean>(true);
  const [spatialTol, setSpatialTol] = useState<number>(750);
  const [temporalWin, setTemporalWin] = useState<number>(30);
  const [modisPlatform, setModisPlatform] = useState<string>('all');
  const [viirsPlatform, setViirsPlatform] = useState<string>('all');
  const [showBias, setShowBias] = useState<boolean>(false);
  const [selectedHotspot, setSelectedHotspot] = useState<FireObservation | null>(null);

  const paramsValid = spatialTol > 0 && spatialTol <= 5000 && temporalWin > 0 && temporalWin <= 180;
  const compRes = useApiResource(
    () =>
      paramsValid
        ? api.getSensorComparison({ spatialToleranceM: spatialTol, temporalWindowMin: temporalWin })
        : Promise.reject(new ApiError('Spatial tolerance must be 1–5000 m and temporal window 1–180 min.', 422, 'INVALID_RANGE')),
    [spatialTol, temporalWin],
  );
  const hotspotsRes = useApiResource(() => api.getExplorerHotspots(), []);
  const data = compRes.data;
  const hotspots = hotspotsRes.data?.items ?? [];
  const noDataset = data?.status === 'no_dataset';
  const stats = data?.regressionStats ?? NULL_STATS;
  const loadedOnce = useRef(false);
  if (data) loadedOnce.current = true;
  const pairs = data?.frpScatterPairs ?? [];
  const hist = data?.frpDistributionHistogram ?? [];

  const handleExportPairs = () => {
    if (pairs.length === 0) return;
    const rows = pairs.map((p) => `${p.modisFrp},${p.viirsFrp},${p.deltaM}`).join('\n');
    const url = URL.createObjectURL(new Blob([`modis_frp_mw,viirs_frp_mw,delta_m\n${rows}`], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coincident_frp_pairs.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!loadedOnce.current && compRes.loading) {
    return <LoadingState className="p-space-lg min-h-[500px]" label="LOADING DUAL-INSTRUMENT COMPARISON..." />;
  }
  if (!loadedOnce.current && compRes.error) {
    return <ErrorState className="m-space-lg min-h-[500px]" error={compRes.error} onRetry={compRes.reload} />;
  }

  const modisHotspots = hotspots.filter((h) => h.source === 'MODIS' && (modisPlatform === 'all' || h.platform === modisPlatform));
  const viirsHotspots = hotspots.filter((h) => h.source === 'VIIRS' && (viirsPlatform === 'all' || h.platform === viirsPlatform));
  const modisTotal = hist.reduce((n, b) => n + b.modisCount, 0);
  const viirsTotal = hist.reduce((n, b) => n + b.viirsCount, 0);
  const nPairs = stats.nPairs;
  const pairShare = viirsTotal > 0 ? (nPairs / viirsTotal) * 100 : null;

  return (
    <div className="flex flex-col w-full font-mono">
      {/* Sub-Header / Telemetry Utility Ribbon */}
      <div className="bg-surface-container border-b border-structural px-space-lg py-space-sm flex flex-wrap items-center justify-between gap-space-sm select-none">
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-space-xs font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
            <span className="inline-block w-2 h-2 rounded-full bg-primary"></span>
            <span className="font-medium text-on-surface">Module 06</span>
            <span>/</span>
            <span>Dual-Sensor Intercomparison &amp; Footprint Harmonization</span>
          </div>
          <div className="h-3.5 w-px bg-surface-container-highest hidden sm:block"></div>
          <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-0.5 rounded shadow-sm border border-structural">
            <span className="material-symbols-outlined text-[14px] text-tertiary">sync_alt</span>
            <span className="font-label-xs text-label-xs text-on-surface">MODIS ⇄ VIIRS</span>
            <span className="font-label-xs text-label-xs text-on-surface-variant font-medium ml-1">Δt ≤ {temporalWin}m</span>
          </div>
        </div>

        {/* Spatial & Pipeline Actions */}
        <div className="flex items-center gap-space-sm">
          <label className="inline-flex items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
            Δs ≤
            <input
              type="number" min={1} max={5000} aria-label="Spatial tolerance (m)" value={spatialTol}
              onChange={(e) => setSpatialTol(Number(e.target.value))}
              className="w-16 bg-surface-container-lowest text-on-surface px-1 py-0.5 rounded border border-structural outline-none"
            />
            m
          </label>
          <label className="inline-flex items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
            Δt ≤
            <input
              type="number" min={1} max={180} aria-label="Temporal window (min)" value={temporalWin}
              onChange={(e) => setTemporalWin(Number(e.target.value))}
              className="w-14 bg-surface-container-lowest text-on-surface px-1 py-0.5 rounded border border-structural outline-none"
            />
            min
          </label>
          <button
            disabled
            title="PSF inspection is not implemented yet"
            className="bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-xs text-label-xs px-space-sm py-1 rounded shadow-sm flex items-center gap-1 transition-colors border border-structural"
          >
            <span className="material-symbols-outlined text-[13px]">tune</span>
            <span>PSF Inspector</span>
          </button>
          <button
            onClick={() => setShowBias((v) => !v)}
            className="bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-xs text-label-xs px-space-sm py-1 rounded shadow-sm flex items-center gap-1 transition-colors border border-structural"
          >
            <span className="material-symbols-outlined text-[13px]">calculate</span>
            <span>Calculate Bias</span>
          </button>
          <button
            onClick={handleExportPairs}
            disabled={pairs.length === 0}
            title={pairs.length === 0 ? 'No coincident pairs to export' : 'Download coincident FRP pairs as CSV'}
            className="bg-primary hover:bg-primary-container text-on-primary font-label-xs text-label-xs px-space-md py-1 rounded shadow-sm flex items-center gap-1 transition-colors font-medium"
          >
            <span className="material-symbols-outlined text-[13px]">file_download</span>
            <span>Export Pairs (CSV)</span>
          </button>
        </div>
      </div>

      {showBias && (
        <div className="px-space-lg py-space-sm bg-surface-container-low border-b border-structural font-mono text-label-xs">
          {stats.slope === null ? (
            <span className="text-on-surface-variant">
              {noDataset ? `${NO_DATASET}. ${AWAITING_NASA}.` : `Bias is undefined: ${nPairs} coincident pair(s); at least 3 pairs with variance are required.`}
            </span>
          ) : (
            <span className="text-on-surface">
              OLS (VIIRS = k·MODIS + b) on {nPairs.toLocaleString()} pairs — k = {stats.slope}, b = {stats.intercept} MW, r = {stats.pearsonR}, R² = {stats.rSquared},
              RMSE = {stats.rmseMw} MW, mean bias (VIIRS − MODIS) = {stats.meanBiasMw} MW
            </span>
          )}
        </div>
      )}
      {compRes.error && <ErrorState className="m-space-md" error={compRes.error} onRetry={compRes.reload} />}

      <div className="p-space-lg flex flex-col gap-space-md bg-surface">
        {/* 1. Analytical Metric KPI Strip (4 Panels) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-center justify-between pb-space-xs">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                Coincident Pairs
              </span>
              <span className="material-symbols-outlined text-[16px] text-tertiary">sync_alt</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant">Δs ≤ {spatialTol} m • Δt ≤ {temporalWin} min</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">{fmtInt(noDataset ? null : nPairs)}</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="font-label-xs text-label-xs text-on-surface-variant">VIIRS matched</span>
                <span className="font-headline-sm text-headline-sm text-primary">{pairShare !== null ? `${pairShare.toFixed(1)}%` : EMPTY}</span>
              </div>
            </div>
            <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-2 flex">
              <div className="bg-tertiary-container h-full" style={{ width: `${pairShare ?? 0}%` }}></div>
            </div>
            <span className="font-label-xs text-[10px] text-on-surface-variant mt-1.5 flex justify-between">
              <span>Confirmed matches</span>
              <span className="text-on-surface font-medium">{noDataset ? NO_DATASET : 'computed'}</span>
            </span>
          </div>
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-center justify-between pb-space-xs">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                Detection Counts
              </span>
              <span className="material-symbols-outlined text-[16px] text-primary">local_fire_department</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant">MODIS</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">{fmtInt(noDataset ? null : modisTotal)}</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="font-label-xs text-label-xs text-on-surface-variant">VIIRS</span>
                <span className="font-headline-sm text-headline-sm text-primary">{fmtInt(noDataset ? null : viirsTotal)}</span>
              </div>
            </div>
            <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-2 flex">
              <><div className="bg-secondary h-full" style={{ width: `${(modisTotal + viirsTotal > 0 ? (modisTotal / (modisTotal + viirsTotal)) * 100 : 0)}%` }}></div><div className="bg-tertiary-container h-full" style={{ width: `${modisTotal + viirsTotal > 0 ? 100 - (modisTotal + viirsTotal > 0 ? (modisTotal / (modisTotal + viirsTotal)) * 100 : 0) : 0}%` }}></div></>
            </div>
            <span className="font-label-xs text-[10px] text-on-surface-variant mt-1.5 flex justify-between">
              <span>FRP-bearing detections</span>
              <span className="text-on-surface font-medium">by sensor</span>
            </span>
          </div>
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-center justify-between pb-space-xs">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                FRP Agreement
              </span>
              <span className="material-symbols-outlined text-[16px] text-secondary">grid_goldenratio</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant">R²</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">{fmtNum(stats.rSquared, 3)}</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="font-label-xs text-label-xs text-on-surface-variant">OLS slope k</span>
                <span className="font-headline-sm text-headline-sm text-primary">{fmtNum(stats.slope, 3)}</span>
              </div>
            </div>
            <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-2 flex">
              <div className="bg-primary h-full" style={{ width: `${(stats.rSquared ?? 0) * 100}%` }}></div>
            </div>
            <span className="font-label-xs text-[10px] text-on-surface-variant mt-1.5 flex justify-between">
              <span>Pearson r</span>
              <span className="text-on-surface font-medium">{fmtNum(stats.pearsonR, 3)}</span>
            </span>
          </div>
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-center justify-between pb-space-xs">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                Bias &amp; Error
              </span>
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">flaky</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant">Mean bias (V−M)</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">{stats.meanBiasMw !== null ? `${stats.meanBiasMw} MW` : EMPTY}</span>
              </div>
              <div className="flex flex-col text-right">
                <span className="font-label-xs text-label-xs text-on-surface-variant">RMSE</span>
                <span className="font-headline-sm text-headline-sm text-primary">{stats.rmseMw !== null ? `${stats.rmseMw} MW` : EMPTY}</span>
              </div>
            </div>
            <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mt-2 flex">
              <div className="bg-secondary h-full opacity-40" style={{ width: `${stats.rSquared !== null ? 100 : 0}%` }}></div>
            </div>
            <span className="font-label-xs text-[10px] text-on-surface-variant mt-1.5 flex justify-between">
              <span>Pairs with FRP</span>
              <span className="text-on-surface font-medium">{fmtInt(noDataset ? null : stats.nPairs)}</span>
            </span>
          </div>
        </div>

        {/* 2. Dual Synchronized GIS Workstation (Split Viewport) */}
        <div className="bg-surface-container-lowest rounded shadow-sm overflow-hidden flex flex-col border border-structural">
          {/* Cartographic Utility Ribbon */}
          <div className="bg-surface-container-high px-space-md py-space-xs flex items-center justify-between text-on-surface select-none border-b border-structural">
            <div className="flex items-center gap-space-md">
              <span className="font-label-xs text-label-xs uppercase font-medium flex items-center gap-1 text-on-surface">
                <span className="material-symbols-outlined text-[15px] text-primary">satellite_alt</span>
                Split Viewport (EPSG:4326)
              </span>
              <div className="h-3 w-px bg-surface-container-highest"></div>
              <div className="flex items-center gap-1 font-label-xs text-label-xs text-on-surface-variant">
                <span>Reticle Center:</span>
                <span className="font-medium text-on-surface bg-surface-container px-1 py-0.5 rounded border border-structural">
                  {selectedHotspot ? `${selectedHotspot.latitude.toFixed(4)}, ${selectedHotspot.longitude.toFixed(4)}` : EMPTY}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-space-sm font-label-xs text-label-xs">
              <button
                onClick={() => setSpatialLock(!spatialLock)}
                className={`flex items-center gap-1 px-space-sm py-0.5 rounded shadow-sm font-medium transition-colors border border-structural ${
                  spatialLock ? 'bg-surface-container-lowest text-on-surface' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <span className="material-symbols-outlined text-[13px] text-primary">link</span>
                <span>Spatial Lock {spatialLock ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Split Map Workstation Body (50% / 50%) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[460px] relative bg-surface-dim divide-x divide-structural">
            {/* LEFT PANEL: MODIS */}
            <div className="relative flex flex-col overflow-hidden min-h-[380px] select-none">
              <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 pointer-events-none">
                <div className="flex items-center gap-space-xs bg-surface-container-lowest/95 backdrop-blur px-space-sm py-1 rounded shadow-sm border border-structural">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-secondary"></span>
                  <select
                    aria-label="MODIS platform"
                    value={modisPlatform}
                    onChange={(e) => setModisPlatform(e.target.value)}
                    className="pointer-events-auto bg-transparent font-label-xs text-label-xs font-semibold text-secondary outline-none cursor-pointer"
                  >
                    <option value="all">MODIS (Terra + Aqua)</option>
                    {MODIS_PLATFORMS.map((p) => <option key={p} value={p}>MODIS {p}</option>)}
                  </select>
                  <span className="font-label-xs text-[10px] bg-secondary-fixed text-on-secondary-fixed-variant px-1 rounded font-semibold">
                    1000m Res
                  </span>
                </div>
                <div className="flex items-center gap-space-xs bg-surface-container-lowest/90 px-space-sm py-0.5 rounded shadow-sm text-on-surface-variant font-label-xs text-[10px] border border-structural">
                  <span>{modisHotspots.length.toLocaleString()} observations</span>
                </div>
              </div>

              <MapLibreCanvas
                hotspots={modisHotspots}
                selectedHotspot={selectedHotspot}
                onSelectHotspot={(h) => setSelectedHotspot(h)}
                showModis={true}
                showViirs={false}
                showHarmonized={false}
                heightClass="h-full w-full absolute inset-0"
                emptyMessage={hotspotsRes.error ? { title: 'Request failed', detail: hotspotsRes.error.message } : { title: NO_DATASET, detail: AWAITING_NASA }}
              />
            </div>

            {/* RIGHT PANEL: VIIRS */}
            <div className="relative flex flex-col overflow-hidden min-h-[380px] select-none">
              <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 pointer-events-none">
                <div className="flex items-center gap-space-xs bg-surface-container-lowest/95 backdrop-blur px-space-sm py-1 rounded shadow-sm border border-structural">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-tertiary"></span>
                  <select
                    aria-label="VIIRS platform"
                    value={viirsPlatform}
                    onChange={(e) => setViirsPlatform(e.target.value)}
                    className="pointer-events-auto bg-transparent font-label-xs text-label-xs font-semibold text-tertiary outline-none cursor-pointer"
                  >
                    <option value="all">VIIRS (all platforms)</option>
                    {VIIRS_PLATFORMS.map((p) => <option key={p} value={p}>VIIRS {p}</option>)}
                  </select>
                  <span className="font-label-xs text-[10px] bg-tertiary-fixed text-on-tertiary-fixed-variant px-1 rounded font-semibold">
                    375m I-Band
                  </span>
                </div>
                <div className="flex items-center gap-space-xs bg-surface-container-lowest/90 px-space-sm py-0.5 rounded shadow-sm text-on-surface-variant font-label-xs text-[10px] border border-structural">
                  <span>{viirsHotspots.length.toLocaleString()} observations</span>
                </div>
              </div>

              <MapLibreCanvas
                hotspots={viirsHotspots}
                selectedHotspot={selectedHotspot}
                onSelectHotspot={(h) => setSelectedHotspot(h)}
                showModis={false}
                showViirs={true}
                showHarmonized={false}
                heightClass="h-full w-full absolute inset-0"
                emptyMessage={hotspotsRes.error ? { title: 'Request failed', detail: hotspotsRes.error.message } : { title: NO_DATASET, detail: AWAITING_NASA }}
              />
            </div>
          </div>
        </div>

        {/* 3. Statistical Telemetric Discrepancy & Scatter Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md">
          {/* Scatter plot */}
          <div className="lg:col-span-6 bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm border border-structural">
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                FRP Regression (MODIS vs VIIRS)
              </span>
              <span className="font-label-xs text-label-xs text-secondary font-bold">R² = {fmtNum(stats.rSquared, 3)}</span>
            </div>
            <p className="font-body-sm text-[12px] text-on-surface-variant">
              Ordinary least squares of VIIRS FRP on MODIS FRP over coincident detections. Axes autoscale to the loaded data.
            </p>
            <div className="h-52 w-full bg-surface-container-low rounded p-3 flex flex-col justify-end relative border border-structural">
              {pairs.length === 0 ? (
                <EmptyState compact className="h-44" title={noDataset ? NO_DATASET : 'No coincident pairs'} detail={noDataset ? AWAITING_NASA : 'No FRP pairs match the tolerances'} />
              ) : (
                (() => {
                  const axisMax = Math.max(...pairs.map((p) => Math.max(p.modisFrp, p.viirsFrp)), 1e-9) * 1.05;
                  const X = (v: number) => 30 + (v / axisMax) * 290;
                  const Y = (v: number) => 120 - (v / axisMax) * 95;
                  return (
                    <svg className="w-full h-44 overflow-visible" viewBox="0 0 350 150">
                      <line stroke="#dfe4df" x1="30" x2="330" y1="120" y2="120" />
                      <line stroke="#dfe4df" x1="30" x2="30" y1="20" y2="120" />
                      <line stroke="#8a726a" strokeDasharray="3 3" x1={X(0)} x2={X(axisMax)} y1={Y(0)} y2={Y(axisMax)} />
                      {stats.slope !== null && stats.intercept !== null && (
                        <line stroke="#9e3d19" strokeWidth="2" x1={X(0)} x2={X(axisMax)} y1={Y(Math.max(0, stats.intercept))} y2={Y(Math.min(axisMax, stats.slope * axisMax + stats.intercept))} />
                      )}
                      {pairs.map((p, idx) => (
                        <circle key={idx} cx={X(p.modisFrp)} cy={Y(p.viirsFrp)} r={3.5} fill="#C75B35" stroke="#FFFFFF" strokeWidth={1} />
                      ))}
                      <text x="35" y="40" fill="#2d6480" fontSize="9">1:1 Reference</text>
                      {stats.slope !== null && <text x="180" y="32" fill="#9e3d19" fontSize="9" fontWeight="bold">OLS slope k = {stats.slope}</text>}
                      <text x="300" y="135" fill="#8a726a" fontSize="8">{axisMax.toFixed(0)} MW</text>
                    </svg>
                  );
                })()
              )}
              <div className="flex justify-between text-[10px] text-on-surface-variant px-4 pt-1">
                <span>MODIS FRP (MW) →</span>
                <span>VIIRS FRP (MW) ↑</span>
              </div>
            </div>
          </div>

          {/* Histogram breakdown */}
          <div className="lg:col-span-6 bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm border border-structural">
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                FRP Class Detection Counts
              </span>
              <span className="font-label-xs text-label-xs text-primary font-bold">By sensor</span>
            </div>
            <p className="font-body-sm text-[12px] text-on-surface-variant">
              Detections per FRP class for each sensor, computed from the loaded observations.
            </p>
            <div className="space-y-1.5 pt-2 text-[11px]">
              {hist.length === 0 && <EmptyState compact title={NO_DATASET} detail={AWAITING_NASA} />}
              {(() => {
                const max = Math.max(...hist.map((b) => Math.max(b.modisCount, b.viirsCount)), 1);
                return hist.map((bin) => (
                  <div key={bin.frpBin} className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-on-surface-variant">
                      <span>{bin.frpBin}</span>
                      <span>
                        MODIS: <strong className="text-secondary">{bin.modisCount.toLocaleString()}</strong> | VIIRS:{' '}
                        <strong className="text-tertiary">{bin.viirsCount.toLocaleString()}</strong>
                      </span>
                    </div>
                    <div className="flex h-3 bg-surface-container rounded-xs overflow-hidden">
                      <div style={{ width: `${(bin.modisCount / max) * 50}%` }} className="bg-secondary h-full" />
                      <div style={{ width: `${(bin.viirsCount / max) * 50}%` }} className="bg-tertiary h-full opacity-80" />
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
