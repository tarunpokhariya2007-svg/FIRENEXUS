import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { CalendarMetric, CalendarMonthData, CalendarSensor } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { AWAITING_NASA, EMPTY, NO_DATASET } from '../utils/format';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StatePanel';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, inputClass } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { cn } from '../utils/cn';

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
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

  const rampGradient = `linear-gradient(to right, ${RAMP[0]} 0%, ${RAMP[1]} 15%, ${RAMP[2]} 30%, ${RAMP[3]} 50%, ${RAMP[4]} 70%, ${RAMP[5]} 85%, ${RAMP[6]} 100%)`;
  const colTemplate = `repeat(${Math.max(years.length, 1)}, minmax(0, 1fr))`;
  const showMatrix = cells.length > 0;
  const status: { label: string; tone: BadgeTone } = noDataset
    ? { label: NO_DATASET, tone: 'neutral' }
    : res.loading && !showMatrix
    ? { label: 'Loading', tone: 'neutral' }
    : res.error
    ? { label: 'Request failed', tone: 'error' }
    : { label: 'Computed from loaded data', tone: 'success' };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Activity Calendar"
        description="Historical burning dynamics by month and year, computed from the loaded satellite datasets."
        actions={
          <>
            <Badge tone={status.tone} dot>{status.label}</Badge>
            <Button
              icon="table_view"
              onClick={handleExportCsv}
              disabled={cells.length === 0}
              title={cells.length === 0 ? 'Nothing to export: no calendar data' : 'Download the displayed matrix as CSV'}
            >
              Export CSV
            </Button>
          </>
        }
      />

      {/* Controls */}
      <Card padding="md">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Year range">
            <div className="flex items-center gap-2">
              <select
                aria-label="Start year"
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                aria-invalid={!rangeValid || undefined}
                className={cn(inputClass, 'min-w-0 flex-1 cursor-pointer', !rangeValid && 'border-error')}
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span aria-hidden="true" className="text-outline">→</span>
              <select
                aria-label="End year"
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                aria-invalid={!rangeValid || undefined}
                className={cn(inputClass, 'min-w-0 flex-1 cursor-pointer', !rangeValid && 'border-error')}
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {!rangeValid && <p role="alert" className="font-body text-body-sm text-error">Start year must not exceed end year.</p>}
          </Field>

          <Field label="Radiative parameter" htmlFor="ac-metric">
            <select id="ac-metric" value={metric} onChange={(e) => setMetric(e.target.value as CalendarMetric)} className={cn(inputClass, 'w-full cursor-pointer')}>
              {METRIC_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>

          <Field label="Sensor source">
            <Segmented<CalendarSensor | 'harmonized'>
              ariaLabel="Sensor source"
              value={sensor}
              onChange={(v) => v !== 'harmonized' && setSensor(v)}
              className="self-start"
              options={[
                ...SENSOR_OPTIONS.map((o) => ({ value: o.value as CalendarSensor | 'harmonized', label: o.label })),
                { value: 'harmonized', label: 'Harmonized', disabled: true, title: 'Requires a completed harmonization run' },
              ]}
            />
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Matrix */}
        <Card
          className="min-w-0 lg:col-span-8"
          title="Temporal raster"
          description={showMatrix ? `${years.length} years (${years.length * 12} monthly bins)` : undefined}
          actions={
            <Segmented<'log' | 'linear'>
              ariaLabel="Colour scale"
              size="sm"
              value={scaleMode}
              onChange={setScaleMode}
              options={[{ value: 'log', label: 'Log10' }, { value: 'linear', label: 'Linear' }]}
            />
          }
        >
          {!showMatrix ? (
            res.loading ? (
              <LoadingState label="Loading calendar…" className="py-16" />
            ) : res.error ? (
              <ErrorState error={res.error} onRetry={res.reload} className="py-8" />
            ) : (
              <EmptyState
                title={noDataset ? NO_DATASET : 'No observations in range'}
                detail={noDataset ? AWAITING_NASA : `No loaded observations fall within ${startYear}–${endYear}`}
                icon="calendar_month"
                className="py-10"
              />
            )
          ) : (
            <div aria-busy={res.loading || undefined} className={cn('flex flex-col gap-4 transition-opacity', res.loading && 'opacity-60')}>
              <div className="overflow-x-auto pb-1">
                <div className="flex min-w-[600px] flex-col gap-1">
                  {/* Years */}
                  <div className="flex items-center gap-1">
                    <div className="w-12 shrink-0 pr-2 text-right font-label-xs text-label-xs font-semibold text-on-surface-variant">Month</div>
                    <div className="grid flex-1 gap-1 text-center font-mono text-label-xs text-on-surface-variant" style={{ gridTemplateColumns: colTemplate }}>
                      {years.map((y) => (
                        <span key={y} title={String(y)} className={selectedCell?.year === y ? 'rounded bg-primary-fixed px-0.5 font-bold text-on-primary-fixed-variant' : ''}>
                          {String(y).slice(2)}
                        </span>
                      ))}
                    </div>
                    <div className="w-14 shrink-0 pl-2 text-left font-label-xs text-label-xs font-semibold text-on-surface-variant">Share</div>
                  </div>

                  {/* Months */}
                  {monthNames.map((mName, mIdx) => {
                    const mNum = mIdx + 1;
                    return (
                      <div key={mName} className="flex items-center gap-1">
                        <div className="w-12 shrink-0 pr-2 text-right font-label-xs text-label-xs text-on-surface-variant">{mName}</div>
                        <div className="grid h-6 flex-1 gap-1" style={{ gridTemplateColumns: colTemplate }}>
                          {years.map((y) => {
                            const cell = cells.find((d) => d.year === y && d.month === mNum);
                            const value = cell ? cellValue(cell) : null;
                            const isSelected = selectedKey === `${y}-${mNum}`;
                            const label = cell
                              ? `${mName} ${y}: ${fmtValue(value ?? 0)} ${metricInfo.unit} (${cell.detectionCount.toLocaleString()} px)`
                              : `${mName} ${y}: no observations`;
                            return cell ? (
                              <button
                                key={`${y}-${mNum}`}
                                type="button"
                                onClick={() => setSelectedKey(`${y}-${mNum}`)}
                                aria-pressed={isSelected}
                                aria-label={label}
                                title={label}
                                style={{ backgroundColor: getCellColor(value ?? 0) }}
                                className={cn(
                                  'rounded-sm shadow-[inset_0_0_0_1px_rgb(27_27_24/0.06)] transition-transform hover:scale-125',
                                  isSelected && 'z-10 ring-2 ring-primary ring-offset-1',
                                )}
                              />
                            ) : (
                              <div key={`${y}-${mNum}`} title={label} className="rounded-sm border border-dashed border-border-grid" />
                            );
                          })}
                        </div>
                        <div className="w-14 shrink-0 pl-2 text-left font-mono text-label-xs text-on-surface-variant">
                          {grandTotal > 0 ? `${((monthTotals[mIdx] / grandTotal) * 100).toFixed(1)}%` : EMPTY}
                        </div>
                      </div>
                    );
                  })}

                  {/* Annual totals */}
                  <div className="mt-2 flex items-end gap-1 rounded-lg bg-surface-container-low p-1.5">
                    <div className="w-12 shrink-0 pr-2 text-right font-label-xs text-label-xs font-medium text-on-surface-variant">Annual</div>
                    <div className="grid h-10 flex-1 items-end gap-1" style={{ gridTemplateColumns: colTemplate }}>
                      {annual.map((a) => {
                        const heightPercent = annualMax > 0 ? Math.max(2, (a.total / annualMax) * 100) : 0;
                        return (
                          <div
                            key={a.year}
                            style={{ height: `${heightPercent}%` }}
                            className="rounded-sm bg-secondary-fixed-dim/80 hover:bg-secondary"
                            title={`${a.year}: ${fmtValue(a.total)} ${metricInfo.unit}`}
                          />
                        );
                      })}
                    </div>
                    <div className="w-14 shrink-0 pl-2 text-left font-mono text-label-xs font-semibold text-on-surface">{grandTotal > 0 ? '100%' : EMPTY}</div>
                  </div>
                  <p className="pt-1 text-center font-label-xs text-label-xs text-on-surface-variant">Columns are years (last two digits)</p>
                </div>
              </div>

              {/* Colour scale */}
              <div className="flex flex-col items-start justify-between gap-3 border-t border-border-grid pt-4 sm:flex-row sm:items-center">
                <div className="flex w-full items-center gap-3 sm:w-auto">
                  <span className="shrink-0 font-body text-body-sm font-medium text-on-surface-variant">Scale ({metricInfo.unit})</span>
                  <div className="flex flex-1 flex-col sm:w-64 sm:flex-none">
                    <div className="h-2.5 w-full rounded" style={{ background: rampGradient }} />
                    <div className="flex justify-between pt-0.5 font-mono text-label-xs text-on-surface-variant">
                      <span>0</span>
                      <span>{maxValue > 0 ? fmtValue(maxValue / 2) : EMPTY}</span>
                      <span>{maxValue > 0 ? fmtValue(maxValue) : EMPTY}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 font-label-xs text-label-xs text-on-surface-variant">
                  {([['Low', RAMP[0]], ['High', RAMP[4]], ['Maximum', RAMP[6]]] as const).map(([name, color]) => (
                    <span key={name} className="flex items-center gap-1.5">
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm shadow-[inset_0_0_0_1px_rgb(27_27_24/0.1)]" style={{ backgroundColor: color }} />
                      {name}
                    </span>
                  ))}
                </div>
              </div>

              <p className="font-body text-body-sm text-on-surface-variant">
                {res.data?.message} {cells.length} month(s) with observations across {new Set(cells.map((c) => c.year)).size} year(s). Anomaly flags appear only where at least three years of data exist for that calendar month.
              </p>
            </div>
          )}
        </Card>

        {/* Selection inspector */}
        <div className="min-w-0 lg:col-span-4">
          {selectedCell ? (
            <Card
              title={`${selectedCell.monthName} ${selectedCell.year}`}
              description={`${SENSOR_OPTIONS.find((o) => o.value === sensor)?.label} • ${selectedCell.isAnomaly ? 'Statistical anomaly' : selectedCell.anomalyPercent === null ? 'Baseline needs ≥3 years' : 'Within baseline'}`}
              actions={
                selectedCell.isAnomaly ? (
                  <Badge tone="error" dot>
                    Anomaly: {selectedCell.anomalyPercent !== null ? `${selectedCell.anomalyPercent > 0 ? '+' : ''}${selectedCell.anomalyPercent}%` : EMPTY}
                  </Badge>
                ) : undefined
              }
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
                <div>
                  <dt className="font-body text-body-sm text-on-surface-variant">Monthly FRP sum</dt>
                  <dd className="font-headline-md text-headline-md tabular-nums text-primary">
                    {selectedCell.frpSumGw} <span className="font-body text-body-sm font-normal text-on-surface-variant">GW</span>
                  </dd>
                </div>
                <div>
                  <dt className="font-body text-body-sm text-on-surface-variant">Detections count</dt>
                  <dd className="font-headline-md text-headline-md tabular-nums text-on-surface">
                    {selectedCell.detectionCount.toLocaleString()} <span className="font-body text-body-sm font-normal text-on-surface-variant">px</span>
                  </dd>
                </div>
                <div>
                  <dt className="font-body text-body-sm text-on-surface-variant">Mean FRP / pixel</dt>
                  <dd className="font-headline-md text-headline-md tabular-nums text-on-surface">
                    {selectedCell.meanFrpMw ?? EMPTY} <span className="font-body text-body-sm font-normal text-on-surface-variant">MW</span>
                  </dd>
                </div>
                <div>
                  <dt className="font-body text-body-sm text-on-surface-variant">Anomaly vs. month mean</dt>
                  <dd className="font-headline-md text-headline-md tabular-nums text-on-surface">
                    {selectedCell.anomalyPercent !== null ? `${selectedCell.anomalyPercent > 0 ? '+' : ''}${selectedCell.anomalyPercent}` : EMPTY}{' '}
                    <span className="font-body text-body-sm font-normal text-on-surface-variant">%</span>
                  </dd>
                </div>
              </dl>

              <Button variant="primary" icon="travel_explore" onClick={() => navigate('/app/fire-explorer')} className="mt-6 w-full">
                Open Fire Explorer
              </Button>
            </Card>
          ) : (
            <Card>
              <EmptyState
                compact
                icon="touch_app"
                title="No month selected"
                detail={cells.length ? 'Click any calendar cell to inspect monthly telemetry' : 'No monthly telemetry to inspect'}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
