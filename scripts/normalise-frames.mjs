#!/usr/bin/env node
// normalise-frames: delivered stills + frame sequences → public/stills and public/shots.
//
//   source-assets/Frames Container/Shot 01 — K0 → A1/Shot 01 K0 → A1 — 7.jpg
//     → public/shots/shot-01/desktop/0007.avif + .jpg (1920×1080)
//   source-assets/Base Images/Image · A1 · Park ¾ · Night.png
//     → public/stills/a1.avif + .jpg
//   K0 (overview) still → frame 1 of shot 01, or a file passed with --k0=<path>
//
// Options: --force (re-encode everything), --only=shot-03 (one shot), --k0=<file>
// Unchanged sources are skipped, so re-running after one regenerated shot is fast.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SRC_FRAMES, SRC_STILLS, PUBLIC, ENCODE, VIEW_IDS, BuildError,
  listVisible, encodeImage, imageSize, pool, pad, writeJson, log, warn, runMain,
} from './lib/shared.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const FORCE = Boolean(args.force);
const CONCURRENCY = 6;

/** "Shot 02 — K0 → B1 " (note the trailing space as delivered) → { id, from, to } */
function parseShotFolder(name) {
  const m = /^Shot\s+(\d+)\s*[—-]\s*(K0|[AB][123])\s*→\s*(K0|[AB][123])\s*$/u.exec(name);
  if (!m) return null;
  return { num: Number(m[1]), id: `shot-${pad(m[1])}`, from: m[2], to: m[3] };
}

/** "Shot 01 K0 → A1 — 12.jpg" → 12 */
function frameNumber(file) {
  const m = /(\d+)\.jpe?g$/i.exec(file);
  return m ? Number(m[1]) : NaN;
}

async function normaliseShots() {
  const folders = (await listVisible(SRC_FRAMES)).filter((e) => e.isDirectory());
  const shots = [];
  for (const dir of folders) {
    const shot = parseShotFolder(dir.name);
    if (!shot) { warn(`Skipping unrecognised folder "${dir.name}"`); continue; }
    if (args.only && args.only !== shot.id) continue;

    const srcDir = path.join(SRC_FRAMES, dir.name);
    const files = (await listVisible(srcDir))
      .filter((e) => e.isFile() && /\.jpe?g$/i.test(e.name))
      .map((e) => ({ name: e.name, n: frameNumber(e.name) }))
      .sort((a, b) => a.n - b.n);

    // Frame numbers must be a gap-free 1…N run, otherwise playback would jump.
    files.forEach((f, i) => {
      if (f.n !== i + 1) throw new BuildError(`${shot.id}: expected frame ${i + 1}, found "${f.name}"`);
    });

    const first = path.join(srcDir, files[0].name);
    const source = await imageSize(first);
    const outDir = path.join(PUBLIC, 'shots', shot.id, 'desktop');

    let written = 0;
    await pool(files, CONCURRENCY, async (f, i) => {
      const wrote = await encodeImage(path.join(srcDir, f.name), path.join(outDir, pad(i + 1, 4)), ENCODE.frame, 1920, FORCE);
      if (wrote) written++;
    });

    // Drop stale frames if a shot was regenerated with fewer frames.
    for (const e of await listVisible(outDir)) {
      const n = Number(e.name.slice(0, 4));
      if (n > files.length) await fs.rm(path.join(outDir, e.name));
    }

    const info = {
      id: shot.id, from: shot.from, to: shot.to, frames: files.length,
      source: { folder: dir.name, width: source.width, height: source.height },
    };
    await writeJson(path.join(PUBLIC, 'shots', shot.id, 'shot.json'), info);
    shots.push(info);
    log(`  ${shot.id} ${shot.from}→${shot.to}: ${files.length} frames from ${source.width}×${source.height}` +
      `${source.width !== 1920 ? ' (scaled to 1920×1080)' : ''}, ${written} encoded`);
  }
  return shots;
}

async function normaliseStills() {
  const files = (await listVisible(SRC_STILLS)).filter((e) => e.isFile() && /\.png$/i.test(e.name));
  const stills = [];
  for (const f of files) {
    // "Image · A1 · Park ¾ · Night.png"
    const m = /·\s*([AB][123])\s*·\s*(.+?)\s*·\s*(\w+)\.png$/u.exec(f.name);
    if (!m) { warn(`Skipping unrecognised still "${f.name}"`); continue; }
    const [, view, name, light] = m;
    const src = path.join(SRC_STILLS, f.name);
    const size = await imageSize(src);
    if (size.width !== 1920 || size.height !== 1080) {
      throw new BuildError(`${f.name} is ${size.width}×${size.height}, expected 1920×1080 (overlays are drawn on that grid)`);
    }
    await encodeImage(src, path.join(PUBLIC, 'stills', view.toLowerCase()), ENCODE.still, 1920, FORCE);
    stills.push({ view, name, light, source: f.name });
    log(`  still ${view} · ${name}`);
  }
  const missing = VIEW_IDS.filter((v) => !stills.some((s) => s.view === v));
  if (missing.length) throw new BuildError(`Missing stills for ${missing.join(', ')}`);
  return stills;
}

/** K0 has no delivered still: use frame 1 of shot 01 unless --k0 points at the final FRONT image. */
async function normaliseK0() {
  let src = typeof args.k0 === 'string' ? path.resolve(args.k0) : null;
  if (!src) {
    const folder = (await listVisible(SRC_FRAMES)).find((e) => parseShotFolder(e.name)?.id === 'shot-01');
    if (!folder) throw new BuildError('No K0 still: shot 01 is missing and --k0 was not given');
    const dir = path.join(SRC_FRAMES, folder.name);
    const first = (await listVisible(dir)).find((e) => frameNumber(e.name) === 1);
    src = path.join(dir, first.name);
  }
  await encodeImage(src, path.join(PUBLIC, 'stills', 'k0'), ENCODE.still, 1920, FORCE);
  log(`  still K0 from ${path.basename(src)}`);
  return { view: 'K0', name: 'Overview', light: 'Dusk', source: path.basename(src) };
}

runMain('normalise-frames', async () => {
  log('Stills');
  const stills = [await normaliseK0(), ...(await normaliseStills())];
  await writeJson(path.join(PUBLIC, 'stills', 'stills.json'), stills);
  log('Shots');
  await normaliseShots();
});
