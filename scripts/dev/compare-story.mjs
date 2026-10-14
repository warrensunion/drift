// Side-by-side comp | build shot for each story section -> design-reference/compare/story/*.jpg
//   node scripts/dev/compare-story.mjs <shotsDir>
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const dir = process.argv[2];
const out = 'design-reference/compare/story';
await mkdir(out, { recursive: true });
const pairs = [
  ['comp-0-preloader', ['1440x900-0-preloader', '1440x900-0-intro']],
  ['comp-1-bottle', ['1440x900-1-mid', '1440x900-1to2-transition']],
  ['comp-2-breaks', ['1440x900-2-mid', '1440x900-2to3-transition']],
  ['comp-3-currents', ['1440x900-3-mid', '1440x900-3-late']],
  ['comp-4-gyre', ['1440x900-4-mid', '1440x900-3to4-transition']],
  ['comp-5-deep', ['1440x900-5-mid', '1440x900-4to5-transition']],
  ['comp-6-globe', ['1440x900-6-mid', '1440x900-5to6-transition']],
  ['comp-8-about', ['1440x900-8-about', '1440x900-8-about-model']],
];
const W = 720, H = 450, label = 28;
for (const [comp, shots] of pairs) {
  const imgs = [`design-reference/comps/${comp}.jpg`, ...shots.map((s) => `${dir}/${s}.jpg`)];
  const names = [`comp: ${comp}`, ...shots.map((s) => `build: ${s}`)];
  const tiles = [];
  for (const [i, f] of imgs.entries()) {
    tiles.push({ input: await sharp(f).resize(W, H, { fit: 'cover' }).toBuffer(), left: i * (W + 8), top: label });
    tiles.push({ input: Buffer.from(`<svg width="${W}" height="${label}"><text x="6" y="19" fill="#E6EEE9" font-size="15" font-family="Arial">${names[i]}</text></svg>`), left: i * (W + 8), top: 0 });
  }
  await sharp({ create: { width: imgs.length * (W + 8) - 8, height: H + label, channels: 3, background: '#0E2F36' } })
    .composite(tiles).jpeg({ quality: 82 }).toFile(`${out}/${comp.replace('comp-', '')}.jpg`);
  console.log(`${out}/${comp.replace('comp-', '')}.jpg`);
}
