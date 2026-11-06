import React, { useState } from 'react';
import { api, ApiError } from '../services/api';
import { CalendarMetric, TemporalDecompositionPoint } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtNum } from '../utils/format';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';

const CURRENT_YEAR = new Date().getFullYear();
const METRICS: { value: CalendarMetric; label: string; unit: string }[] = [
  { value: 'frp_sum', label: 'Cumulative Fire Radiative Power (GW)', unit: 'GW' },
  { value: 'count', label: 'Active Fire Detections (Count)', unit: 'px' },
  { value: 'mean_frp', label: 'Mean Fire Radiative Power (MW/pixel)', unit: 'MW' },
];
const FREQUENCIES = ['daily', 'dekad', 'monthly', 'annual'] as const;

export const TemporalAnalysis: React.FC = () => {
  const [startYear, setStartYear] = useState<number>(2000);
  const [endYear, setEndYear] = useState<number>(CURRENT_YEAR);
  const [metric, setMetric] = useState<CalendarMetric>('frp_sum');
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>('monthly');
  const rangeValid = startYear <= endYear;
  const metricInfo = METRICS.find((m) => m.value === metric)!;
  const yearOptions = Array.from({ length: CURRENT_YEAR - 1990 + 1 }, (_, i) => 1990 + i);

  const res = useApiResource(
    () =>
      rangeValid
        ? api.getTemporalAnalysis({ startYear, endYear, metric })
        : Promise.reject(new ApiError('Start year must not exceed end year.', 422, 'INVALID_RANGE')),
    [startYear, endYear, metric],
  );
  const data = res.data;
  const stl: TemporalDecompositionPoint[] = data?.stlDecomposition ?? [];
  const noDataset = data?.status === 'no_dataset';
  const kpis = data?.kpis;

  const handleExportCsv = () => {
    if (!data || stl.length === 0) return;
    const header = 'date,observed,trend,seasonal,remainder\n';
    const rows = stl.map((d) => `${d.date},${d.observed},${d.trend},${d.seasonal},${d.remainder}`).join('\n');
    const url = URL.createObjectURL(new Blob([header + rows], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `stl_${metric}_${startYear}-${endYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rangeOf = (accessor: (d: TemporalDecompositionPoint) => number): [number, number] => {
    const vals = stl.map(accessor);
    return [Math.min(...vals), Math.max(...vals)];
  };

  // Render an autoscaled SVG series
  const renderSvgSeries = (
    accessor: (d: TemporalDecompositionPoint) => number,
    color: string,
    height: number = 70,
    width: number = 800,
    fillArea: boolean = false,
  ) => {
    if (stl.length === 0) {
      return <EmptyState compact className="h-full" title={noDataset ? NO_DATASET : 'Insufficient series'} detail={noDataset ? AWAITING_NASA : 'Needs 24+ contiguous months'} />;
    }
    const [minVal, maxVal] = rangeOf(accessor);
    const points = stl.map((d, i) => {
      const x = stl.length === 1 ? width / 2 : (i / (stl.length - 1)) * width;
      const y = height - ((accessor(d) - minVal) / (maxVal - minVal || 1)) * (height - 10) - 5;
      return `${x},${y}`;
    });
    const pathD = `M ${points.join(' L ')}`;
    const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
    return (
      <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        <line stroke="#dfe4df" strokeDasharray="3 3" x1="0" x2={width} y1={height * 0.25} y2={height * 0.25} />
        <line stroke="#dfe4df" strokeDasharray="3 3" x1="0" x2={width} y1={height * 0.5} y2={height * 0.5} />
        <line stroke="#dfe4df" strokeDasharray="3 3" x1="0" x2={width} y1={height * 0.75} y2={height * 0.75} />
        {fillArea && <path d={areaD} fill={color} fillOpacity={0.15} />}
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.8} />
      </svg>
    );
  };
  const fmtRange = (accessor: (d: TemporalDecompositionPoint) => number) => {
    if (stl.length === 0) return EMPTY;
    const [lo, hi] = rangeOf(accessor);
    return `${lo.toFixed(2)} → ${hi.toFixed(2)} ${metricInfo.unit}`;
  };

  return (
    <div className="flex flex-col w-full">
      {/* Module Header / Command & Export Ribbon */}
      <div className="p-space-lg bg-surface-container-lowest shadow-sm flex flex-col gap-space-md border-b border-structural">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center gap-space-sm font-mono">
              <span className="font-label-xs text-label-xs text-primary font-semibold uppercase tracking-wider">
                DATASET DYNAMICS • MODULE 05
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-surface-container-highest"></span>
              <span className="px-space-xs py-0.5 rounded bg-surface-container-high font-label-xs text-label-xs text-on-surface-variant">
                CLASSICAL DECOMPOSITION (2×12 MA)
              </span>
              <span className="px-space-xs py-0.5 rounded bg-surface-container-low font-label-xs text-label-xs text-secondary">
                {noDataset ? NO_DATASET.toUpperCase() : res.loading ? 'LOADING' : 'COMPUTED FROM LOADED DATA'}
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
              Temporal Analysis — Trend Decomposition &amp; Radiative Energetics
            </h1>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center flex-wrap gap-space-sm font-mono">
            <button
              onClick={handleExportCsv}
              disabled={stl.length === 0}
              title={stl.length === 0 ? 'Nothing to export: no decomposition computed' : 'Download the decomposition as CSV'}
              className="flex items-center gap-space-xs px-space-md py-1.5 rounded bg-surface-container-low text-on-surface hover:bg-surface-container-high transition-colors font-label-sm text-label-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">table_chart</span>
              <span>CSV Statistics</span>
            </button>
          </div>
        </div>

        {/* Global Geospatial & Temporal Filter Controls Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-sm p-space-sm rounded bg-surface-container-low font-mono border border-structural">
          {/* Year range */}
          <div className="flex flex-col gap-0.5 p-space-xs rounded bg-surface-container-lowest shadow-sm border border-structural">
            <div className="flex items-center justify-between">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Date Range (years)</span>
              <span className="material-symbols-outlined text-[14px] text-tertiary">date_range</span>
            </div>
            <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface">
              <select aria-label="Start year" value={startYear} onChange={(e) => setStartYear(Number(e.target.value))} className="bg-transparent outline-none cursor-pointer font-semibold">
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-outline">→</span>
              <select aria-label="End year" value={endYear} onChange={(e) => setEndYear(Number(e.target.value))} className="bg-transparent outline-none cursor-pointer font-semibold">
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="font-label-xs text-label-xs text-on-surface-variant">
              {rangeValid ? 'Region: not set (all loaded observations)' : <span className="text-error">Start year is after end year</span>}
            </div>
          </div>
          {/* Frequency Picker */}
          <div className="flex flex-col gap-0.5 p-space-xs rounded bg-surface-container-lowest shadow-sm border border-structural">
            <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">
              Temporal Frequency
            </span>
            <div className="flex items-center gap-1 pt-0.5">
              {FREQUENCIES.map((freq) => (
                <button
                  key={freq}
                  onClick={() => setFrequency(freq)}
                  disabled={freq !== 'monthly'}
                  title={freq !== 'monthly' ? 'Only monthly aggregation is available' : undefined}
                  className={`flex-1 py-1 text-center font-label-xs text-label-xs rounded capitalize transition-colors ${freq !== 'monthly' ? 'opacity-50 cursor-not-allowed ' : ''}${
                    frequency === freq
                      ? 'bg-secondary-fixed text-on-secondary-fixed-variant font-bold shadow-sm'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {freq}
                </button>
              ))}
            </div>
          </div>

          {/* Radiative Metric Selector */}
          <div className="flex flex-col gap-0.5 p-space-xs rounded bg-surface-container-lowest shadow-sm border border-structural">
            <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Radiative Metric</span>
            <div className="flex items-center justify-between pt-0.5">
              <select
                aria-label="Radiative metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value as CalendarMetric)}
                className="w-full bg-transparent font-label-sm text-label-sm text-primary font-semibold outline-none cursor-pointer"
              >
                {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          {/* Sensor Overlay Mode */}
          <div className="flex flex-col gap-0.5 p-space-xs rounded bg-surface-container-lowest shadow-sm border border-structural">
            <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Harmonization Baseline</span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="px-space-xs py-0.5 rounded bg-primary-fixed text-on-primary-fixed-variant font-label-xs text-label-xs font-semibold">
                All loaded sensors
              </span>
              <span className="px-space-xs py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-xs text-label-xs">
                Harmonized: not run
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-space-lg flex flex-col gap-space-lg">
        {res.loading && <LoadingState label="COMPUTING TEMPORAL ANALYSIS..." className="py-space-md" />}
        {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
        {data && data.status === 'ready' && (
          <div className="font-label-xs text-label-xs text-on-surface-variant font-mono">{data.message}</div>
        )}

        {/* PANEL 1: Top Metrics Bar (computed statistics only) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md font-mono">
          {/* Metric 1: Mann-Kendall */}
          <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Longitudinal Trend (Mann-Kendall)</span>
                <div className="flex items-baseline gap-space-xs mt-1">
                  <span className="font-headline-lg text-headline-lg font-bold text-primary font-label-sm">
                    Tau = {kpis?.mannKendallTau !== null && kpis?.mannKendallTau !== undefined ? kpis.mannKendallTau : EMPTY}
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant font-medium">
                    p = {kpis?.pValue !== null && kpis?.pValue !== undefined ? kpis.pValue : EMPTY}
                  </span>
                </div>
              </div>
              <span className="p-1 rounded bg-primary-fixed text-on-primary-fixed-variant material-symbols-outlined text-[18px]">trending_up</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low rounded p-space-xs flex items-center justify-between font-label-xs text-label-xs border border-structural">
              <span className="text-on-surface-variant">Sen's Slope:</span>
              <span className="font-bold text-on-surface">{kpis?.sensSlopePerYear !== null && kpis?.sensSlopePerYear !== undefined ? `${kpis.sensSlopePerYear} ${metricInfo.unit} / yr` : EMPTY}</span>
            </div>
          </div>

          {/* Metric 2: Trend classification */}
          <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Trend Classification</span>
                <div className="flex items-baseline gap-space-xs mt-1">
                  <span className="font-headline-lg text-headline-lg font-bold text-on-surface font-label-sm">{kpis?.mannKendallTrend ?? EMPTY}</span>
                </div>
              </div>
              <span className="p-1 rounded bg-secondary-fixed text-on-secondary-fixed-variant material-symbols-outlined text-[18px]">local_fire_department</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low rounded p-space-xs flex items-center justify-between font-label-xs text-label-xs border border-structural">
              <span className="text-on-surface-variant">Complete years used:</span>
              <span className="font-medium text-on-surface">{kpis ? kpis.sampleSize : EMPTY}</span>
            </div>
          </div>

          {/* Metric 3: Decomposition coverage */}
          <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col justify-between border border-structural">
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Decomposed Months</span>
                <div className="flex items-baseline gap-space-xs mt-1">
                  <span className="font-headline-lg text-headline-lg font-bold text-tertiary font-label-sm">{data ? stl.length : EMPTY}</span>
                </div>
              </div>
              <span className="p-1 rounded bg-tertiary-fixed text-on-tertiary-fixed material-symbols-outlined text-[18px]">schedule</span>
            </div>
            <div className="mt-space-sm pt-space-xs bg-surface-container-low rounded p-space-xs flex items-center justify-between font-label-xs text-label-xs border border-structural">
              <span className="text-on-surface-variant">Span:</span>
              <span className="font-medium text-on-surface">{stl.length ? `${stl[0].date} → ${stl[stl.length - 1].date}` : EMPTY}</span>
            </div>
          </div>

          {/* Metric 4: Seasonality ratio (max/min of monthly means) */}
          {(() => {
            const means = (data?.monthlySeasonality ?? []).map((m) => m.meanValue);
            const hi = means.length ? Math.max(...means) : null;
            const lo = means.length ? Math.min(...means) : null;
            return (
              <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col justify-between border border-structural">
                <div className="flex items-start justify-between">
                  <div className="flex flex-col">
                    <span className="font-label-xs text-label-xs text-on-surface-variant uppercase">Seasonality Ratio (Max / Min)</span>
                    <div className="flex items-baseline gap-space-xs mt-1">
                      <span className="font-headline-lg text-headline-lg font-bold text-on-surface font-label-sm">
                        {hi !== null && lo !== null && lo > 0 ? `${(hi / lo).toFixed(2)}x` : EMPTY}
                      </span>
                    </div>
                  </div>
                  <span className="p-1 rounded bg-surface-container-high text-on-surface material-symbols-outlined text-[18px]">waves</span>
                </div>
                <div className="mt-space-sm pt-space-xs bg-surface-container-low rounded p-space-xs flex items-center justify-between font-label-xs text-label-xs border border-structural">
                  <span className="text-on-surface-variant">Min: {fmtNum(lo, 2)}</span>
                  <span className="font-medium text-on-surface">Max: {fmtNum(hi, 2)}</span>
                </div>
              </div>
            );
          })()}
        </section>

        {/* Main Workspace Split: Panel 2 (STL Decomp) & Right Column Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
          {/* PANEL 2: Comprehensive Multi-Decadal STL Decomposition (8 Cols) */}
          <section className="lg:col-span-8 flex flex-col rounded bg-surface-container-lowest shadow-sm p-space-md gap-space-md border border-structural font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs pb-space-xs bg-surface-container-low p-space-xs rounded border border-structural">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-[18px] text-primary">stacked_line_chart</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Seasonal-Trend Decomposition • {startYear}–{endYear} {metricInfo.label}
                </h2>
              </div>
              <div className="flex items-center gap-space-sm font-label-xs text-label-xs">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary"></span> Observed</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-secondary"></span> Trend</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-tertiary"></span> Seasonal</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-outline"></span> Remainder</span>
              </div>
            </div>

            {/* 4 Stacked Aligned Synchronous Decomposition Channels */}
            <div className="flex flex-col gap-space-sm w-full">
              {/* Channel A: Observed Series */}
              <div className="flex flex-col bg-surface-container-low rounded p-space-xs border border-structural">
                <div className="flex items-center justify-between px-space-xs pb-1">
                  <span className="font-label-xs text-label-xs font-semibold text-on-surface">
                    A. OBSERVED Y[t] — {metricInfo.label}
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">Range: {fmtRange((d) => d.observed)}</span>
                </div>
                <div className="w-full h-24 overflow-hidden">
                  {renderSvgSeries((d) => d.observed, '#9e3d19', 70, 800, true)}
                </div>
              </div>

              {/* Channel B: Trend */}
              <div className="flex flex-col bg-surface-container-low rounded p-space-xs border border-structural">
                <div className="flex items-center justify-between px-space-xs pb-1">
                  <span className="font-label-xs text-label-xs font-semibold text-on-surface">
                    B. TREND COMPONENT T[t] — Centred 2×12 moving average
                  </span>
                  <span className="font-label-xs text-label-xs text-secondary font-medium">Range: {fmtRange((d) => d.trend)}</span>
                </div>
                <div className="w-full h-20 overflow-hidden">
                  {renderSvgSeries((d) => d.trend, '#2d6480', 60, 800, false)}
                </div>
              </div>

              {/* Channel C: Seasonal */}
              <div className="flex flex-col bg-surface-container-low rounded p-space-xs border border-structural">
                <div className="flex items-center justify-between px-space-xs pb-1">
                  <span className="font-label-xs text-label-xs font-semibold text-on-surface">
                    C. SEASONAL COMPONENT S[t] — 12-month cycle
                  </span>
                  <span className="font-label-xs text-label-xs text-tertiary font-medium">Range: {fmtRange((d) => d.seasonal)}</span>
                </div>
                <div className="w-full h-20 overflow-hidden">
                  {renderSvgSeries((d) => d.seasonal, '#8b4c0f', 60, 800, false)}
                </div>
              </div>

              {/* Channel D: Remainder */}
              <div className="flex flex-col bg-surface-container-low rounded p-space-xs border border-structural">
                <div className="flex items-center justify-between px-space-xs pb-1">
                  <span className="font-label-xs text-label-xs font-semibold text-on-surface">
                    D. REMAINDER R[t] — Observed − trend − seasonal
                  </span>
                  <span className="font-label-xs text-label-xs text-on-surface-variant font-medium">Range: {fmtRange((d) => d.remainder)}</span>
                </div>
                <div className="w-full h-20 overflow-hidden">
                  {renderSvgSeries((d) => d.remainder, '#8a726a', 60, 800, false)}
                </div>
              </div>

              {/* Time axis labels */}
              <div className="flex justify-between items-center text-[10px] text-on-surface-variant px-2 pt-1 border-t border-structural">
                <span>{stl.length ? stl[0].date : EMPTY}</span>
                <span>{stl.length ? stl[stl.length - 1].date : EMPTY}</span>
              </div>
            </div>
          </section>

          {/* Right Column (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-space-md font-mono">
            {/* Seasonality Profile by Sensor */}
            <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col gap-space-sm border border-structural">
              <div className="flex items-center justify-between">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Monthly Seasonality Profile
                </span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">Monthly mean ({metricInfo.unit})</span>
              </div>
              <div className="space-y-1.5 pt-1">
                {(data?.monthlySeasonality ?? []).length === 0 && (
                  <EmptyState compact title={noDataset ? NO_DATASET : 'No data in range'} detail={noDataset ? AWAITING_NASA : 'Adjust the date range'} />
                )}
                {(() => {
                  const rows = data?.monthlySeasonality ?? [];
                  const max = Math.max(...rows.map((r) => r.meanValue), 1e-9);
                  return rows.map((m) => (
                    <div key={m.month} className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 text-on-surface-variant font-medium">{m.month}</span>
                      <div className="flex-1 bg-surface-container h-3.5 rounded-xs overflow-hidden flex">
                        <div style={{ width: `${Math.min(100, (m.meanValue / max) * 100)}%` }} className="bg-primary h-full" />
                      </div>
                      <span className="w-16 text-right font-medium text-on-surface">{m.meanValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Inter-Annual Burning Intensity & Drought Anomalies */}
            <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col gap-space-sm border border-structural">
              <div className="flex items-center justify-between">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Annual Totals
                </span>
                <span className="font-label-xs text-label-xs text-primary font-semibold">vs. Sen trend</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant uppercase">
                      <th className="py-1 px-1.5">Year</th>
                      <th className="py-1 px-1.5 text-right">Observed</th>
                      <th className="py-1 px-1.5 text-right">Trend line</th>
                      <th className="py-1 px-1.5 text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {(data?.annualTrends ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          <EmptyState compact title={noDataset ? NO_DATASET : 'No complete years'} detail={noDataset ? AWAITING_NASA : 'A complete year needs all 12 months'} />
                        </td>
                      </tr>
                    )}
                    {(data?.annualTrends ?? []).slice(-6).map((row) => (
                      <tr key={row.year} className="hover:bg-surface-container-low">
                        <td className="py-1 px-1.5 font-bold text-on-surface">{row.year}</td>
                        <td className="py-1 px-1.5 text-right">{row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="py-1 px-1.5 text-right text-on-surface-variant">{row.trendLine !== null ? row.trendLine.toLocaleString(undefined, { maximumFractionDigits: 2 }) : EMPTY}</td>
                        <td className="py-1 px-1.5 text-right font-bold text-on-surface">
                          {row.trendLine !== null ? (row.value - row.trendLine).toLocaleString(undefined, { maximumFractionDigits: 2 }) : EMPTY}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* FRP Distribution Histogram */}
            <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex flex-col gap-space-sm border border-structural">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                FRP Distribution (detections per class)
              </span>
              <div className="space-y-1.5 pt-1 text-[11px]">
                {(() => {
                  const bins = data?.frpDistribution ?? [];
                  if (bins.length === 0) return <EmptyState compact title={noDataset ? NO_DATASET : 'No FRP values'} detail={noDataset ? AWAITING_NASA : 'No FRP values in range'} />;
                  const max = Math.max(...bins.map((b) => b.modisCount + b.viirsCount), 1);
                  return bins.map((bin) => {
                    const n = bin.modisCount + bin.viirsCount;
                    return (
                      <div key={bin.frpBin} className="flex items-center gap-2">
                        <span className="w-20 text-on-surface-variant">{bin.frpBin}</span>
                        <div className="flex-1 bg-surface-container h-3 rounded-xs overflow-hidden flex">
                          <div style={{ width: `${(n / max) * 100}%` }} className="bg-secondary h-full" />
                        </div>
                        <span className="w-16 text-right font-medium text-on-surface">{n.toLocaleString()}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
