import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Multi-page build: the site (index.html, Task 11) and the globe dev harness (globe.html).
// DRIFT_PAGES=globe.html builds a subset.
const root = fileURLToPath(new URL('.', import.meta.url));
const pages = (process.env.DRIFT_PAGES ? process.env.DRIFT_PAGES.split(',') : ['index.html', 'globe.html'])
  .filter((f) => existsSync(resolve(root, f)));

export default defineConfig({
  build: {
    target: 'es2022',
    // The globe chunk (three.js WebGPU build, ~960 kB) is lazy-loaded only near the globe section.
    chunkSizeWarningLimit: 1100,
    rollupOptions: { input: Object.fromEntries(pages.map((f) => [f.replace('.html', ''), resolve(root, f)])) },
  },
  // The simulation worker is an ES module worker (it imports onnxruntime-web).
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
