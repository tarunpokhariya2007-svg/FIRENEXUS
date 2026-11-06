import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { ALL_PLATFORMS, FireObservation, HotspotQuery, SatellitePlatform } from '../types/firenexus';
import { useApiResource } from '../hooks/useApi';
import { EmptyState, ErrorState } from '../components/common/StatePanel';
import { AWAITING_NASA, EMPTY, NO_DATASET, fmtLat, fmtLon } from '../utils/format';
import { MapLibreCanvas } from '../components/maps/MapLibreCanvas';

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

  return (
    <div className="flex flex-col w-full min-h-[calc(100vh-64px)]">
      {/* Control / Filter Dock Bar (Compact Workstation Header) */}
      <div className="w-full bg-surface-container-low px-space-md py-space-sm flex flex-wrap items-center justify-between gap-space-sm shadow-sm z-30 select-none border-b border-structural">
        {/* Left Region & Date Filter Group */}
        <div className="flex flex-wrap items-center gap-space-sm">
          {/* Geographic Extent Selector */}
          <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-1 rounded shadow-sm border border-structural">
            <span className="material-symbols-outlined text-[15px] text-tertiary">travel_explore</span>
            <div className="flex flex-col">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-mono">
                Spatial AOI
              </span>
              <select
                value={aoiMode}
                onChange={(e) => setAoiMode(e.target.value as AoiMode)}
                className="bg-transparent font-label-sm text-label-sm text-on-surface outline-none cursor-pointer pr-1 font-mono"
              >
                <option value="global">Global (no spatial filter)</option>
                <option value="custom">Custom bounding box</option>
              </select>
              {aoiMode === 'custom' && (
                <div className="grid grid-cols-4 gap-1 pt-1">
                  {([['minLat', 'S°'], ['maxLat', 'N°'], ['minLon', 'W°'], ['maxLon', 'E°']] as const).map(([k, ph]) => (
                    <input
                      key={k}
                      type="number"
                      placeholder={ph}
                      aria-label={k}
                      value={bboxText[k]}
                      onChange={(e) => setBboxText({ ...bboxText, [k]: e.target.value })}
                      className="w-14 bg-surface-container-low border border-structural rounded px-1 text-[10px] font-mono text-on-surface outline-none"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <label className="flex flex-col gap-0.5 bg-surface-container-lowest px-space-sm py-1 rounded shadow-sm border border-structural">
            <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-mono">Region of Interest</span>
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="max-w-52 bg-transparent font-label-sm text-label-sm text-on-surface outline-none cursor-pointer font-mono">
              <option value="">All regions</option>
              {(regionsRes.data ?? []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>

          {/* Temporal Interval */}
          <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-1 rounded shadow-sm border border-structural">
            <span className="material-symbols-outlined text-[15px] text-secondary">date_range</span>
            <div className="flex flex-col">
              <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-mono">
                Acquisition Window
              </span>
              <div className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface font-mono">
                <input
                  type="date"
                  aria-label="Start date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-[11px] outline-none font-mono"
                />
                <span className="text-outline">→</span>
                <input
                  type="date"
                  aria-label="End date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-[11px] outline-none font-mono"
                />
              </div>
            </div>
          </div>

          {/* Sensor Filter Pills */}
          <label className="flex flex-col gap-0.5 bg-surface-container-lowest px-space-sm py-1 rounded shadow-sm border border-structural">
            <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-mono">Platform</span>
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as SatellitePlatform | 'all')} className="bg-transparent font-label-sm text-label-sm text-on-surface outline-none cursor-pointer font-mono">
              <option value="all">All platforms</option>
              {ALL_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </label>

          {/* Sensor Filter Pills */}
          <div className="flex items-center bg-surface-container-high p-0.5 rounded gap-0.5 font-mono">
            <button
              onClick={() => setSensorFilter('all')}
              className={`sensor-pill px-space-sm py-1 rounded font-label-xs text-label-xs transition-colors ${
                sensorFilter === 'all'
                  ? 'text-on-surface bg-surface-container-lowest shadow-sm font-medium'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All Sensors
            </button>
            <button
              onClick={() => setSensorFilter('modis')}
              className={`sensor-pill px-space-sm py-1 rounded font-label-xs text-label-xs transition-colors flex items-center gap-1 ${
                sensorFilter === 'modis'
                  ? 'text-on-surface bg-surface-container-lowest shadow-sm font-medium'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="w-2 h-2 rounded-none bg-[#487D9A]"></span>
              MODIS 1km
            </button>
            <button
              onClick={() => setSensorFilter('viirs')}
              className={`sensor-pill px-space-sm py-1 rounded font-label-xs text-label-xs transition-colors flex items-center gap-1 ${
                sensorFilter === 'viirs'
                  ? 'text-on-surface bg-surface-container-lowest shadow-sm font-medium'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-[#D18445]"></span>
              VIIRS 375m
            </button>
          </div>
        </div>

        {/* Right Telemetry Threshold Controls & Mode Switcher */}
        <div className="flex flex-wrap items-center gap-space-sm font-mono">
          {/* Confidence Slider */}
          <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-1 rounded shadow-sm border border-structural">
            <div className="flex flex-col">
              <div className="flex justify-between items-center gap-2">
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                  Confidence Level
                </span>
                <span className="font-label-xs text-label-xs text-on-surface font-semibold">
                  ≥ {minConfidence}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="w-24 h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <span className="font-label-xs text-[10px] text-outline">Numeric only</span>
              </div>
            </div>
          </div>

          {/* FRP Filter Slider */}
          <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-1 rounded shadow-sm border border-structural">
            <div className="flex flex-col">
              <div className="flex justify-between items-center gap-2">
                <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                  FRP Range (MW)
                </span>
                <span className="font-label-xs text-label-xs text-on-surface font-semibold">
                  {minFrp} — {maxFrp.trim() === '' ? '∞' : maxFrp}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  aria-label="Min FRP"
                  value={minFrp}
                  onChange={(e) => setMinFrp(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 bg-surface-container-low border border-structural rounded px-1 text-[10px] text-primary font-medium outline-none"
                />
                <span className="font-label-xs text-[10px] text-outline">to</span>
                <input
                  type="number"
                  min={0}
                  placeholder="max"
                  aria-label="Max FRP"
                  value={maxFrp}
                  onChange={(e) => setMaxFrp(e.target.value)}
                  className="w-14 bg-surface-container-low border border-structural rounded px-1 text-[10px] text-outline outline-none"
                />
              </div>
            </div>
          </div>

          {/* View Modes */}
          <div className="flex items-center bg-surface-container-high p-0.5 rounded gap-0.5">
            <button
              onClick={() => setViewMode('all')}
              className={`px-space-sm py-1 rounded font-label-xs text-label-xs font-medium flex items-center gap-1 ${
                viewMode === 'all' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">layers</span>
              <span>All Detections</span>
            </button>
            <button
              onClick={() => setViewMode('night')}
              className={`px-space-sm py-1 rounded font-label-xs text-label-xs flex items-center gap-1 ${
                viewMode === 'night' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">bedtime</span>
              <span>Night Fires</span>
            </button>
            <button
              disabled
              title="Gridded density is not available yet"
              className="px-space-sm py-1 rounded font-label-xs text-label-xs flex items-center gap-1 text-on-surface-variant opacity-50 cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[13px]">grid_on</span>
              <span>Gridded Density</span>
            </button>
          </div>
        </div>
      </div>

      {validationMessage && (
        <div role="alert" className="w-full px-space-md py-1 bg-error-container text-on-error-container font-label-xs text-label-xs font-mono">
          {validationMessage}
        </div>
      )}

      {/* Primary Cartographic Workspace Split Screen */}
      <div className="flex flex-col lg:flex-row w-full flex-grow relative overflow-hidden bg-surface" style={{ minHeight: 'calc(100vh - 116px)' }}>
        {/* LEFT / CENTER CANVAS: 75% GIS WORKSPACE */}
        <div className="relative w-full lg:w-3/4 flex-grow bg-surface-dim overflow-hidden select-none flex flex-col justify-between">
          <MapLibreCanvas
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

          {/* Sensor layer controls docked top-left */}
          <div className="relative z-10 m-space-md flex items-start gap-space-sm pointer-events-none">
            <div className="pointer-events-auto bg-surface-container-lowest/95 backdrop-blur px-space-xs py-1 rounded shadow-md flex items-center gap-1 border border-structural font-mono text-label-xs">
              {([
                ['MODIS 1km', layerModis, setLayerModis],
                ['VIIRS 375m', layerViirs, setLayerViirs],
                ['Harmonized', showHarmonized, setShowHarmonized],
              ] as const).map(([label, on, set]) => (
                <button
                  key={label}
                  onClick={() => set(!on)}
                  aria-pressed={on}
                  className={`px-2 py-0.5 rounded transition-colors font-medium ${
                    on ? 'bg-surface-container-high text-on-surface font-semibold' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Docked Bottom Spatial Bar: Detection Symbology */}
          <div className="relative z-10 m-space-md flex flex-wrap items-end justify-between gap-space-md pointer-events-none">
            <div className="pointer-events-auto bg-surface-container-lowest/95 backdrop-blur px-space-md py-space-sm rounded shadow-md max-w-sm flex flex-col gap-space-xs border border-structural font-mono">
              <div className="flex items-center justify-between">
                <span className="font-label-xs text-label-xs text-on-surface font-semibold uppercase tracking-wider">
                  Detection Symbology
                </span>
                <span className="font-label-xs text-[10px] text-outline">
                  N = {hotspots.length.toLocaleString()} Observations{res.data && res.data.total > allHotspots.length ? ` (of ${res.data.total.toLocaleString()})` : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-space-md gap-y-1 pt-1 font-label-xs text-label-xs text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border border-[#487D9A] bg-[#487D9A]/20 flex items-center justify-center shrink-0">
                    <span className="w-1 h-1 bg-[#487D9A]"></span>
                  </span>
                  <span>MODIS Terra/Aqua 1km</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rotate-45 bg-[#D18445] shrink-0"></span>
                  <span>VIIRS 375m (S-NPP/J1)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-0.5 border-b border-dashed border-[#9e3d19] shrink-0"></span>
                  <span>Harmonized Association</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-error shrink-0"></span>
                  <span>FRP &gt; 100 MW (High)</span>
                </div>
              </div>
            </div>

            <div className="pointer-events-auto bg-surface-container-lowest/95 backdrop-blur px-space-md py-1.5 rounded shadow-md flex items-center gap-space-md border border-structural font-mono text-[10px]">
              <span className="text-on-surface-variant">CRS: EPSG:4326</span>
              <div className="h-4 w-px bg-surface-container-highest"></div>
              <span className="text-tertiary">{noDataset ? NO_DATASET.toUpperCase() : `${hotspots.length.toLocaleString()} IN VIEW`}</span>
            </div>
          </div>
        </div>

        {/* RIGHT INFORMATION PANEL: 25% SCIENTIFIC TELEMETRY INSPECTOR */}
        <div className="w-full lg:w-1/4 bg-surface-container-lowest flex flex-col justify-between overflow-y-auto z-20 shadow-md border-l border-structural">
          {selectedHotspot ? (
            <div className="flex flex-col">
              {/* Top Inspector Header */}
              <div className="p-space-md bg-surface-container-low flex flex-col gap-space-xs border-b border-structural">
                <div className="flex items-center justify-between">
                  <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-semibold font-mono">
                    Hotspot Inspector
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed-variant font-label-xs text-label-xs font-semibold uppercase font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                    {selectedHotspot.harmonization_status === 'harmonized_match'
                      ? 'Dual-Sensor Harmonized'
                      : selectedHotspot.harmonization_status.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex flex-col">
                  <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight font-mono">
                    {selectedHotspot.id}
                  </h2>
                  <span className="font-label-xs text-[10px] text-outline font-mono">
                    PLATFORM: {selectedHotspot.source} {selectedHotspot.platform} • SATELLITE ID: {selectedHotspot.satellite ?? EMPTY}
                  </span>
                </div>
              </div>

              {/* Telemetry Data Grid Body */}
              <div className="p-space-md flex flex-col gap-space-md">
                {/* Geolocation Coordinates Block */}
                <div className="bg-surface-container-low p-space-sm rounded flex flex-col gap-1 border border-structural font-mono">
                  <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                    Spatial Centroid (WGS 84)
                  </span>
                  <div className="grid grid-cols-2 gap-space-sm pt-0.5 font-label-sm text-label-sm text-on-surface font-medium">
                    <div className="flex flex-col">
                      <span className="font-label-xs text-[10px] text-outline">LATITUDE</span>
                      <span>{fmtLat(selectedHotspot.latitude)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-label-xs text-[10px] text-outline">LONGITUDE</span>
                      <span>{fmtLon(selectedHotspot.longitude)}</span>
                    </div>
                  </div>
                  <div className="pt-1 text-[11px] font-label-xs text-outline flex items-center justify-between border-t border-surface-container-highest">
                    <span>Pixel Extent: {selectedHotspot.scan ?? EMPTY}km × {selectedHotspot.track ?? EMPTY}km</span>
                    <span>Confidence: {selectedHotspot.confidence !== null ? `${selectedHotspot.confidence}%` : selectedHotspot.confidence_class ?? EMPTY}</span>
                  </div>
                </div>

                {/* Acquisition Timeline & Orbit Data */}
                <div className="flex flex-col gap-1">
                  <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider font-mono">
                    Acquisition Metric
                  </span>
                  <div className="bg-surface-container-low p-space-sm rounded flex flex-col gap-1.5 border border-structural font-mono">
                    <div className="flex items-center justify-between">
                      <span className="font-body-sm text-body-sm text-on-surface font-medium">
                        {selectedHotspot.acq_date} {selectedHotspot.acq_time} UTC
                      </span>
                      <span className="font-label-xs text-label-xs px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface font-semibold">
                        {selectedHotspot.daynight === 'D' ? 'DAY OVERPASS' : selectedHotspot.daynight === 'N' ? 'NIGHT OVERPASS' : 'DAY/NIGHT N/A'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-outline font-label-xs text-label-xs pt-1">
                      <div>Solar Zenith: <span className="text-on-surface font-medium">{EMPTY}</span></div>
                      <div>Satellite Zenith: <span className="text-on-surface font-medium">{EMPTY}</span></div>
                    </div>
                  </div>
                </div>

                {/* Sensor Correlation Diagnostic */}
                <div className="flex flex-col gap-1 font-mono">
                  <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                    Sensor Cross-Correlation
                  </span>
                  <div className="space-y-1.5">
                    {/* Primary Sensor Card */}
                    <div className="bg-surface-container-low p-space-sm rounded flex flex-col gap-1 border border-structural">
                      <div className="flex items-center justify-between">
                        <span className="font-label-xs text-label-xs px-1.5 py-0.2 rounded bg-[#FAF3EC] text-[#D18445] font-semibold border border-[#D18445]/30">
                          PRIMARY SENSOR
                        </span>
                        <span className="font-label-xs text-label-xs text-on-surface font-medium">
                          {selectedHotspot.source} {selectedHotspot.platform}
                        </span>
                      </div>
                      <div className="flex justify-between items-baseline pt-1">
                        <span className="font-body-sm text-body-sm text-on-surface-variant">Brightness Temp</span>
                        <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                          {selectedHotspot.brightness !== null ? `${selectedHotspot.brightness} K` : EMPTY}
                        </span>
                      </div>
                      <span className="font-label-xs text-[10px] text-outline">
                        Nominal spatial resolution: {selectedHotspot.source === 'MODIS' ? '1000m' : '375m'} nadir
                      </span>
                    </div>

                    {/* Correlated Match Card */}
                    {selectedHotspot.delta_spatial_m !== null && (
                      <div className="bg-surface-container-low p-space-sm rounded flex flex-col gap-1 border border-structural">
                        <div className="flex items-center justify-between">
                          <span className="font-label-xs text-label-xs px-1.5 py-0.2 rounded bg-[#EAF1F5] text-[#487D9A] font-semibold border border-[#487D9A]/30">
                            CO-LOCATED MATCH
                          </span>
                          <span className="font-label-xs text-label-xs text-on-surface font-medium">
                            {selectedHotspot.source === 'MODIS' ? 'VIIRS counterpart' : 'MODIS counterpart'}
                          </span>
                        </div>
                        <div className="flex justify-between items-baseline pt-1">
                          <span className="font-body-sm text-body-sm text-on-surface-variant">Acquisition Delta (Δt)</span>
                          <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                            {selectedHotspot.delta_time_min !== null ? `${selectedHotspot.delta_time_min.toFixed(1)} min` : EMPTY}
                          </span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="font-body-sm text-body-sm text-on-surface-variant">Centroid Distance (Δs)</span>
                          <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                            {selectedHotspot.delta_spatial_m} m
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Radiative Physics & Classification Metrics */}
                <div className="flex flex-col gap-1 font-mono">
                  <span className="font-label-xs text-label-xs text-on-surface-variant uppercase tracking-wider">
                    Radiative Energetics
                  </span>
                  <div className="bg-surface-container-low p-space-sm rounded space-y-2 border border-structural">
                    {/* Confidence score */}
                    <div>
                      <div className="flex justify-between items-center">
                        <span className="font-body-sm text-body-sm text-on-surface">Confidence Score</span>
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                          <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                            {selectedHotspot.confidence !== null ? `${selectedHotspot.confidence}%` : selectedHotspot.confidence_class ?? EMPTY}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-surface-container-highest h-1.5 rounded-full mt-1 overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${selectedHotspot.confidence ?? 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="h-px bg-surface-container-highest"></div>

                    {/* Total FRP */}
                    <div className="flex justify-between items-baseline">
                      <div className="flex flex-col">
                        <span className="font-body-sm text-body-sm text-on-surface font-medium">Total FRP</span>
                        <span className="font-label-xs text-[10px] text-outline">Uncalibrated product value</span>
                      </div>
                      <span className="font-headline-sm text-headline-sm font-semibold text-primary">
                        {selectedHotspot.frp ?? EMPTY} <span className="font-label-xs text-label-xs text-on-surface">MW</span>
                      </span>
                    </div>

                    <div className="h-px bg-surface-container-highest"></div>

                    {/* Brightness temp */}
                    <div className="flex justify-between items-baseline">
                      <span className="font-body-sm text-body-sm text-on-surface">Brightness Temp</span>
                      <span className="font-label-sm text-label-sm font-semibold text-on-surface">
                        {selectedHotspot.brightness !== null ? `${selectedHotspot.brightness} K` : EMPTY}{' '}
                        {selectedHotspot.brightness !== null && (
                          <span className="text-outline font-normal">({(selectedHotspot.brightness - 273.15).toFixed(1)}°C)</span>
                        )}
                      </span>
                    </div>

                    {/* Land Cover Classification */}
                    <div className="flex flex-col pt-1">
                      <span className="font-label-xs text-label-xs text-outline uppercase">MODIS Land Cover (MCD12Q1)</span>
                      <span className="font-body-sm text-body-sm text-on-surface font-semibold">
                        {selectedHotspot.biome ?? 'Not in loaded product'}
                      </span>

                    </div>
                  </div>
                </div>

                {/* Telemetry Action Command Center */}
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={handleCopyCoordinates}
                    className="w-full py-2 px-space-md rounded bg-primary text-on-primary font-label-sm text-label-sm font-semibold hover:bg-primary-container transition-colors shadow-sm flex items-center justify-center gap-2 font-mono"
                  >
                    <span className="material-symbols-outlined text-[16px]">aspect_ratio</span>
                    <span>{copied ? 'Coordinates Copied' : 'Copy Coordinates'}</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <button
                      onClick={handleExportGeoJson}
                      className="py-1.5 px-space-sm rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-label-xs text-label-xs font-medium transition-colors flex items-center justify-center gap-1 shadow-sm border border-structural"
                    >
                      <span className="material-symbols-outlined text-[15px]">file_download</span>
                      <span>Export GeoJSON</span>
                    </button>
                    <button
                      onClick={() => navigate('/temporal-analysis')}
                      className="py-1.5 px-space-sm rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-label-xs text-label-xs font-medium transition-colors flex items-center justify-center gap-1 shadow-sm border border-structural"
                    >
                      <span className="material-symbols-outlined text-[15px]">show_chart</span>
                      <span>Temporal Curve</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Inspector Status Strip */}
              <div className="p-space-sm bg-surface-container-low text-on-surface-variant font-label-xs text-[10px] flex items-center justify-between border-t border-structural font-mono">
                <span className="uppercase">VERSION: {selectedHotspot.version ?? EMPTY}</span>
                <span className="text-secondary font-medium">{selectedHotspot.matched_cluster_id ? `CLUSTER: ${selectedHotspot.matched_cluster_id}` : 'NO CLUSTER'}</span>
              </div>
            </div>
          ) : (
            <div className="p-space-lg flex items-center justify-center h-full text-on-surface-variant font-mono text-label-sm">
              {noDataset ? (
                <EmptyState title={NO_DATASET} detail={AWAITING_NASA} icon="database_off" />
              ) : res.error ? (
                <ErrorState error={res.error} onRetry={res.reload} />
              ) : (
                'Select a hotspot on the map to inspect telemetry'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
