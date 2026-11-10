import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Data Laboratory distinguishes job failure from per-chunk errors', () => {
  const page = source('../src/pages/DataLaboratory.tsx');
  assert.match(page, /job\.status === 'failed' && job\.message/);
  assert.match(page, /Job failure:/);
  assert.match(page, /Chunk error: \$\{chunk\.error\}/);
});

test('Resume uses POST against the existing acquisition job id', () => {
  const client = source('../src/services/api.ts');
  assert.match(client, /resumeAcquisition:\s*\(jobId: string\)\s*=>\s*request<AcquisitionJob>\(`\/acquisitions\/\$\{encodeURIComponent\(jobId\)\}\/resume`,\s*\{ method: 'POST' \}\)/);
});
