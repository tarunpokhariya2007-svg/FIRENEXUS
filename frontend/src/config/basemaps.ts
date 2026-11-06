export type BasemapId = 'satellite' | 'streets' | 'hybrid';

export const BASEMAPS: Record<BasemapId, { label: string; mapId: string }> = {
  satellite: { label: 'Satellite', mapId: 'satellite-v4' },
  streets: { label: 'Streets', mapId: 'streets-v4' },
  hybrid: { label: 'Hybrid', mapId: 'hybrid-v4' },
};

export function getBasemapStyleUrl(basemap: BasemapId, apiKey: string): string {
  const mapId = BASEMAPS[basemap].mapId;
  return `https://api.maptiler.com/maps/${mapId}/style.json?key=${encodeURIComponent(apiKey)}`;
}
