// public/model/drift.onnx in onnxruntime-web (Node, wasm backend) vs PyTorch outputs saved in
// tests/fixtures/onnx-ref.json by scripts/train/export.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web/wasm';
import { features } from '../src/sim/features.js';

const ref = JSON.parse(readFileSync(new URL('./fixtures/onnx-ref.json', import.meta.url), 'utf8'));
ort.env.wasm.numThreads = 1;
// One session shared by every test.
const session = await ort.InferenceSession.create(
  new Uint8Array(readFileSync(new URL('../public/model/drift.onnx', import.meta.url))), { executionProviders: ['wasm'] });

async function run(x, n) {
  const r = await session.run({ x: new ort.Tensor('float32', x, [n, 10]) });
  return { mu: r.mu.data, logSigma: r.log_sigma.data, dims: [r.mu.dims, r.log_sigma.dims] };
}

function check(out, label) {
  ref.rows.forEach((r, k) => {
    for (let j = 0; j < 2; j++) {
      assert.ok(Math.abs(out.mu[2 * k + j] - r.mu[j]) <= 1e-4, `${label} row ${k} mu[${j}]: ${out.mu[2 * k + j]} vs ${r.mu[j]}`);
      assert.ok(Math.abs(out.logSigma[2 * k + j] - r.log_sigma[j]) <= 1e-4, `${label} row ${k} log_sigma[${j}]: ${out.logSigma[2 * k + j]} vs ${r.log_sigma[j]}`);
    }
  });
}

test('onnxruntime-web matches PyTorch within 1e-4 on the 64 fixture rows (Python features)', async () => {
  const n = ref.rows.length;
  const x = new Float32Array(10 * n);
  ref.rows.forEach((r, k) => x.set(r.features, 10 * k));
  const out = await run(x, n);
  assert.deepEqual(out.dims, [[n, 2], [n, 2]]);
  check(out, 'python-features');
});

test('the same holds with features built in JS from the raw inputs', async () => {
  const n = ref.rows.length;
  const x = new Float32Array(10 * n);
  ref.rows.forEach((r, k) => features(r.lat, r.lon, r.u_cur, r.v_cur, r.u_wind, r.v_wind, r.doy, r.windage, x, 10 * k));
  check(await run(x, n), 'js-features');
});
