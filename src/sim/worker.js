// Drift simulation worker (module worker). Integration glue around ensemble.js: loads tiles and
// the ONNX model, steps drops to 3650 days as fast as possible, and posts snapshots.
// No DOM APIs: only fetch, MessageChannel/setTimeout, performance/Date and postMessage.
//
// In:  {type:'init', currentUrls: string[12], windUrl, modelUrl, wasmPaths?}
//      {type:'drop', item, lon, lat, startDoy, seed}
//      {type:'clear'}
//      {type:'mode', mode:'global'|'salish'}            (salish stepping is Task 9)
// Out: {type:'status', fallback:true, reason}           model fetch/load or inference failed -> advection
//      {type:'ready', fallback:boolean}                 after init
//      {type:'error', stage:'init'|'drop'|'step', reason}
//      {type:'dropped', dropId, item, lon, lat, startDoy, seed}
//      {type:'snapshot', dropId, index, day, positions:Int16Array, meta:Uint8Array, fragments, usingFallback}
//                                                       buffers transferred; packing in snapshots.js
//      {type:'progress', dropId, day}                   newest drop's computed day, <= ~10/s, and at the end
//      {type:'done', dropId}                            a drop reached 3650 days
//      {type:'cleared'}
//      {type:'status', mode}
import * as ort from 'onnxruntime-web';
import { features } from './features.js';
import { decodeTile } from './field.js';
import { makeRng } from './fragment.js';
import { createSim, MAX_DAYS } from './ensemble.js';
import { snapshotDays, packSnapshot } from './snapshots.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Yield to the event loop (a macrotask) so queued messages such as 'clear' are handled. */
function yieldToEvents() {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });
}

/**
 * The worker's state machine, with its I/O injected so it can run outside a worker.
 * post(msg, transfer?) sends a message; deps: {fetchFn, ortLib, featuresFn}.
 */
export function createWorkerCore(post, { fetchFn = (u) => fetch(u), ortLib = ort, featuresFn = features } = {}) {
  const days = snapshotDays();
  const snapIndex = new Map(days.map((d, i) => [d, i]));
  let fields = null, predict = null, sim = null, mode = 'global';
  let inner = makeRng(0);
  const rng = () => inner(); // re-seeded on every drop
  let gen = 0, loopGen = -1;

  const fetchBuf = async (url) => {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  };

  const newSim = () => createSim({ fields, predict, rng, featuresFn });

  function fallBack(reason) {
    predict = null;
    if (sim) sim.setPredict(null);
    post({ type: 'status', fallback: true, reason: String(reason) });
  }

  async function loadModel(modelUrl, wasmPaths) {
    ortLib.env.wasm.numThreads = 1;
    if (wasmPaths) ortLib.env.wasm.wasmPaths = wasmPaths;
    const buf = await fetchBuf(modelUrl);
    const session = await ortLib.InferenceSession.create(new Uint8Array(buf), { executionProviders: ['wasm'] });
    return async (x, n) => {
      const r = await session.run({ x: new ortLib.Tensor('float32', x, [n, 10]) });
      return { mu: r.mu.data, logSigma: r.log_sigma.data };
    };
  }

  async function init({ currentUrls, windUrl, modelUrl, wasmPaths }) {
    try {
      if (!Array.isArray(currentUrls) || currentUrls.length !== 12) throw new Error('init: currentUrls must list 12 monthly tiles');
      const [cur, wind] = await Promise.all([Promise.all(currentUrls.map(fetchBuf)), fetchBuf(windUrl)]);
      fields = { current: cur.map(decodeTile), wind: decodeTile(wind) };
    } catch (e) {
      post({ type: 'error', stage: 'init', reason: String(e && e.message || e) });
      return;
    }
    try {
      predict = await loadModel(modelUrl, wasmPaths);
    } catch (e) {
      fallBack(`model unavailable: ${e && e.message || e}`);
    }
    gen++;
    sim = newSim();
    post({ type: 'ready', fallback: !predict });
  }

  function postSnapshot(s, dropId, day) {
    const snap = packSnapshot(s, dropId);
    post({
      type: 'snapshot', dropId, index: snapIndex.get(day), day,
      positions: snap.positions, meta: snap.meta, fragments: snap.fragments, usingFallback: s.usingFallback,
    }, [snap.positions.buffer, snap.meta.buffer]);
  }

  async function run() {
    if (loopGen === gen) return; // a loop for this generation is already running
    const g = gen, s = sim;
    loopGen = g;
    let lastYield = now(), lastProgress = 0;
    try {
      while (g === gen && s.isActive()) {
        try {
          await s.step();
        } catch (e) {
          if (s.usingFallback) throw e;
          fallBack(`inference failed: ${e && e.message || e}`); // retry the day with advection
          continue;
        }
        if (g !== gen) break;
        let newest = -1;
        for (const d of s.drops.values()) {
          newest = d.id;
          const age = s.day - d.bornDay;
          if (age > MAX_DAYS) continue;
          if (snapIndex.has(age)) postSnapshot(s, d.id, age);
          if (age === MAX_DAYS) post({ type: 'done', dropId: d.id });
        }
        const t = now();
        if (t - lastProgress >= 100 && newest >= 0) { post({ type: 'progress', dropId: newest, day: s.ageOf(newest) }); lastProgress = t; }
        if (t - lastYield >= 16) { await yieldToEvents(); lastYield = now(); }
      }
      if (g === gen) {
        let newest = -1;
        for (const d of s.drops.values()) newest = d.id;
        if (newest >= 0) post({ type: 'progress', dropId: newest, day: s.ageOf(newest) });
      }
    } catch (e) {
      if (g === gen) post({ type: 'error', stage: 'step', reason: String(e && e.message || e) });
    } finally {
      if (loopGen === g) loopGen = -1;
    }
  }

  function drop({ item, lon, lat, startDoy = 1, seed = 1 }) {
    if (!sim) { post({ type: 'error', stage: 'drop', reason: 'not initialised' }); return; }
    try {
      inner = makeRng(seed >>> 0);
      const dropId = sim.drop(item, lon, lat, startDoy);
      post({ type: 'dropped', dropId, item, lon, lat, startDoy, seed });
      postSnapshot(sim, dropId, 0);
      run();
    } catch (e) {
      post({ type: 'error', stage: 'drop', reason: String(e && e.message || e) });
    }
  }

  function clear() {
    gen++;
    if (fields) sim = newSim();
    post({ type: 'cleared' });
  }

  function handle(msg) {
    switch (msg && msg.type) {
      case 'init': return init(msg);
      case 'drop': return drop(msg);
      case 'clear': return clear();
      case 'mode':
        mode = msg.mode === 'salish' ? 'salish' : 'global';
        post({ type: 'status', mode });
        return;
      default:
        post({ type: 'error', stage: 'message', reason: `unknown message type ${msg && msg.type}` });
    }
  }

  return { handle, get sim() { return sim; }, get mode() { return mode; } };
}

// Bind only inside a real worker (WorkerGlobalScope exists); importing in Node does nothing.
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined') {
  const core = createWorkerCore((msg, transfer) => self.postMessage(msg, transfer || []));
  self.onmessage = (ev) => { core.handle(ev.data); };
}
