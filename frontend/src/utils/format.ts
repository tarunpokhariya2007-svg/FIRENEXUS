// Formatting helpers. A null/undefined value is rendered as an em dash, never as a number.
export const EMPTY = '—';

export const NO_DATASET = 'No dataset loaded';
export const AWAITING_NASA = 'Awaiting NASA dataset';

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined ? EMPTY : v.toLocaleString();
}

export function fmtNum(v: number | null | undefined, digits = 1, suffix = ''): string {
  return v === null || v === undefined ? EMPTY : `${v.toFixed(digits)}${suffix}`;
}

export function fmtPercent(v: number | null | undefined, digits = 1): string {
  return fmtNum(v, digits, '%');
}

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
}

export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;
}
