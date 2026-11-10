import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { matchRoutes } from 'react-router-dom';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the /app entry redirects to the existing dashboard route', () => {
  const app = source('../src/App.tsx');
  assert.match(app, /<Route path="\/app" element=\{<Navigate to="\/app\/overview" replace \/>\} \/>/);
  assert.match(app, /<Route path="\/app\/overview" element=\{<Overview \/>\} \/>/);

  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(([, path]) => ({ path }));
  assert.equal(matchRoutes(routes, '/app')?.at(-1)?.route.path, '/app');
  assert.equal(matchRoutes(routes, '/app/overview')?.at(-1)?.route.path, '/app/overview');
});

test('all existing nested application routes remain routable', () => {
  const app = source('../src/App.tsx');
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(([, path]) => ({ path }));
  for (const path of [
    '/app/data-laboratory',
    '/app/fire-explorer',
    '/app/harmonization-studio',
    '/app/activity-calendar',
    '/app/temporal-analysis',
    '/app/sensor-comparison',
    '/app/reports',
  ]) {
    assert.equal(matchRoutes(routes, path)?.at(-1)?.route.path, path, `${path} should resolve`);
  }
});

test('Vercel serves the SPA entry point for direct navigation and refreshes', () => {
  const config = JSON.parse(source('../vercel.json'));
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/index.html' }]);
});
