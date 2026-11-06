import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { FireObservation } from '../../types/firenexus';

interface MapLibreCanvasProps {
  hotspots: FireObservation[];
  selectedHotspot: FireObservation | null;
  onSelectHotspot: (hotspot: FireObservation) => void;
  showModis?: boolean;
  showViirs?: boolean;
  showHarmonized?: boolean;
  center?: [number, number]; // [lon, lat]
  zoom?: number;
  interactive?: boolean;
  heightClass?: string;
  /** Shown over the map when there are no observations to draw. */
  emptyMessage?: { title: string; detail: string };
}

export const MapLibreCanvas: React.FC<MapLibreCanvasProps> = ({
  hotspots,
  selectedHotspot,
  onSelectHotspot,
  showModis = true,
  showViirs = true,
  showHarmonized = true,
  center = [0, 10], // neutral world view until an AOI or dataset defines one
  zoom = 1.6,
  interactive = true,
  heightClass = 'h-full min-h-[500px]',
  emptyMessage,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [cursorPos, setCursorPos] = useState<{ lat: number; lon: number } | null>(null);
  const [centerLat, setCenterLat] = useState<number>(center[1]);
  const [currentZoom, setCurrentZoom] = useState(zoom);

  useEffect(() => {
    if (!mapContainer.current) return;

    // Initialize MapLibre map with CartoDb Positron or Esri Satellite fallback style
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: '&copy; CartoDB & OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: center,
      zoom: zoom,
      interactive: interactive,
      attributionControl: false,
    });

    map.on('mousemove', (e) => {
      setCursorPos({
        lat: Number(e.lngLat.lat.toFixed(4)),
        lon: Number(e.lngLat.lng.toFixed(4)),
      });
    });

    map.on('zoom', () => {
      setCurrentZoom(Number(map.getZoom().toFixed(2)));
    });
    map.on('move', () => {
      setCenterLat(map.getCenter().lat);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Markers when hotspots or visibility toggles change
  useEffect(() => {
    if (!mapRef.current) return;

    // Remove existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const visibleHotspots = hotspots.filter((h) => {
      if (h.source === 'MODIS' && !showModis) return false;
      if (h.source === 'VIIRS' && !showViirs) return false;
      if (h.harmonization_status === 'harmonized_match' && !showHarmonized) return false;
      return true;
    });

    visibleHotspots.forEach((h) => {
      const isSelected = selectedHotspot?.id === h.id;
      const el = document.createElement('div');
      el.className = 'cursor-pointer transition-transform hover:scale-125';

      if (h.source === 'MODIS') {
        el.innerHTML = `
          <div class="relative ${isSelected ? 'scale-125' : ''}">
            <div style="width: 24px; height: 24px; border: 1.5px solid #487D9A; background-color: rgba(72,125,154,0.3); display: flex; align-items: center; justify-content: center;">
              <span style="width: 4px; height: 4px; background-color: #487D9A;"></span>
            </div>
            ${
              isSelected
                ? `<div style="position: absolute; inset: -4px; border: 2px dashed #9e3d19; animation: pulse 2s infinite;"></div>`
                : ''
            }
          </div>
        `;
      } else {
        // VIIRS diamond marker
        const isExtreme = (h.frp ?? 0) > 100;
        const color = isExtreme ? '#9D342B' : '#D18445';
        el.innerHTML = `
          <div class="relative ${isSelected ? 'scale-125' : ''}">
            <div style="width: 14px; height: 14px; transform: rotate(45deg); border: 1px solid #ffffff; background-color: ${color}; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
            </div>
            ${
              isSelected
                ? `<div style="position: absolute; inset: -6px; border: 2px solid #9e3d19; border-radius: 9999px; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`
                : ''
            }
          </div>
        `;
      }

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectHotspot(h);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([h.longitude, h.latitude])
        .addTo(mapRef.current!);

      markersRef.current.push(marker);
    });
  }, [hotspots, showModis, showViirs, showHarmonized, selectedHotspot]);

  // Center on selected hotspot if changed
  useEffect(() => {
    if (selectedHotspot && mapRef.current) {
      mapRef.current.easeTo({
        center: [selectedHotspot.longitude, selectedHotspot.latitude],
        zoom: Math.max(mapRef.current.getZoom(), 8.5),
        duration: 800,
      });
    }
  }, [selectedHotspot?.id]);

  // Real scale: metres per pixel at the current latitude/zoom, rounded to a 1-2-5 distance for a 96px bar.
  const scale = (() => {
    const mPerPx = (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, currentZoom);
    const raw = mPerPx * 96;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map((n) => n * pow).filter((v) => v <= raw).pop() ?? pow;
    const km = nice / 1000;
    const fmt = (v: number) => (v >= 1 ? `${Math.round(v * 10) / 10}` : `${Math.round(v * 1000)} m`);
    return { label: fmt(km / 2), fullLabel: km >= 1 ? `${Math.round(km * 10) / 10} km` : `${Math.round(nice)} m` };
  })();

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();
  const handleReset = () => {
    mapRef.current?.easeTo({ center, zoom });
  };

  return (
    <div className={`relative w-full ${heightClass} bg-surface-dim overflow-hidden select-none`}>
      {/* MapLibre DOM node */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* Graticule Overlay Lines (SVG) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none stroke-on-surface/15 text-on-surface-variant font-label-xs" fill="none">
        <line strokeDasharray="3 3" strokeWidth="1" x1="25%" x2="25%" y1="0" y2="100%" />
        <line strokeDasharray="3 3" strokeWidth="1" x1="50%" x2="50%" y1="0" y2="100%" />
        <line strokeDasharray="3 3" strokeWidth="1" x1="75%" x2="75%" y1="0" y2="100%" />
        <line strokeDasharray="3 3" strokeWidth="1" x1="0" x2="100%" y1="25%" y2="25%" />
        <line strokeDasharray="3 3" strokeWidth="1" x1="0" x2="100%" y1="50%" y2="50%" />
        <line strokeDasharray="3 3" strokeWidth="1" x1="0" x2="100%" y1="75%" y2="75%" />
      </svg>

      {/* Empty state overlay */}
      {emptyMessage && hotspots.length === 0 && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <div className="bg-surface-container-lowest/95 backdrop-blur-sm px-space-lg py-space-md rounded border border-surface-container-highest shadow-sm flex flex-col items-center gap-1 text-center font-mono">
            <span className="material-symbols-outlined text-[24px] text-outline">database_off</span>
            <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface">{emptyMessage.title}</span>
            <span className="font-label-xs text-label-xs text-on-surface-variant">{emptyMessage.detail}</span>
          </div>
        </div>
      )}

      {/* Floating Left GIS Tool Dock */}
      {interactive && (
        <div className="absolute top-space-md left-space-md flex flex-col bg-surface-container-lowest/95 backdrop-blur-sm rounded shadow-sm overflow-hidden z-10 border border-surface-container-highest">
          <button
            onClick={handleZoomIn}
            className="w-8 h-8 flex items-center justify-center text-on-surface hover:bg-surface-container transition-colors"
            title="Zoom In"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </button>
          <div className="w-full h-px bg-surface-container-highest" />
          <button
            onClick={handleZoomOut}
            className="w-8 h-8 flex items-center justify-center text-on-surface hover:bg-surface-container transition-colors"
            title="Zoom Out"
          >
            <span className="material-symbols-outlined text-[18px]">remove</span>
          </button>
          <div className="w-full h-px bg-surface-container-highest" />
          <button
            onClick={handleReset}
            className="w-8 h-8 flex items-center justify-center text-on-surface hover:bg-surface-container transition-colors"
            title="Recenter AOI"
          >
            <span className="material-symbols-outlined text-[18px]">filter_center_focus</span>
          </button>
        </div>
      )}

      {/* Floating Top Right HUD Cursor Card */}
      <div className="absolute top-space-md right-space-md bg-surface-container-lowest/95 backdrop-blur-sm p-space-sm rounded shadow-sm flex flex-col gap-1 w-64 select-none z-10 border border-surface-container-highest font-mono">
        <div className="flex items-center justify-between text-on-surface">
          <span className="font-label-xs text-[11px] font-semibold uppercase tracking-wider">Inspection HUD</span>
          <span className="font-label-xs text-[9px] px-1 py-0.2 bg-secondary-fixed text-on-secondary-fixed-variant rounded font-semibold">
            EPSG:4326
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 text-[10px] font-label-xs text-on-surface-variant mt-1">
          <span>Lat: <strong className="text-on-surface font-medium">{cursorPos ? `${cursorPos.lat}°` : '—'}</strong></span>
          <span>Lon: <strong className="text-on-surface font-medium">{cursorPos ? `${cursorPos.lon}°` : '—'}</strong></span>
          <span>Zoom: <strong className="text-on-surface font-medium">{currentZoom}x</strong></span>
          <span>Active Obs: <strong className="text-primary font-medium">{hotspots.length}</strong></span>
        </div>
        {selectedHotspot && (
          <div className="text-[10px] text-on-surface-variant border-t border-surface-container-highest pt-1 mt-0.5 flex flex-col">
            <span className="text-primary font-semibold">{selectedHotspot.id}</span>
            <span>FRP: {selectedHotspot.frp ?? '—'} MW • Conf: {selectedHotspot.confidence ?? '—'}%</span>
          </div>
        )}
      </div>

      {/* Floating Bottom Left Scale & Ramp */}
      <div className="absolute bottom-space-md left-space-md bg-surface-container-lowest/95 backdrop-blur-sm px-space-sm py-1.5 rounded shadow-sm flex items-center gap-space-md select-none z-10 border border-surface-container-highest">
        {/* Scale bar */}
        <div className="flex flex-col gap-0.5">
          <div className="flex justify-between font-label-xs text-[9px] text-on-surface-variant font-mono">
            <span>0</span>
            <span>{scale.label}</span>
            <span>{scale.fullLabel}</span>
          </div>
          <div className="flex h-1.5 w-24 border border-on-surface/40">
            <div className="w-1/2 bg-on-surface" />
            <div className="w-1/2 bg-surface-container-lowest" />
          </div>
        </div>
        <div className="h-6 w-px bg-surface-container-highest" />
        {/* Heatmap Ramp */}
        <div className="flex flex-col gap-0.5">
          <span className="font-label-xs text-[9px] uppercase tracking-wider text-on-surface-variant">Detection density</span>
          <div className="flex items-center gap-1">
            <div className="w-16 h-2 rounded-xs bg-gradient-to-r from-[#ebefea] via-[#be542f] to-[#ba1a1a]" />
            <span className="font-label-xs text-[9px] text-on-surface font-mono">low → high</span>
          </div>
        </div>
      </div>

      {/* Floating Bottom Right Projection Tag */}
      <div className="absolute bottom-space-md right-space-md bg-surface-container-lowest/95 backdrop-blur-sm px-space-sm py-1 rounded shadow-sm text-on-surface-variant font-label-xs text-[10px] select-none z-10 border border-surface-container-highest font-mono">
        MODIS • VIIRS • WGS 84
      </div>
    </div>
  );
};
