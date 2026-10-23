import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { bake, POSES } from '../src/models/dino.mjs';

test('dino: the worker bakes the same poses as bake(), wrapping around the loop', async () => {
  const w = new Worker(new URL('../src/models/dino-worker.mjs', import.meta.url)), got = [];
  try {
    await new Promise((resolve, reject) => {
      w.on('error', reject);
      w.on('message', m => { got.push(m); if (got.length === 2) resolve(); });
      w.postMessage({ job: 7, U: 6, from: POSES - 1 });
    });
    assert.deepEqual(got.map(m => m.f), [POSES - 1, 0]);
    for (const m of got) for (const k of ['grid', 'normal', 'depth', 'kind']) assert.deepEqual(m.sprite[k], bake(6, m.f)[k], k);
  } finally { await w.terminate(); }
});
