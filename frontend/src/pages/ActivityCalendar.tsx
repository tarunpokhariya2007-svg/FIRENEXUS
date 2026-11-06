import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { CalendarMetric, CalendarMonthData, CalendarSensor } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { AWAITING_NASA, EMPTY, NO_DATASET } from '../utils/format';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';

const CURRENT_YEAR = new Date().getFullYear();
const METRIC_OPTIONS: { value: CalendarMetric; label: string; unit: string }[] = [
  { value: 'frp_sum', label: 'Cumulative Fire Radiative Power (GW)', unit: 'GW' },
  { value: 'count', label: 'Active Fire Detections (Count)', unit: 'px' },
  { value: 'mean_frp', label: 'Mean Fire Radiative Power (MW/pixel)', unit: 'MW' },
];
const SENSOR_OPTIONS: { value: CalendarSensor; label: string }[] = [
  { value: 'all', label: 'All sensors' },
  { value: 'modis', label: 'MODIS' },
  { value: 'viirs', label: 'VIIRS' },
];

export const ActivityCalendar: React.FC = () => {
  const navigate = useNavigate();
  const [startYear, setStartYear] = useState<number>(2000);
  const [endYear, setEndYear] = useState<number>(CURRENT_YEAR);
  const [metric, setMetric] = useState<CalendarMetric>('frp_sum');
  const [sensor, setSensor] = useState<CalendarSensor>('all');
  const [scaleMode, setScaleMode] = useState<'log' | 'linear'>('log');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rangeValid = startYear <= endYear;
  const res = useApiResource(
    () => (rangeValid ? api.getCalendarData({ startYear, endYear, metric, sensor }) : Promise.reject(new ApiError('Start year must not exceed end year.', 422, 'INVALID_RANGE'))),
    [startYear, endYear, metric, sensor],
  );
  const cells: CalendarMonthData[] = res.data?.cells ?? [];
  const noDataset = res.data?.status === 'no_dataset';
  const selectedCell = cells.find((c) => `${c.year}-${c.month}` === selectedKey) ?? null;

  const handleExportCsv = () => {
    const header = 'year,month,frp_sum_gw,detection_count,mean_frp_mw\n';
    const rows = cells.map((c) => `${c.year},${c.month},${c.frpSumGw},${c.detectionCount},${c.meanFrpMw ?? ''}`).join('\n');
    const url = URL.createObjectURL(new Blob([header + rows], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity_calendar_${startYear}-${endYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const years = rangeValid ? Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i) : [];
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const yearOptions = Array.from({ length: CURRENT_YEAR - 1990 + 1 }, (_, i) => 1990 + i);
  const metricInfo = METRIC_OPTIONS.find((m) => m.value === metric)!;

  const cellValue = (c: CalendarMonthData): number =>
    metric === 'count' ? c.detectionCount : metric === 'mean_frp' ? c.meanFrpMw ?? 0 : c.frpSumGw;
  const maxValue = cells.reduce((m, c) => Math.max(m, cellValue(c)), 0);

  // Data-driven color ramp (relative to the largest value in the loaded range).
  const RAMP = ['#f2f4ef', '#ffdcc4', '#ffb780', '#e89e58', '#c75b35', '#9d342b', '#5c1d24'];
  const getCellColor = (value: number) => {
    if (maxValue <= 0 || value <= 0) return RAMP[0];
    const t = scaleMode === 'log' ? Math.log10(1 + value) / Math.log10(1 + maxValue) : value / maxValue;
    return RAMP[Math.min(RAMP.length - 1, Math.max(1, Math.ceil(t * (RAMP.length - 1))))];
  };
  const fmtValue = (v: number) => (metric === 'count' ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));

  // Annual aggregation of what is actually loaded
  const annual = years.map((y) => {
    const ys = cells.filter((c) => c.year === y);
    return { year: y, total: ys.reduce((sum, c) => sum + cellValue(c), 0), n: ys.length };
  });
  const annualMax = annual.reduce((m, a) => Math.max(m, a.total), 0);
  const grandTotal = annual.reduce((sum, a) => sum + a.total, 0);
  const monthTotals = monthNames.map((_, i) => cells.filter((c) => c.month === i + 1).reduce((sum, c) => sum + cellValue(c), 0));

  return (
    <div className="flex flex-col w-full">
      {/* Top Sub-Header & Telemetry Control Strip */}
      <div className="w-full bg-surface-container-low px-space-lg py-space-sm flex flex-col gap-space-sm border-b border-structural select-none font-mono">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-md">
            <div>
              <span className="font-label-xs text-label-xs uppercase tracking-widest text-on-surface-variant font-medium block">
                Dataset Analysis • Module 04
              </span>
              <h1 className="font-headline-md text-headline-md text-on-surface tracking-tight font-semibold">
                Activity Calendar — Historical Burning Dynamics Matrix
              </h1>
            </div>
            <div className="hidden md:flex items-center gap-space-xs px-space-sm py-1 bg-surface-container rounded border border-structural">
              <span className={`w-2 h-2 rounded-full ${res.error ? 'bg-error' : cells.length ? 'bg-primary' : 'bg-outline'}`}></span>
              <span className="font-label-xs text-label-xs text-on-surface font-medium uppercase">
                {noDataset ? NO_DATASET.toUpperCase() : res.loading ? 'LOADING' : res.error ? 'REQUEST FAILED' : 'COMPUTED FROM LOADED DATA'}
              </span>
            </div>
          </div>

          {/* Quick Action Export */}
          <div className="flex items-center gap-space-xs">
            <button
              onClick={handleExportCsv}
              disabled={cells.length === 0}
              title={cells.length === 0 ? 'Nothing to export: no calendar data' : 'Download the displayed matrix as CSV'}
              className="flex items-center gap-1.5 px-space-sm py-1.5 bg-surface-container-lowest text-on-surface hover:bg-surface-container transition-colors rounded border border-structural font-label-xs text-label-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[15px] text-secondary">table_view</span>
              <span>CSV Matrix</span>
            </button>
          </div>
        </div>

        {/* Interactive Parameter Control Strip */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-sm items-center bg-surface-container-lowest p-space-sm rounded shadow-sm border border-structural">
          {/* Year range */}
          <div className="xl:col-span-4 flex flex-col gap-0.5">
            <label className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
              Year Range
            </label>
            <div className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded border border-structural">
              <span className="material-symbols-outlined text-[16px] text-primary">calendar_month</span>
              <select
                aria-label="Start year"
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                className="bg-transparent font-body-sm text-body-sm text-on-surface outline-none cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <span className="text-outline">→</span>
              <select
                aria-label="End year"
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                className="bg-transparent font-body-sm text-body-sm text-on-surface outline-none cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {!rangeValid && <span className="text-error font-label-xs text-label-xs">Start after end</span>}
            </div>
          </div>
          {/* Metric Selector */}
          <div className="xl:col-span-4 flex flex-col gap-0.5">
            <label className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
              Observed Radiative Parameter
            </label>
            <div className="flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded border border-structural">
              <span className="material-symbols-outlined text-[16px] text-tertiary">local_fire_department</span>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as CalendarMetric)}
                className="w-full bg-transparent font-body-sm text-body-sm text-on-surface outline-none cursor-pointer"
              >
                {METRIC_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Sensor selection */}
          <div className="xl:col-span-4 flex flex-col gap-0.5">
            <label className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant">
              Sensor Source
            </label>
            <div className="flex items-center gap-1 bg-surface-container-low p-0.5 rounded text-label-xs font-label-xs border border-structural">
              {SENSOR_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setSensor(o.value)}
                  className={`px-2 py-1 rounded transition-colors ${
                    sensor === o.value ? 'bg-surface-container-lowest text-on-surface font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {o.label}
                </button>
              ))}
              <button
                disabled
                title="Requires a completed harmonization run"
                className="px-2 py-1 rounded text-on-surface-variant opacity-50 cursor-not-allowed"
              >
                Harmonized
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace Body: Split View Heatmap Matrix & Analytical Drawer */}
      <div className="w-full p-space-md grid grid-cols-1 lg:grid-cols-12 gap-space-md">
        {/* Primary Matrix Container (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-space-md">
          {/* 2D Heatmap Grid Frame */}
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm overflow-hidden border border-structural">
            <div className="flex flex-wrap items-center justify-between gap-space-sm pb-space-xs font-mono">
              <div className="flex items-center gap-space-md">
                <div className="flex items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px] text-on-surface">calendar_view_month</span>
                  <span className="uppercase tracking-wider font-semibold text-on-surface">TEMPORAL RASTER</span>
                  <span>•</span>
                  <span>{years.length} YEARS ({years.length * 12} MONTHLY BINS)</span>
                </div>
              </div>
              <div className="flex items-center gap-space-sm font-label-xs text-label-xs">
                <span className="text-on-surface-variant">Scale:</span>
                <div className="flex items-center bg-surface-container-low rounded p-0.5 border border-structural">
                  <button
                    onClick={() => setScaleMode('log')}
                    className={`px-2 py-0.5 rounded font-medium ${
                      scaleMode === 'log' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant'
                    }`}
                  >
                    Log10
                  </button>
                  <button
                    onClick={() => setScaleMode('linear')}
                    className={`px-2 py-0.5 rounded font-medium ${
                      scaleMode === 'linear' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant'
                    }`}
                  >
                    Linear
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable Matrix Canvas */}
            <div className="overflow-x-auto pb-space-xs select-none">
              <div className="min-w-[760px] flex flex-col gap-1 font-mono">
                {/* Header Row: Years */}
                <div className="flex items-center gap-1">
                  <div className="w-10 shrink-0 text-right pr-2 font-label-xs text-label-xs font-semibold text-on-surface-variant">
                    MO
                  </div>
                  <div className="grid flex-1 gap-1 text-center font-label-xs text-label-xs text-on-surface-variant font-medium" style={{ gridTemplateColumns: `repeat(${Math.max(years.length, 1)}, minmax(0, 1fr))` }}>
                    {years.map((y) => (
                      <span
                        key={y}
                        className={selectedCell?.year === y ? 'text-primary font-bold bg-primary-fixed text-on-primary-fixed-variant rounded px-0.5' : ''}
                      >
                        {String(y).slice(2)}
                      </span>
                    ))}
                  </div>
                  <div className="w-14 shrink-0 text-left pl-2 font-label-xs text-label-xs font-semibold text-on-surface-variant">
                    SUM
                  </div>
                </div>

                {/* Heatmap Rows (JAN to DEC) */}
                {monthNames.map((mName, mIdx) => {
                  const mNum = mIdx + 1;
                  return (
                    <div key={mName} className="flex items-center gap-1 group">
                      <div className="w-10 shrink-0 text-right pr-2 font-label-xs text-label-xs text-on-surface-variant font-mono">
                        {mName}
                      </div>
                      <div className="grid flex-1 gap-1 h-5" style={{ gridTemplateColumns: `repeat(${Math.max(years.length, 1)}, minmax(0, 1fr))` }}>
                        {years.map((y) => {
                          const cell = cells.find((d) => d.year === y && d.month === mNum);
                          const value = cell ? cellValue(cell) : null;
                          const isSelected = selectedKey === `${y}-${mNum}`;

                          return (
                            <div
                              key={`${y}-${mNum}`}
                              onClick={() => cell && setSelectedKey(`${y}-${mNum}`)}
                              style={{ backgroundColor: cell ? getCellColor(value ?? 0) : 'transparent', border: cell ? undefined : '1px dashed #dfe4df' }}
                              className={`rounded-xs ${cell ? 'cursor-pointer hover:scale-125' : 'cursor-default'} transition-all ${
                                isSelected ? 'ring-2 ring-primary ring-offset-1 z-10' : ''
                              }`}
                              title={cell ? `${mName} ${y}: ${fmtValue(value ?? 0)} ${metricInfo.unit} (${cell.detectionCount.toLocaleString()} px)` : `${mName} ${y}: no observations`}
                            />
                          );
                        })}
                      </div>
                      <div className="w-14 shrink-0 text-left pl-2 font-label-xs text-label-xs text-on-surface-variant font-mono">
                        {grandTotal > 0 ? `${((monthTotals[mIdx] / grandTotal) * 100).toFixed(1)}%` : EMPTY}
                      </div>
                    </div>
                  );
                })}

                {/* Bottom Column Integration: Annual Spark-bars */}
                <div className="flex items-end gap-1 pt-2 mt-1 bg-surface-container-low/50 p-1 rounded border border-structural">
                  <div className="w-10 shrink-0 text-right pr-2 font-label-xs text-label-xs text-on-surface-variant uppercase font-medium">
                    ANN
                  </div>
                  <div className="grid flex-1 gap-1 h-8 items-end" style={{ gridTemplateColumns: `repeat(${Math.max(years.length, 1)}, minmax(0, 1fr))` }}>
                    {annual.map((a) => {
                      const heightPercent = annualMax > 0 ? Math.max(2, (a.total / annualMax) * 100) : 0;
                      return (
                        <div
                          key={a.year}
                          style={{ height: `${heightPercent}%` }}
                          className="rounded-xs bg-secondary-fixed-dim/80 hover:bg-secondary"
                          title={`${a.year}: ${fmtValue(a.total)} ${metricInfo.unit}`}
                        />
                      );
                    })}
                  </div>
                  <div className="w-14 shrink-0 text-left pl-2 font-label-xs text-label-xs text-on-surface font-mono font-bold">
                    {grandTotal > 0 ? '100%' : EMPTY}
                  </div>
                </div>
              </div>
            </div>

            {/* Scale Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-space-sm pt-space-xs mt-space-xs bg-surface-container-low px-space-sm py-space-xs rounded border border-structural font-mono">
              <div className="flex items-center gap-space-sm w-full sm:w-auto">
                <span className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant font-medium">
                  Scale ({metricInfo.unit}):
                </span>
                <div className="flex flex-col flex-1 sm:w-64">
                  <div
                    className="h-2.5 w-full rounded"
                    style={{
                      background: 'linear-gradient(to right, #f2f4ef 0%, #ffdcc4 15%, #ffb780 30%, #e89e58 50%, #c75b35 70%, #9d342b 85%, #5c1d24 100%)',
                    }}
                  />
                  <div className="flex justify-between font-label-xs text-[10px] text-on-surface-variant pt-0.5">
                    <span>0</span>
                    <span>{maxValue > 0 ? fmtValue(maxValue / 2) : EMPTY}</span>
                    <span>{maxValue > 0 ? fmtValue(maxValue) : EMPTY}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-space-md text-label-xs font-label-xs text-on-surface-variant">
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-[#f2f4ef] rounded-xs"></span>
                  <span>Low</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-[#c75b35] rounded-xs"></span>
                  <span>High</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-[#5c1d24] rounded-xs"></span>
                  <span>Maximum</span>
                </div>
              </div>
            </div>
          </div>

          {/* Data status */}
          <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-xs border border-structural font-mono">
            {res.loading ? (
              <LoadingState label="LOADING CALENDAR..." className="py-space-md" />
            ) : res.error ? (
              <ErrorState error={res.error} onRetry={res.reload} />
            ) : cells.length === 0 ? (
              <EmptyState
                title={noDataset ? NO_DATASET : 'No observations in range'}
                detail={noDataset ? AWAITING_NASA : `No loaded observations fall within ${startYear}–${endYear}`}
                icon="calendar_month"
              />
            ) : (
              <span className="font-label-xs text-label-xs text-on-surface-variant">
                {res.data?.message} {cells.length} month(s) with observations across {new Set(cells.map((c) => c.year)).size} year(s). Anomaly flags appear only where at least three years of data exist for that calendar month.
              </span>
            )}
          </div>
        </div>

        {/* Secondary Inspector & Telemetry Drawer (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-space-md">
          {selectedCell ? (
            <div className="bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-md border border-structural font-mono">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    <span className="font-label-xs text-label-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                      Active Selection Telemetry
                    </span>
                  </div>
                  <h2 className="font-headline-md text-headline-md text-on-surface mt-0.5 font-bold">
                    {selectedCell.monthName} {selectedCell.year}
                  </h2>
                  <span className="font-label-xs text-label-xs text-on-surface-variant">
                    {SENSOR_OPTIONS.find((o) => o.value === sensor)?.label} • {selectedCell.isAnomaly ? 'Statistical anomaly' : selectedCell.anomalyPercent === null ? 'Baseline needs ≥3 years' : 'Within baseline'}
                  </span>
                </div>
                {selectedCell.isAnomaly && (
                  <span className="px-2 py-0.5 rounded bg-error-container text-on-error-container font-label-xs text-label-xs font-semibold">
                    ANOMALY: {selectedCell.anomalyPercent !== null ? `${selectedCell.anomalyPercent > 0 ? '+' : ''}${selectedCell.anomalyPercent}%` : EMPTY}
                  </span>
                )}
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-space-sm">
                <div className="p-space-sm bg-surface-container-low rounded border border-structural">
                  <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">Monthly FRP Sum</span>
                  <div className="text-headline-sm font-bold text-primary mt-0.5">
                    {selectedCell.frpSumGw} <span className="text-label-xs font-normal text-on-surface">GW</span>
                  </div>
                </div>
                <div className="p-space-sm bg-surface-container-low rounded border border-structural">
                  <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">Detections Count</span>
                  <div className="text-headline-sm font-bold text-on-surface mt-0.5">
                    {selectedCell.detectionCount.toLocaleString()} <span className="text-label-xs font-normal text-on-surface">px</span>
                  </div>
                </div>
                <div className="p-space-sm bg-surface-container-low rounded border border-structural">
                  <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">Mean FRP/Pixel</span>
                  <div className="text-headline-sm font-bold text-on-surface mt-0.5">
                    {selectedCell.meanFrpMw ?? EMPTY} <span className="text-label-xs font-normal text-on-surface">MW</span>
                  </div>
                </div>
                <div className="p-space-sm bg-surface-container-low rounded border border-structural">
                  <span className="font-label-xs text-[10px] text-on-surface-variant uppercase">Anomaly vs. Month Mean</span>
                  <div className="text-headline-sm font-bold text-on-surface mt-0.5">
                    {selectedCell.anomalyPercent !== null ? `${selectedCell.anomalyPercent > 0 ? '+' : ''}${selectedCell.anomalyPercent}` : EMPTY}{' '}
                    <span className="text-label-xs font-normal text-on-surface">%</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate('/fire-explorer')}
                className="w-full py-2 px-space-md rounded bg-primary text-on-primary font-label-sm text-label-sm font-semibold hover:bg-primary-container transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[16px]">travel_explore</span>
                <span>Inspect in Map Workstation</span>
              </button>
            </div>
          ) : (
            <div className="p-space-lg flex items-center justify-center text-on-surface-variant font-mono">
              {cells.length ? 'Click any calendar cell to inspect monthly telemetry' : 'No monthly telemetry to inspect'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
