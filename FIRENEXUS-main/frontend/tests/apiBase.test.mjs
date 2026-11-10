import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeApiBase } from '../src/services/apiBase.mjs';

test('uses same-origin API path when no backend origin is configured', () => {
  assert.equal(normalizeApiBase(), '/api');
  assert.equal(normalizeApiBase('  '), '/api');
});

test('uses the deployed backend as the production fallback when VITE_API_URL is absent', () => {
  assert.equal(
    normalizeApiBase(undefined, 'https://firenexus-api-3izj.onrender.com'),
    'https://firenexus-api-3izj.onrender.com/api',
  );
});

test('adds the API prefix to a backend origin', () => {
  assert.equal(normalizeApiBase('https://firenexus-api-3izj.onrender.com'), 'https://firenexus-api-3izj.onrender.com/api');
});

test('normalizes trailing slashes and an already-present API suffix', () => {
  assert.equal(normalizeApiBase('https://api.example.test/'), 'https://api.example.test/api');
  assert.equal(normalizeApiBase('https://api.example.test/api/'), 'https://api.example.test/api');
  assert.equal(normalizeApiBase('https://api.example.test/API'), 'https://api.example.test/api');
});

test('prefers VITE_API_URL over the production fallback', () => {
  assert.equal(
    normalizeApiBase('https://custom-api.example.test/api/', 'https://firenexus-api-3izj.onrender.com'),
    'https://custom-api.example.test/api',
  );
});
