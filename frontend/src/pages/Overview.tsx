import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { OverviewMetrics, FireObservation } from '../types/firenexus';
import { MapLibreCanvas } from '../components/maps/MapLibreCanvas';
import { useApiResource } from '../hooks/useApi';
import { DatasetBadge, EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtInt, fmtNum, fmtPercent } from '../utils/format';

export const Overview: React.FC = () => {
  const metricsRes = useApiResource(() => api.getOverviewMetrics(), []);
  const hotspotsRes = useApiResource(() => api.getExplorerHotspots(), []);
  const calendarRes = useApiResource(
    () => api.getCalendarData({ startYear: 1990, endYear: new Date().getFullYear(), metric: 'frp_sum', sensor: 'all' }),
    [],
  );
  const [selectedHotspot, setSelectedHotspot] = useState<FireObservation | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  // Layer toggles
  const [showModis, setShowModis] = useState(true);
  const [showViirs, setShowViirs] = useState(true);
  const [showHarmonized, setShowHarmonized] = useState(true);

  const metrics = metricsRes.data;
  const hotspots = hotspotsRes.data?.items ?? [];

  useEffect(() => {
    if (metricsRes.data) setLastChecked(new Date().toISOString().slice(11, 19) + ' UTC');
  }, [metricsRes.data]);

  const isRefreshing = metricsRes.loading || hotspotsRes.loading || calendarRes.loading;
  const handleRefresh = () => {
    metricsRes.reload();
    hotspotsRes.reload();
    calendarRes.reload();
  };

  if (metricsRes.loading && !metrics) {
    return <LoadingState className="p-space-lg min-h-[500px]" label="LOADING DATASET STATUS..." />;
  }
  if (metricsRes.error) {
    return <ErrorState className="m-space-lg min-h-[500px]" error={metricsRes.error} onRetry={metricsRes.reload} />;
  }
  if (!metrics) return null;

  const hasData = metrics.status === 'ready';
  const modisN = metrics.modisCount;
  const viirsN = metrics.viirsCount;
  const totalN = metrics.totalDetections;
  const modisShare = totalN ? ((modisN ?? 0) / totalN) * 100 : null;
  const viirsShare = totalN ? ((viirsN ?? 0) / totalN) * 100 : null;
  const calendarCells = [...(calendarRes.data?.cells ?? [])].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));

  return (
    <div className="p-space-lg flex flex-col gap-space-md bg-surface text-on-surface">
      {/* Top Analytical Header Strip */}
      <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-space-md border border-structural">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="font-headline-md text-headline-md text-on-surface tracking-tight font-semibold">
              Fire Activity Overview
            </span>
            <DatasetBadge loaded={hasData} count={metrics.datasetsLoaded} />
          </div>

          <div className="flex items-center gap-space-md text-on-surface-variant flex-wrap font-body-sm text-body-sm">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-tertiary">near_me</span>
              <span className="font-medium text-on-surface">Target AOI:</span>
              <span>Not set</span>
              <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">[—, —]</span>
            </div>
            <span className="text-surface-container-highest">/</span>
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-secondary">cloud_download</span>
              <span className="font-medium text-on-surface">Temporal Span:</span>
              <span className="font-label-xs text-label-xs font-mono">{EMPTY}</span>
              <span>→</span>
              <span className="font-label-xs text-label-xs font-mono">{EMPTY}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-space-sm self-start xl:self-center">
          <div className="flex items-center gap-2 px-space-sm py-1.5 bg-surface-container rounded text-on-surface-variant font-label-xs text-label-xs font-mono">
            <span className="material-symbols-outlined text-[16px] text-secondary">update</span>
            <span>
              Status checked <strong className="text-on-surface font-semibold">{lastChecked ?? EMPTY}</strong>
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-space-md py-1.5 bg-primary hover:bg-primary-container text-on-primary rounded font-label-xs text-label-xs font-medium tracking-wide flex items-center gap-1.5 transition-colors shadow-sm font-mono"
          >
            <span className={`material-symbols-outlined text-[16px] ${isRefreshing ? 'animate-spin' : ''}`}>sync</span>
            <span>{isRefreshing ? 'REFRESHING...' : 'REFRESH'}</span>
          </button>
        </div>
      </div>

      {/* Key Scientific Telemetry Metrics (4 Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        {/* MODIS Metric Card */}
        <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between relative overflow-hidden border border-structural">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span className="font-label-xs text-label-xs uppercase font-medium text-on-surface-variant tracking-wider font-mono">
                Sensor Class A
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed-variant font-label-xs text-label-xs font-semibold font-mono">
              MODIS C6.1
            </span>
          </div>
          <div className="my-space-sm">
            <div className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface font-mono">
              {fmtInt(metrics.modisCount)}
            </div>
            <div className="font-label-xs text-label-xs text-on-surface-variant uppercase mt-0.5 font-mono">
              Total Observations (1km nominal)
            </div>
          </div>
          <div className="pt-space-xs flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant bg-surface-container-low px-2 py-1 rounded font-mono">
            <span>Terra: <strong className="text-on-surface">{fmtInt(metrics.modisTerraCount)}</strong></span>
            <span className="text-surface-container-highest">|</span>
            <span>Aqua: <strong className="text-on-surface">{fmtInt(metrics.modisAquaCount)}</strong></span>
          </div>
        </div>

        {/* VIIRS Metric Card */}
        <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between relative overflow-hidden border border-structural">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-tertiary"></span>
              <span className="font-label-xs text-label-xs uppercase font-medium text-on-surface-variant tracking-wider font-mono">
                Sensor Class B
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-xs text-label-xs font-semibold font-mono">
              VIIRS 375m
            </span>
          </div>
          <div className="my-space-sm">
            <div className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface font-mono">
              {fmtInt(metrics.viirsCount)}
            </div>
            <div className="font-label-xs text-label-xs text-on-surface-variant uppercase mt-0.5 font-mono">
              High-Res Detections (I-Band)
            </div>
          </div>
          <div className="pt-space-xs flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant bg-surface-container-low px-2 py-1 rounded font-mono">
            <span>NPP: <strong className="text-on-surface">{fmtInt(metrics.viirsNppCount)}</strong></span>
            <span>N20: <strong className="text-on-surface">{fmtInt(metrics.viirsN20Count)}</strong></span>
            <span>N21: <strong className="text-on-surface">{fmtInt(metrics.viirsN21Count)}</strong></span>
          </div>
        </div>

        {/* Harmonized Clusters Card */}
        <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between relative overflow-hidden border border-structural">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary"></span>
              <span className="font-label-xs text-label-xs uppercase font-medium text-on-surface-variant tracking-wider font-mono">
                Spatio-Temporal Co-Index
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface font-label-xs text-label-xs font-semibold font-mono">
              {metrics.matchPercentage !== null ? `${metrics.matchPercentage}% MATCH` : 'NOT RUN'}
            </span>
          </div>
          <div className="my-space-sm">
            <div className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface font-mono">
              {fmtInt(metrics.harmonizedDualSensorClusters)}
            </div>
            <div className="font-label-xs text-label-xs text-on-surface-variant uppercase mt-0.5 font-mono">
              Harmonized Dual-Sensor Clusters
            </div>
          </div>
          <div className="pt-space-xs flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant bg-surface-container-low px-2 py-1 rounded font-mono">
            <span>Mean Offset: <strong className="text-on-surface">{fmtNum(metrics.meanTemporalOffsetMin, 1)} min</strong></span>
            <span className="text-surface-container-highest">|</span>
            <span>ΔSpatial: <strong className="text-on-surface">{metrics.deltaSpatialMeters !== null ? `±${metrics.deltaSpatialMeters}m` : EMPTY}</strong></span>
          </div>
        </div>

        {/* Unmatched VIIRS observations */}
        <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col justify-between relative overflow-hidden border border-structural">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-outline"></span>
              <span className="font-label-xs text-label-xs uppercase font-medium text-on-surface-variant tracking-wider font-mono">
                Unmatched VIIRS Observations
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface font-label-xs text-label-xs font-semibold font-mono">
              {metrics.unmatchedViirsObservationCount !== null ? 'OBSERVATION COUNT' : 'NOT COMPUTED'}
            </span>
          </div>
          <div className="my-space-sm">
            <div className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface font-mono">
              {fmtInt(metrics.unmatchedViirsObservationCount)}
            </div>
            <div className="font-label-xs text-label-xs text-on-surface-variant uppercase mt-0.5 font-mono">
              VIIRS observations without a selected MODIS association
            </div>
          </div>
          <div className="pt-space-xs flex items-center justify-between font-label-xs text-label-xs text-on-surface-variant bg-surface-container-low px-2 py-1 rounded font-mono">
            <span>{metrics.unmatchedViirsObservationCount === null ? 'Requires a harmonization run' : 'Association status only'}</span>
            <span className="material-symbols-outlined text-[14px] text-tertiary">info</span>
          </div>
        </div>
      </div>

      {/* Main Analytical Grid (60% Map / 40% Lateral Analysis) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
        {/* Left Panel: Cartographic Geographic View (7 Cols ~ 58-60%) */}
        <div className="xl:col-span-7 bg-surface-container-lowest rounded shadow-sm flex flex-col h-[740px] relative overflow-hidden border border-structural">
          {/* Cartographic Control Ribbon Header */}
          <div className="px-space-md py-space-sm bg-surface-container-low flex items-center justify-between flex-wrap gap-space-xs select-none border-b border-structural">
            <div className="flex items-center gap-space-sm">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">layers</span>
                <span className="font-label-sm text-label-sm font-semibold tracking-wide uppercase text-on-surface font-mono">
                  Active Fire Density Projection
                </span>
              </div>
              <span className="font-label-xs text-label-xs text-on-surface-variant px-1.5 py-0.5 bg-surface-container rounded font-mono">
                EPSG:4326
              </span>
            </div>

            {/* Dynamic Raster Layer Toggles */}
            <div className="flex items-center gap-1 bg-surface-container-highest p-0.5 rounded text-on-surface font-mono text-label-xs">
              <button
                onClick={() => setShowModis(!showModis)}
                className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-all ${
                  showModis
                    ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                MODIS 1km
              </button>
              <button
                onClick={() => setShowViirs(!showViirs)}
                className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-all ${
                  showViirs
                    ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                VIIRS 375m
              </button>
              <button
                onClick={() => setShowHarmonized(!showHarmonized)}
                className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-all ${
                  showHarmonized
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-on-primary"></span>
                Harmonized Heatmap
              </button>
            </div>
          </div>

          {/* MapLibre Canvas Viewport */}
          <div className="relative flex-1 w-full h-full overflow-hidden">
            <MapLibreCanvas
              hotspots={hotspots}
              selectedHotspot={selectedHotspot}
              onSelectHotspot={(h) => setSelectedHotspot(h)}
              showModis={showModis}
              showViirs={showViirs}
              showHarmonized={showHarmonized}
              heightClass="h-full w-full"
              emptyMessage={{ title: NO_DATASET, detail: AWAITING_NASA }}
            />
          </div>

          {/* Footnote Status Ribbon */}
          <div className="px-space-md py-1.5 bg-surface-container-low flex items-center justify-between text-on-surface-variant font-label-xs text-label-xs border-t border-structural font-mono">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${metrics.spatialConfidence !== null ? 'bg-[#527A63]' : 'bg-outline'}`}></span>
              <span>Spatial Co-Registration Confidence: <strong className="text-on-surface font-semibold">{fmtPercent(metrics.spatialConfidence)}</strong></span>
            </div>
            <span className="hidden sm:inline">Tiles Processed: {metrics.processedTiles.length ? metrics.processedTiles.join(', ') : EMPTY}</span>
          </div>
        </div>

        {/* Right Panel: Lateral High-Density Analysis (5 Cols ~ 40%) */}
        <div className="xl:col-span-5 flex flex-col gap-space-md">
          {/* Module 1: Sensor Contribution & Footprint Breakdown */}
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm border border-structural">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-tertiary">pie_chart</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Sensor Volume Contribution</span>
              </div>
              <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">
                TOTAL: {fmtInt(metrics.totalDetections)} DETECTIONS
              </span>
            </div>

            {/* Stacked Proportion Bar */}
            <div className="flex flex-col gap-1">
              <div className="h-5 w-full bg-surface-container-high rounded-xs overflow-hidden flex">
                {modisShare !== null && viirsShare !== null && (
                  <>
                    <div
                      className="h-full bg-secondary flex items-center justify-center text-[10px] text-on-secondary font-label-xs font-semibold tracking-wide"
                      style={{ width: `${modisShare}%` }}
                    >
                      {modisShare >= 12 ? `${modisShare.toFixed(1)}% MODIS` : ''}
                    </div>
                    <div
                      className="h-full bg-tertiary-container flex items-center justify-center text-[10px] text-on-tertiary-container font-label-xs font-semibold tracking-wide"
                      style={{ width: `${viirsShare}%` }}
                    >
                      {viirsShare >= 12 ? `${viirsShare.toFixed(1)}% VIIRS` : ''}
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-between items-center text-[11px] font-label-xs text-on-surface-variant pt-0.5 font-mono">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                  <span>MODIS 1km ({fmtInt(metrics.modisCount)} obs)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-tertiary-container"></span>
                  <span>VIIRS 375m ({fmtInt(metrics.viirsCount)} obs)</span>
                </div>
              </div>
            </div>

            {/* Analytical Sub-Footprint Grid */}
            <div className="grid grid-cols-3 gap-space-xs pt-space-xs text-center border-t border-structural font-mono">
              <div className="p-1.5 rounded bg-surface-container-low flex flex-col">
                <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">Terra/Aqua 1km</span>
                <span className="font-label-md text-label-md font-semibold text-secondary">{fmtInt(metrics.modisTerraCount)} / {fmtInt(metrics.modisAquaCount)}</span>
                <span className="text-[9px] text-on-surface-variant">Terra / Aqua</span>
              </div>
              <div className="p-1.5 rounded bg-surface-container-low flex flex-col">
                <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">S-NPP 375m</span>
                <span className="font-label-md text-label-md font-semibold text-tertiary">{fmtInt(metrics.viirsNppCount)} obs</span>
                <span className="text-[9px] text-on-surface-variant">{viirsN ? `${(((metrics.viirsNppCount ?? 0) / viirsN) * 100).toFixed(1)}% VIIRS share` : 'No VIIRS data'}</span>
              </div>
              <div className="p-1.5 rounded bg-surface-container-low flex flex-col">
                <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">NOAA-20/21</span>
                <span className="font-label-md text-label-md font-semibold text-primary">{metrics.viirsN20Count === null ? EMPTY : fmtInt((metrics.viirsN20Count ?? 0) + (metrics.viirsN21Count ?? 0))} obs</span>
                <span className="text-[9px] text-on-surface-variant">NOAA-20 + NOAA-21</span>
              </div>
            </div>
          </div>

          {/* Module 2: Historical Multi-Year Timeline (Aug-Oct Dry Season Spikes) */}
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm border border-structural">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">show_chart</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Temporal Activity Trend</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-label-xs text-[10px] font-medium uppercase font-mono">
                Monthly FRP
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant leading-snug">
              Monthly cumulative Fire Radiative Power (GW) computed from the loaded observations.
            </p>

            {/* Technical SVG Area & Line Chart */}
            <div className="relative w-full h-44 bg-surface-container-low rounded p-2 flex flex-col justify-end">
              {calendarCells.length === 0 ? (
                <EmptyState
                  compact
                  className="h-full"
                  title={hasData ? 'No monthly activity to plot' : NO_DATASET}
                  detail={hasData ? 'Loaded datasets contain no observations' : AWAITING_NASA}
                />
              ) : (
                <>
                  <svg className="w-full h-36 overflow-visible" preserveAspectRatio="none" viewBox="0 0 460 120">
                    <defs>
                      <linearGradient id="area-grad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#be542f" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#be542f" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <line stroke="#dfe4df" strokeDasharray="2 2" strokeWidth="1" x1="0" x2="460" y1="20" y2="20" />
                    <line stroke="#dfe4df" strokeDasharray="2 2" strokeWidth="1" x1="0" x2="460" y1="50" y2="50" />
                    <line stroke="#dfe4df" strokeDasharray="2 2" strokeWidth="1" x1="0" x2="460" y1="80" y2="80" />
                    <line stroke="#dfe4df" strokeWidth="1" x1="0" x2="460" y1="110" y2="110" />
                    {(() => {
                      const max = Math.max(...calendarCells.map((c) => c.frpSumGw), 1e-9);
                      const n = calendarCells.length;
                      const pts = calendarCells.map((c, i) => {
                        const x = n === 1 ? 230 : 10 + (i / (n - 1)) * 440;
                        const y = 110 - (c.frpSumGw / max) * 90;
                        return `${x},${y}`;
                      });
                      const line = `M ${pts.join(' L ')}`;
                      const lastX = n === 1 ? 230 : 450;
                      const firstX = n === 1 ? 230 : 10;
                      return (
                        <>
                          <path d={`${line} L ${lastX},110 L ${firstX},110 Z`} fill="url(#area-grad)" />
                          <path d={line} fill="none" stroke="#9e3d19" strokeWidth="2" />
                        </>
                      );
                    })()}
                  </svg>
                  <div className="flex justify-between items-center text-[9px] font-mono text-on-surface-variant pt-1 px-1">
                    <span>{calendarCells[0].year}-{String(calendarCells[0].month).padStart(2, '0')}</span>
                    <span>
                      {calendarCells[calendarCells.length - 1].year}-{String(calendarCells[calendarCells.length - 1].month).padStart(2, '0')}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between text-on-surface-variant font-label-xs text-label-xs px-1 font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-primary inline-block"></span>
                <span>Monthly cumulative FRP (GW)</span>
              </div>
              {calendarRes.error && <span className="text-error">Calendar unavailable: {calendarRes.error.message}</span>}
            </div>
          </div>

          {/* Module 3: Recent Ingestion Batches Table */}
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm border border-structural">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-secondary">database</span>
                <span className="font-headline-sm text-headline-sm text-on-surface">Recent Ingestion Batches</span>
              </div>
              <span className="font-label-xs text-label-xs text-on-surface-variant font-mono">INGESTION LOG (UTC)</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low text-on-surface-variant font-label-xs text-[10px] uppercase tracking-wider font-mono">
                    <th className="py-1 px-2 font-medium">Batch / Orbit</th>
                    <th className="py-1 px-2 font-medium">Platform Node</th>
                    <th className="py-1 px-2 font-medium text-right">Anomalies</th>
                    <th className="py-1 px-2 font-medium text-right">FRP (MW)</th>
                    <th className="py-1 px-2 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-highest font-body-sm text-body-sm">
                  {metrics.recentBatches.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-space-md">
                        <EmptyState compact title="No ingestion batches" detail={AWAITING_NASA} />
                      </td>
                    </tr>
                  )}
                  {metrics.recentBatches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-surface-container-low/60 transition-colors">
                      <td className="py-1.5 px-2">
                        <div className="font-label-xs text-label-xs font-semibold text-on-surface font-mono">{batch.id}</div>
                        <div className="font-label-xs text-[9px] text-on-surface-variant font-mono">{batch.orbitPass}</div>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="px-1.5 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-xs text-[10px] font-medium font-mono">
                          {batch.platform}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-label-xs text-label-xs font-medium text-on-surface font-mono">
                        {batch.anomaliesCount.toLocaleString()}
                      </td>
                      <td className="py-1.5 px-2 text-right font-label-xs text-label-xs text-on-surface font-mono">
                        {fmtNum(batch.frpMw, 1)}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high text-[#527A63] font-label-xs text-[10px] font-semibold font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#527A63]"></span>
                          {batch.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pt-1 flex items-center justify-between text-on-surface-variant font-label-xs text-label-xs font-mono">
              <span className="text-[10px]">Harmonization engine</span>
              <Link className="text-primary hover:underline font-medium text-[11px] flex items-center gap-0.5" to="/harmonization-studio">
                <span>Calibration Studio</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
