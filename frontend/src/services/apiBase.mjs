/** Resolve the backend origin to exactly one `/api` path prefix. */
export function normalizeApiBase(configuredUrl, fallbackUrl = '') {
  const configured = typeof configuredUrl === 'string' ? configuredUrl.trim() : '';
  const fallback = typeof fallbackUrl === 'string' ? fallbackUrl.trim() : '';
  const selected = configured || fallback;
  const withoutTrailingSlashes = selected.replace(/\/+$/, '');
  const withoutApiSuffix = withoutTrailingSlashes.replace(/\/api$/i, '');
  return `${withoutApiSuffix}/api`;
}
