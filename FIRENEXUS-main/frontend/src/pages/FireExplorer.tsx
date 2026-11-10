import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { ALL_PLATFORMS, FireObservation, HotspotQuery, SatellitePlatform } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { EmptyState, ErrorState } from '../components/common/StatePanel';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtLat, fmtLon } from '../utils/format';
import { MapLibreCanvas } from '../components/maps/MapLibreCanvas';
import { BASEMAPS, BasemapId } from '../config/basemaps';
import { Alert } from '../components/ui/Alert';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, inputClass } from '../components/ui/Field';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Segmented';
import { cn } from '../utils/cn';

type AoiMode = 'global' | 'custom';

export const FireExplorer: React.FC = () => {
  const navigate = useNavigate();
  const [sensorFilter, setSensorFilter] = useState<'all' | 'modis' | 'viirs'>('all');
  const [platformFilter, setPlatformFilter] = useState<SatellitePlatform | 'all'>('all');
  const [regionFilter, setRegionFilter] = useState('');
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [minFrp, setMinFrp] = useState<number>(0);
  const [maxFrp, setMaxFrp] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [aoiMode, setAoiMode] = useState<AoiMode>('global');
  const [bboxText, setBboxText] = useState({ minLat: '', maxLat: '', minLon: '', maxLon: '' });
  const [viewMode, setViewMode] = useState<'all' | 'night'>('all');
  const [showHarmonized, setShowHarmonized] = useState(true);
  const [layerModis, setLayerModis] = useState(true);
  const [layerViirs, setLayerViirs] = useState(true);
  const [selectedHotspot, setSelectedHotspot] = useState<FireObservation | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>('satellite');
  const [copied, setCopied] = useState(false);
  const regionsRes = useApiResource(() => api.getRegions(), []);

  // Parameter validation (client side; the API validates again)
  const bboxNums = {
    minLat: Number(bboxText.minLat), maxLat: Number(bboxText.maxLat),
    minLon: Number(bboxText.minLon), maxLon: Number(bboxText.maxLon),
  };
  const bboxFilled = Object.values(bboxText).every((v) => v.trim() !== '');
  const bboxValid =
    bboxFilled &&
    Object.values(bboxNums).every((n) => Number.isFinite(n)) &&
    bboxNums.minLat >= -90 && bboxNums.maxLat <= 90 && bboxNums.minLat <= bboxNums.maxLat &&
    bboxNums.minLon >= -180 && bboxNums.maxLon <= 180 && bboxNums.minLon <= bboxNums.maxLon;
  const maxFrpNum = maxFrp.trim() === '' ? undefined : Number(maxFrp);
  const frpValid = maxFrpNum === undefined || (Number.isFinite(maxFrpNum) && maxFrpNum >= minFrp);
  const datesValid = !startDate || !endDate || startDate <= endDate;
  const validationMessage = !frpValid
    ? 'Max FRP must be a number not below Min FRP'
    : !datesValid
    ? 'Start date must not be after end date'
    : aoiMode === 'custom' && bboxFilled && !bboxValid
    ? 'Bounding box must be within ±90° / ±180° with min ≤ max'
    : null;

  const query: HotspotQuery = {
    sensor: platformFilter !== 'all'
      ? (platformFilter === 'Terra' || platformFilter === 'Aqua' ? 'MODIS' : 'VIIRS')
      : sensorFilter === 'all' ? undefined : (sensorFilter.toUpperCase() as 'MODIS' | 'VIIRS'),
    platform: platformFilter === 'all' ? undefined : platformFilter,
    regionId: regionFilter || undefined,
    minConfidence,
    minFrp,
    maxFrp: frpValid ? maxFrpNum : undefined,
    startDate: datesValid && startDate ? startDate : undefined,
    endDate: datesValid && endDate ? endDate : undefined,
    bbox: aoiMode === 'custom' && bboxValid ? bboxNums : undefined,
  };

  const res = useApiResource(
    () => api.getExplorerHotspots(query),
    [sensorFilter, platformFilter, regionFilter, minConfidence, minFrp, maxFrp, startDate, endDate, aoiMode, bboxText.minLat, bboxText.maxLat, bboxText.minLon, bboxText.maxLon],
  );
  const allHotspots = res.data?.items ?? [];
  const hotspots = viewMode === 'night' ? allHotspots.filter((h) => h.daynight === 'N') : allHotspots;
  const noDataset = res.data?.status === 'no_dataset';

  useEffect(() => {
    if (selectedHotspot && !hotspots.some((h) => h.id === selectedHotspot.id)) setSelectedHotspot(null);
  }, [hotspots, selectedHotspot]);

  const handleCopyCoordinates = async () => {
    if (!selectedHotspot) return;
    try {
      await navigator.clipboard.writeText(`${selectedHotspot.latitude}, ${selectedHotspot.longitude}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleExportGeoJson = () => {
    const featureCollection = {
      type: 'FeatureCollection',
      features: hotspots.map((h) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [h.longitude, h.latitude],
        },
        properties: {
          id: h.id,
          source: h.source,
          platform: h.platform,
          frp: h.frp,
          brightness: h.brightness,
          confidence: h.confidence,
          acq_date: h.acq_date,
          acq_time: h.acq_time,
          status: h.harmonization_status,
        },
      })),
    };

    if (hotspots.length === 0) return;
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firenexus_hotspots_${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusBadge = (s: FireObservation['harmonization_status']): { label: string; tone: BadgeTone } =>
    s === 'harmonized_match'
      ? { label: 'Dual-sensor harmonized', tone: 'success' }
      : { label: s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'neutral' };

  const layerToggles = [
    { label: 'MODIS 1km', on: layerModis, set: setLayerModis, dot: 'bg-modis' },
    { label: 'VIIRS 375m', on: layerViirs, set: setLayerViirs, dot: 'bg-viirs' },
    { label: 'Harmonized', on: showHarmonized, set: setShowHarmonized, dot: 'bg-primary' },
  ];

  const overlay = 'pointer-events-auto rounded-lg border border-border-grid bg-surface-container-lowest/95 shadow-raised backdrop-blur';
  const selectedStatus = selectedHotspot ? statusBadge(selectedHotspot.harmonization_status) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Fire Explorer"
        description="Filter satellite fire detections by area, time, sensor and intensity, then inspect individual hotspots on the map."
        actions={
          <Button
            icon="file_download"
            onClick={handleExportGeoJson}
            disabled={hotspots.length === 0}
            title={hotspots.length === 0 ? 'Nothing to export: no detections match the filters' : `Download the ${hotspots.length.toLocaleString()} displayed detections as GeoJSON`}
          >
            Export GeoJSON
          </Button>
        }
      />

      {/* Filters */}
      <Card padding="md">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.7fr)]">
          <Field label="Spatial area" htmlFor="fe-aoi">
            <select id="fe-aoi" value={aoiMode} onChange={(e) => setAoiMode(e.target.value as AoiMode)} className={cn(inputClass, 'w-full cursor-pointer')}>
              <option value="global">Global (no spatial filter)</option>
              <option value="custom">Custom bounding box</option>
            </select>
            {aoiMode === 'custom' && (
              <div className="grid grid-cols-4 gap-2">
                {([['minLat', 'S°'], ['maxLat', 'N°'], ['minLon', 'W°'], ['maxLon', 'E°']] as const).map(([k, ph]) => (
                  <input
                    key={k}
                    type="number"
                    placeholder={ph}
                    aria-label={k}
                    value={bboxText[k]}
                    onChange={(e) => setBboxText({ ...bboxText, [k]: e.target.value })}
                    className={cn(inputClass, 'w-full min-w-0 px-2 font-mono')}
                  />
                ))}
              </div>
            )}
          </Field>

          <Field label="Region of interest" htmlFor="fe-region">
            <select id="fe-region" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className={cn(inputClass, 'w-full cursor-pointer')}>
              <option value="">All regions</option>
              {(regionsRes.data ?? []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>

          <Field label="Platform" htmlFor="fe-platform">
            <select id="fe-platform" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as SatellitePlatform | 'all')} className={cn(inputClass, 'w-full cursor-pointer')}>
              <option value="all">All platforms</option>
              {ALL_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </Field>

          <Field label="Sensor">
            <Segmented<'all' | 'modis' | 'viirs'>
              ariaLabel="Sensor filter"
              value={sensorFilter}
              onChange={setSensorFilter}
              className="self-start"
              options={[
                { value: 'all', label: 'All sensors' },
                { value: 'modis', label: <><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-modis" />MODIS 1km</> },
                { value: 'viirs', label: <><span aria-hidden="true" className="h-2 w-2 rounded-full bg-viirs" />VIIRS 375m</> },
              ]}
            />
          </Field>

          <Field label="Acquisition window (UTC)">
            <div className="flex items-center gap-2">
              <input type="date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={cn(inputClass, 'min-w-0 flex-1 px-2')} />
              <span aria-hidden="true" className="text-outline">→</span>
              <input type="date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={cn(inputClass, 'min-w-0 flex-1 px-2')} />
            </div>
          </Field>

          <Field
            label="Minimum confidence"
            htmlFor="fe-confidence"
            right={<span className="font-body text-body-sm font-semibold text-on-surface">≥ {minConfidence}%</span>}
            hint="Applies to numeric confidence only."
          >
            <input
              id="fe-confidence"
              type="range"
              min="0"
              max="100"
              step="5"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="h-10 w-full cursor-pointer accent-primary"
            />
          </Field>

          <Field
            label="FRP range (MW)"
            right={<span className="font-body text-body-sm font-semibold text-on-surface">{minFrp} — {maxFrp.trim() === '' ? '∞' : maxFrp}</span>}
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                aria-label="Min FRP"
                value={minFrp}
                onChange={(e) => setMinFrp(Math.max(0, Number(e.target.value) || 0))}
                className={cn(inputClass, 'min-w-0 flex-1 px-2 font-mono')}
              />
              <span className="font-body text-body-sm text-on-surface-variant">to</span>
              <input
                type="number"
                min={0}
                placeholder="max"
                aria-label="Max FRP"
                value={maxFrp}
                onChange={(e) => setMaxFrp(e.target.value)}
                className={cn(inputClass, 'min-w-0 flex-1 px-2 font-mono')}
              />
            </div>
          </Field>

          <Field label="View">
            <Segmented<'all' | 'night' | 'density'>
              ariaLabel="Detection view"
              value={viewMode}
              onChange={(v) => v !== 'density' && setViewMode(v)}
              className="self-start"
              options={[
                { value: 'all', label: 'All detections' },
                { value: 'night', label: 'Night fires' },
                { value: 'density', label: 'Gridded density', disabled: true, title: 'Gridded density is not available yet' },
              ]}
            />
          </Field>
        </div>
      </Card>

      {validationMessage && <Alert tone="error">{validationMessage}</Alert>}

      {/* Map workspace */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-border-grid bg-surface-container-lowest shadow-card lg:h-[calc(100vh-15rem)] lg:min-h-[780px] lg:flex-row">
        {/* Map */}
        <div className="relative h-[540px] w-full select-none overflow-hidden bg-surface-dim lg:h-auto lg:w-3/4 lg:flex-grow">
          <MapLibreCanvas
            basemap={basemap}
            hotspots={hotspots}
            selectedHotspot={selectedHotspot}
            onSelectHotspot={(h) => setSelectedHotspot(h)}
            showModis={layerModis}
            showViirs={layerViirs}
            showHarmonized={showHarmonized}
            heightClass="h-full w-full absolute inset-0"
            emptyMessage={
              res.loading
                ? { title: 'Loading', detail: 'Querying hotspots…' }
                : res.error
                ? { title: 'Request failed', detail: res.error.message }
                : noDataset
                ? { title: NO_DATASET, detail: AWAITING_NASA }
                : { title: 'No observations match the filters', detail: 'Adjust sensor, confidence, FRP, date or area filters' }
            }
          />

          {/* Layer and basemap controls */}
          <div className="pointer-events-none absolute left-16 right-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
            <div className={cn(overlay, 'flex items-center gap-0.5 p-1')} role="group" aria-label="Map layers">
              {layerToggles.map(({ label, on, set, dot }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => set(!on)}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-body text-label-xs font-medium transition-colors',
                    on ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container',
                  )}
                >
                  <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', on ? dot : 'bg-outline-variant')} />
                  {label}
                </button>
              ))}
            </div>
            <Segmented<BasemapId>
              ariaLabel="Basemap style"
              size="sm"
              value={basemap}
              onChange={setBasemap}
              className={cn(overlay, 'bg-surface-container-lowest/95')}
              options={(Object.keys(BASEMAPS) as BasemapId[]).map((id) => ({ value: id, label: BASEMAPS[id].label }))}
            />
          </div>

          {/* Legend and status */}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
            <div className={cn(overlay, 'flex max-w-sm flex-col gap-2 px-4 py-3')}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-body text-body-sm font-semibold text-on-surface">Detection symbology</span>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  N = {hotspots.length.toLocaleString()} observations{res.data && res.data.total > allHotspots.length ? ` (of ${res.data.total.toLocaleString()})` : ''}
                </span>
              </div>
              <div className="hidden grid-cols-1 gap-x-4 gap-y-1.5 font-label-xs text-label-xs text-on-surface-variant sm:grid sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-modis bg-modis/20"><span className="h-1 w-1 bg-modis" /></span>
                  <span>MODIS Terra / Aqua 1km</span>
                </div>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rotate-45 bg-viirs" />
                  <span>VIIRS 375m (S-NPP, NOAA-20, NOAA-21)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-0.5 w-4 shrink-0 border-b border-dashed border-primary" />
                  <span>Harmonized association</span>
                </div>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-error" />
                  <span>FRP &gt; 100 MW (high)</span>
                </div>
              </div>
            </div>

            <div className={cn(overlay, 'flex items-center gap-3 px-3 py-1.5 font-label-xs text-label-xs text-on-surface-variant')}>
              <span className="font-mono">EPSG:4326</span>
              <span aria-hidden="true" className="h-4 w-px bg-border-grid" />
              <span>{noDataset ? NO_DATASET : `${hotspots.length.toLocaleString()} shown`}</span>
            </div>
          </div>
        </div>

        {/* Inspector */}
        <aside aria-label="Hotspot inspector" className="z-20 w-full overflow-y-auto border-t border-border-grid bg-surface-container-lowest lg:w-1/4 lg:min-w-[320px] lg:border-l lg:border-t-0">
          {selectedHotspot && selectedStatus ? (
            <div className="flex flex-col">
              <div className="flex flex-col gap-2 border-b border-border-grid p-5">
                <div className="flex">
                  <Badge tone={selectedStatus.tone} dot>{selectedStatus.label}</Badge>
                </div>
                <h2 className="break-all font-mono text-[15px] font-semibold text-on-surface">{selectedHotspot.id}</h2>
                <p className="font-body text-body-sm text-on-surface-variant">
                  {selectedHotspot.source} {selectedHotspot.platform} · Satellite ID <span className="font-mono">{selectedHotspot.satellite ?? EMPTY}</span>
                </p>
              </div>

              <section className="flex flex-col gap-3 border-b border-border-grid px-5 py-4">
                <h3 className="font-body text-body-sm font-semibold text-on-surface">Location (WGS 84)</h3>
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="font-label-xs text-label-xs text-on-surface-variant">Latitude</dt>
                    <dd className="font-mono text-body-sm text-on-surface">{fmtLat(selectedHotspot.latitude)}</dd>
                  </div>
                  <div>
                    <dt className="font-label-xs text-label-xs text-on-surface-variant">Longitude</dt>
                    <dd className="font-mono text-body-sm text-on-surface">{fmtLon(selectedHotspot.longitude)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-label-xs text-label-xs text-on-surface-variant">Pixel extent</dt>
                    <dd className="font-body text-body-sm text-on-surface">{selectedHotspot.scan ?? EMPTY}km × {selectedHotspot.track ?? EMPTY}km</dd>
                  </div>
                </dl>
              </section>

              <section className="flex flex-col gap-3 border-b border-border-grid px-5 py-4">
                <h3 className="font-body text-body-sm font-semibold text-on-surface">Acquisition</h3>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-body-sm text-on-surface">{selectedHotspot.acq_date} {selectedHotspot.acq_time} UTC</span>
                  <Badge>{selectedHotspot.daynight === 'D' ? 'Day overpass' : selectedHotspot.daynight === 'N' ? 'Night overpass' : 'Day/night not available'}</Badge>
                </div>
                <p className="font-body text-body-sm text-on-surface-variant">
                  Nominal resolution: {selectedHotspot.source === 'MODIS' ? '1000m' : '375m'} nadir
                </p>
              </section>

              {selectedHotspot.delta_spatial_m !== null && (
                <section className="flex flex-col gap-3 border-b border-border-grid px-5 py-4">
                  <h3 className="font-body text-body-sm font-semibold text-on-surface">
                    Co-located match <span className="font-normal text-on-surface-variant">· {selectedHotspot.source === 'MODIS' ? 'VIIRS counterpart' : 'MODIS counterpart'}</span>
                  </h3>
                  <dl className="flex flex-col gap-1.5 font-body text-body-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-on-surface-variant">Acquisition delta (Δt)</dt>
                      <dd className="font-semibold tabular-nums text-on-surface">{selectedHotspot.delta_time_min !== null ? `${selectedHotspot.delta_time_min.toFixed(1)} min` : EMPTY}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-on-surface-variant">Centroid distance (Δs)</dt>
                      <dd className="font-semibold tabular-nums text-on-surface">{selectedHotspot.delta_spatial_m} m</dd>
                    </div>
                  </dl>
                </section>
              )}

              <section className="flex flex-col gap-4 px-5 py-4">
                <h3 className="font-body text-body-sm font-semibold text-on-surface">Radiative energetics</h3>

                <div>
                  <div className="flex items-baseline justify-between gap-2 font-body text-body-sm">
                    <span className="text-on-surface-variant">Confidence score</span>
                    <span className="font-semibold text-on-surface">
                      {selectedHotspot.confidence !== null ? `${selectedHotspot.confidence}%` : selectedHotspot.confidence_class ?? EMPTY}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${selectedHotspot.confidence ?? 0}%` }} />
                  </div>
                </div>

                <div className="flex items-end justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-body text-body-sm text-on-surface-variant">Total FRP</span>
                    <span className="font-label-xs text-label-xs text-on-surface-variant">Uncalibrated product value</span>
                  </div>
                  <span className="font-headline-md text-headline-md tabular-nums text-primary">
                    {selectedHotspot.frp ?? EMPTY} <span className="font-body text-body-sm font-normal text-on-surface-variant">MW</span>
                  </span>
                </div>

                <dl className="flex flex-col gap-1.5 font-body text-body-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-on-surface-variant">Brightness temperature</dt>
                    <dd className="font-semibold tabular-nums text-on-surface">
                      {selectedHotspot.brightness !== null ? `${selectedHotspot.brightness} K` : EMPTY}{' '}
                      {selectedHotspot.brightness !== null && (
                        <span className="font-normal text-on-surface-variant">({(selectedHotspot.brightness - 273.15).toFixed(1)}°C)</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-on-surface-variant">MODIS land cover (MCD12Q1)</dt>
                    <dd className="text-right font-semibold text-on-surface">{selectedHotspot.biome ?? 'Not in loaded product'}</dd>
                  </div>
                </dl>
              </section>

              <div className="flex flex-col gap-2 px-5 pb-5">
                <Button variant="primary" icon="content_copy" onClick={handleCopyCoordinates} aria-live="polite" className="w-full">
                  {copied ? 'Coordinates copied' : 'Copy coordinates'}
                </Button>
                <Button icon="show_chart" onClick={() => navigate('/app/temporal-analysis')} className="w-full">Temporal curve</Button>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border-grid bg-surface-container-low px-5 py-3 font-label-xs text-label-xs text-on-surface-variant">
                <span>Version <span className="font-mono">{selectedHotspot.version ?? EMPTY}</span></span>
                <span>{selectedHotspot.matched_cluster_id ? <>Cluster <span className="font-mono">{selectedHotspot.matched_cluster_id}</span></> : 'No cluster'}</span>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              {noDataset ? (
                <EmptyState title={NO_DATASET} detail={AWAITING_NASA} icon="database_off" />
              ) : res.error ? (
                <ErrorState error={res.error} onRetry={res.reload} />
              ) : (
                <EmptyState icon="ads_click" title="No hotspot selected" detail="Select a hotspot on the map to inspect telemetry" />
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
