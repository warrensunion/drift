import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressFor, lerp, followK, sceneEdges, FOLLOW_PER_FRAME } from '../src/story/scroll.js';
import { cubicBezier, EASE, ease, easeInOutQuart } from '../src/story/ease.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Three scenes of 200 px each, starting at 100: edges are [100, 300, 500, 700].
const edges = [100, 300, 500, 700];

test('progressFor: before the first scene clamps to scene 0, t 0', () => {
  assert.deepEqual(progressFor(0, edges), { scene: 0, t: 0 });
  assert.deepEqual(progressFor(-50, edges), { scene: 0, t: 0 });
  assert.deepEqual(progressFor(100, edges), { scene: 0, t: 0 });
});

test('progressFor: inside a scene t runs 0..1 linearly', () => {
  assert.deepEqual(progressFor(200, edges), { scene: 0, t: 0.5 });
  assert.deepEqual(progressFor(350, edges), { scene: 1, t: 0.25 });
  const p = progressFor(699, edges);
  assert.equal(p.scene, 2);
  close(p.t, 199 / 200);
});

test('progressFor: a boundary belongs to the scene that starts there', () => {
  assert.deepEqual(progressFor(300, edges), { scene: 1, t: 0 });
  assert.deepEqual(progressFor(500, edges), { scene: 2, t: 0 });
  const before = progressFor(299.999, edges);
  assert.equal(before.scene, 0);
  assert.ok(before.t > 0.999 && before.t < 1);
});

test('progressFor: the last scene clamps to t 1 at and beyond its end', () => {
  assert.deepEqual(progressFor(700, edges), { scene: 2, t: 1 });
  assert.deepEqual(progressFor(10_000, edges), { scene: 2, t: 1 });
});

test('progressFor: uneven scene lengths and a single scene', () => {
  assert.deepEqual(progressFor(150, [0, 100, 400]), { scene: 1, t: 50 / 300 });
  assert.deepEqual(progressFor(30, [0, 60]), { scene: 0, t: 0.5 });
  assert.deepEqual(progressFor(90, [0, 60]), { scene: 0, t: 1 });
});

test('progressFor: rejects fewer than two edges', () => {
  assert.throws(() => progressFor(0, [0]));
});

test('sceneEdges: n scenes of a given length from an offset', () => {
  assert.deepEqual(sceneEdges(3, 200, 100), edges);
});

test('lerp: endpoints and midpoint', () => {
  assert.equal(lerp(2, 10, 0), 2);
  assert.equal(lerp(2, 10, 1), 10);
  assert.equal(lerp(2, 10, 0.5), 6);
});

test('followK: the measured makemepulse factor 0.04 per 60 Hz frame, dt-corrected', () => {
  assert.equal(FOLLOW_PER_FRAME, 0.04);
  close(followK(16.67), 0.04, 1e-12);
  // Two 60 Hz frames equal one 30 Hz frame.
  close(1 - (1 - followK(16.67)) ** 2, followK(33.34), 1e-12);
  // tau ~ 408 ms: after 283 ms of frames the gap has halved (t50 measured 283 ms).
  let x = 0;
  for (let t = 0; t < 283; t += 1000 / 60) x = lerp(x, 1, followK(1000 / 60));
  assert.ok(x > 0.46 && x < 0.54, `t50 ${x}`);
  assert.equal(followK(0), 0);
});

test('eases: the transition uses the exact symmetric quart, so 50 % time is 50 % travel', () => {
  assert.equal(ease.scene, easeInOutQuart);
  close(ease.scene(0.5), 0.5, 1e-12);
  close(ease.scene(0.25) + ease.scene(0.75), 1, 1e-12);
  // The CSS bezier approximation stays within 0.1 of the quart everywhere.
  const css = cubicBezier(...EASE.scene);
  for (let x = 0; x <= 1; x += 0.05) assert.ok(Math.abs(css(x) - easeInOutQuart(x)) < 0.1, String(x));
});

test('cubicBezier: endpoints and the settle ease shape', () => {
  const scene = cubicBezier(...EASE.scene);
  close(scene(0), 0, 1e-6);
  close(scene(1), 1, 1e-6);
  const settle = cubicBezier(...EASE.settle);
  // NOTES.md: their CustomEase is 0.644 / 0.869 / 0.972 at x = 0.1 / 0.25 / 0.5 (fit error <= 0.007).
  close(settle(0.1), 0.644, 0.02);
  close(settle(0.25), 0.869, 0.02);
  close(settle(0.5), 0.972, 0.02);
});
