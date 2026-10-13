// Drift simulation worker (module worker). Integration glue around ensemble.js: loads tiles and
// the ONNX model, steps every drop on its own timeline to 3650 days as fast as possible, and
// posts snapshots. No DOM APIs: only fetch, MessageChannel/setTimeout, performance/Date and postMessage.
//
// In:  {type:'init', currentUrls: string[12], windUrl, modelUrl, wasmPaths?}
//      {type:'drop', item, lon, lat, startDoy, seed}
//      {type:'clear'}
//      {type:'mode', mode:'global'|'salish'}            (salish stepping is Task 9)
// Out: {type:'status', fallback:true, reason}           model fetch/load or inference failed -> advection
//      {type:'ready', fallback:boolean}                 after init
//      {type:'error', stage:'init'|'drop'|'clear'|'step'|'message', reason}
//      {type:'dropped', dropId, item, lon, lat, startDoy, seed}
//      {type:'snapshot', dropId, index, day, positions:Int16Array, meta:Uint8Array, fragments, usingFallback}
//          day = days since THAT drop (its own clock), index = snapshotDays().indexOf(day);
//          buffers transferred; packing in snapshots.js
//      {type:'progress', dropId, day}                   per stepped drop, <= ~10/s each, and when the loop idles
//      {type:'done', dropId}                            the drop reached 3650 days
//      {type:'retired', dropId}                         the member budget retired the drop
//      {type:'cleared'}
//      {type:'status', mode}
//
// Scheduling: 'drop' and 'clear' are queued and applied only between steps (never while a step
// awaits the model). Drops are stepped round-robin, newest first, one day per drop per turn;
// the loop yields a macrotask every ~16 ms so new messages are handled.
import * as ort from 'onnxruntime-web';
import { features } from './features.js';
import { decodeTile } from './field.js';
import { createSim, MAX_DAYS } from './ensemble.js';
import { snapshotDays, packSnapshot } from './snapshots.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const errText = (e) => String((e && e.message) || e);

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
  const ops = []; // queued 'drop' / 'clear' messages, applied between steps
  let looping = false;

  const fetchBuf = async (url) => {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  };

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
      post({ type: 'error', stage: 'init', reason: errText(e) });
      return;
    }
    try {
      predict = await loadModel(modelUrl, wasmPaths);
    } catch (e) {
      fallBack(`model unavailable: ${errText(e)}`);
    }
    sim = createSim({ fields, predict, featuresFn, onRetire: (dropId) => post({ type: 'retired', dropId }) });
    post({ type: 'ready', fallback: !predict });
    kick();
  }

  function postSnapshot(dropId) {
    const day = sim.ageOf(dropId);
    if (!snapIndex.has(day)) return;
    const snap = packSnapshot(sim, dropId);
    post({
      type: 'snapshot', dropId, index: snapIndex.get(day), day,
      positions: snap.positions, meta: snap.meta, fragments: snap.fragments, usingFallback: sim.usingFallback,
    }, [snap.positions.buffer, snap.meta.buffer]);
  }

  /** Apply queued 'drop' / 'clear' messages. Only called between steps. */
  function applyOps() {
    while (ops.length) {
      const msg = ops.shift();
      if (msg.type === 'clear') { sim.clear(); post({ type: 'cleared' }); continue; }
      try {
        const { item, lon, lat, startDoy = 1, seed = 1 } = msg;
        const dropId = sim.drop(item, lon, lat, startDoy, seed >>> 0);
        post({ type: 'dropped', dropId, item, lon, lat, startDoy, seed });
        postSnapshot(dropId); // day 0
      } catch (e) {
        post({ type: 'error', stage: 'drop', reason: errText(e) });
      }
    }
  }

  function kick() {
    if (sim && !looping) loop();
  }

  async function loop() {
    looping = true;
    const lastProgress = new Map();
    let lastYield = now();
    try {
      for (;;) {
        applyOps();
        const turn = sim.activeDrops(); // newest first
        if (!turn.length) break;
        for (const dropId of turn) {
          applyOps(); // a 'clear' or a budget retirement may have removed this drop
          if (!sim.drops.has(dropId) || sim.ageOf(dropId) >= MAX_DAYS) continue;
          try {
            await sim.stepDrop(dropId);
          } catch (e) {
            if (sim.usingFallback) throw e;
            fallBack(`inference failed: ${errText(e)}`); // predict runs before any mutation: retry with advection
            continue;
          }
          if (!sim.drops.has(dropId)) continue;
          const day = sim.ageOf(dropId);
          postSnapshot(dropId);
          if (day >= MAX_DAYS) post({ type: 'done', dropId });
          const t = now();
          if (t - (lastProgress.get(dropId) ?? -Infinity) >= 100) { post({ type: 'progress', dropId, day }); lastProgress.set(dropId, t); }
          if (t - lastYield >= 16) { await yieldToEvents(); lastYield = now(); }
        }
      }
      for (const d of sim.drops.values()) post({ type: 'progress', dropId: d.id, day: d.day });
    } catch (e) {
      post({ type: 'error', stage: 'step', reason: errText(e) });
    } finally {
      looping = false;
    }
    if (ops.length) kick();
  }

  function handle(msg) {
    switch (msg && msg.type) {
      case 'init': return init(msg);
      case 'drop':
      case 'clear':
        if (!sim) { post({ type: 'error', stage: msg.type, reason: 'not initialised' }); return; }
        ops.push(msg);
        kick();
        return;
      case 'mode':
        mode = msg.mode === 'salish' ? 'salish' : 'global';
        post({ type: 'status', mode });
        return;
      default:
        post({ type: 'error', stage: 'message', reason: `unknown message type ${msg && msg.type}` });
    }
  }

  return { handle, get sim() { return sim; }, get mode() { return mode; }, get busy() { return looping; } };
}

// Bind only inside a real worker (WorkerGlobalScope exists); importing in Node does nothing.
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined') {
  const core = createWorkerCore((msg, transfer) => self.postMessage(msg, transfer || []));
  self.onmessage = (ev) => { core.handle(ev.data); };
}
