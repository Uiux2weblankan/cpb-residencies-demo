#!/usr/bin/env node
// build-manifest: public/manifest.json — every view's still and overlay, every
// shot's start/end views, frame count and size. The viewer reads only this file
// to know what exists, so a regenerated asset is picked up by re-running the scripts.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PUBLIC, CACHE, VIEW_IDS, BuildError, listVisible, readJson, writeJson, imageSize, log, runMain,
} from './lib/shared.mjs';

// Bump when assets change so CDN caches never mix old and new frames (v1/, v2/ …).
const ASSET_VERSION = 'v1';

// K0 overview (Figma: _Residences Animation › Residencies Check Image Container,
// states Default / Left / Right), mapped onto the K0 still's 1920×1080 grid.
//  • window   rounded silhouette (radius 20) cut out of the green veil on hover;
//             also the hover / click area. Traced on the K0 still.
//  • roof     tight tower outline: keeps the towers out of the dark sky gradient.
//  • label    "Tower A/B" pill, level with the tower's middle (Figma y 560–620).
//             side 'left' = anchored by its right edge, 'right' = by its left edge.
//  • card     Hover Tower Card position in Figma (A: left 100, B: right edge 1820; top 431).
const K0_TOWERS = {
  A: {
    label: 'Tower A',
    window: [[720, 434], [958, 434], [958, 906], [664, 906], [664, 830]],
    roof: [[727, 446], [800, 443], [862, 458], [941, 461], [941, 790], [968, 800], [968, 900], [677, 897], [675, 827], [683, 827]],
    labelAnchor: [688, 590], labelSide: 'left',
    card: { left: 100, top: 431 },
  },
  B: {
    label: 'Tower B',
    window: [[986, 434], [1204, 434], [1242, 826], [1242, 920], [986, 906]],
    roof: [[1003, 459], [1073, 457], [1107, 445], [1193, 446], [1227, 827], [1230, 840], [1230, 917], [968, 900], [968, 800], [1003, 790]],
    labelAnchor: [1225, 590], labelSide: 'right',
    card: { right: 1820, top: 431 },
  },
};

const round = (n) => Math.round(n * 10) / 10;

runMain('build-manifest', async () => {
  const stills = await readJson(path.join(PUBLIC, 'stills', 'stills.json'));
  const overlayIndex = await readJson(path.join(CACHE, 'overlay-index.json'));

  const views = [];
  const k0 = stills.find((s) => s.view === 'K0');
  if (!k0) throw new BuildError('No K0 still; run normalise-frames first');
  views.push({
    id: 'K0', tower: null, name: 'Overview', still: 'stills/k0',
    overlay: null, focal: [968, 680], towers: K0_TOWERS,
  });

  for (const id of VIEW_IDS) {
    const still = stills.find((s) => s.view === id);
    const ov = overlayIndex[id];
    if (!still || !ov) throw new BuildError(`View ${id} is missing its still or overlay`);
    const b = ov.bounds;
    views.push({
      id, tower: id[0], name: still.name, still: `stills/${id.toLowerCase()}`,
      overlay: `overlays/${id.toLowerCase()}.svg`,
      units: ov.units.length,
      bounds: [round(b.minX), round(b.minY), round(b.maxX), round(b.maxY)],
      // Cover-fit centres on the tower, so portrait crops keep it in frame.
      focal: [round((b.minX + b.maxX) / 2), round((b.minY + b.maxY) / 2)],
    });
  }

  const shots = [];
  for (const dir of (await listVisible(path.join(PUBLIC, 'shots'))).filter((e) => e.isDirectory())) {
    const info = await readJson(path.join(PUBLIC, 'shots', dir.name, 'shot.json'));
    const files = (await fs.readdir(path.join(PUBLIC, 'shots', dir.name, 'desktop')));
    const frames = files.filter((f) => f.endsWith('.jpg')).length;
    const avif = files.filter((f) => f.endsWith('.avif')).length;
    if (frames !== info.frames || avif !== info.frames) throw new BuildError(`${info.id}: ${frames} jpg / ${avif} avif, expected ${info.frames}`);
    const size = await imageSize(path.join(PUBLIC, 'shots', dir.name, 'desktop', '0001.jpg'));
    shots.push({
      id: info.id, from: info.from, to: info.to, frames,
      width: size.width, height: size.height,
      path: `shots/${info.id}/desktop/`, formats: ['avif', 'jpg'],
    });
  }
  shots.sort((a, b) => a.id.localeCompare(b.id));

  // Every view must be reachable, and every shot must join two known views.
  const ids = new Set(views.map((v) => v.id));
  for (const s of shots) {
    if (!ids.has(s.from) || !ids.has(s.to)) throw new BuildError(`${s.id} joins unknown views ${s.from}→${s.to}`);
  }
  for (const v of ids) {
    if (!shots.some((s) => s.from === v || s.to === v)) throw new BuildError(`View ${v} has no shot`);
  }

  const manifest = {
    version: ASSET_VERSION,
    generated: new Date().toISOString(),
    stage: { width: 1920, height: 1080 },
    fps: 30,
    formats: { still: ['avif', 'jpg'], frame: ['avif', 'jpg'] },
    statusColours: { available: '#033825', reserved: '#E8CE06', sold: '#F7431A' },
    loops: { A: ['A1', 'A2', 'A3'], B: ['B1', 'B2', 'B3'] },
    views,
    shots,
  };
  await writeJson(path.join(PUBLIC, 'manifest.json'), manifest);
  log(`  ${views.length} views, ${shots.length} shots (${shots.map((s) => `${s.from}→${s.to}`).join(', ')})`);
});
