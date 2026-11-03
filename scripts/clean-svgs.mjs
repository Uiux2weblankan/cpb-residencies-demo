#!/usr/bin/env node
// clean-svgs: Figma "Floor Container" exports → public/overlays/{view}.svg
//
//  • decodes the double-encoded ids ("A-35-U07 &#194;&#183; 4BR …")
//  • writes id="A-35-U07" plus data-floor, data-unit, data-type, data-area-ft2, data-note
//  • renames floor groups to id="floor-A-35"
//  • strips inline style / fill / stroke so status colours come from CSS
//  • leaves path data untouched
//
// Any id that does not follow the naming standard fails the build.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SRC_SVGS, PUBLIC, CACHE, FLOORS, TYPES, VIEW_IDS, BuildError,
  listVisible, decodeFigmaText, escapeAttr, pad, pathBounds, mergeBounds, writeJson, log, runMain,
} from './lib/shared.mjs';

const UNIT_ID = /^([AB])-(\d{2})-(U\d{2})$/;

/** "A-35-U07 · 4BR · 4000 ft² · ⚠ outline from nearest floor" → fields */
function parseUnitName(raw, view, issues) {
  const parts = decodeFigmaText(raw).split('·').map((s) => s.trim());
  const [id, type, area, ...rest] = parts;
  const m = UNIT_ID.exec(id || '');
  if (!m) { issues.push(`${view}: bad unit id "${parts.join(' · ')}"`); return null; }
  const [, tower, floor, unit] = m;
  if (tower !== view[0]) issues.push(`${view}: ${id} belongs to tower ${tower}`);
  if (!FLOORS.includes(Number(floor))) issues.push(`${view}: ${id} is on floor ${floor}, which does not exist`);
  if (!TYPES.includes(type)) issues.push(`${view}: ${id} has unknown type "${type}"`);
  const areaFt2 = Number(/^([\d,]+)\s*ft²$/.exec(area || '')?.[1]?.replace(/,/g, ''));
  if (!areaFt2) issues.push(`${view}: ${id} has unreadable area "${area}"`);
  const note = rest.join(' · ').replace(/^⚠\s*/, '');
  return { id, tower, floor: Number(floor), unit, type, areaFt2, note };
}

function cleanSvg(text, view, issues) {
  const units = [];
  const floors = [];
  const bounds = [];
  let current = null;
  const lines = [];

  // Figma exports one element per line; walk them in order.
  for (const tag of text.match(/<[^>]+>/g)) {
    if (tag.startsWith('<svg')) continue;
    if (tag === '</svg>') continue;

    const group = /^<g id="([^"]*)"/.exec(tag);
    if (group) {
      const name = decodeFigmaText(group[1]);
      const fm = /^Floor (\d{2})$/.exec(name);
      if (fm) {
        const floor = Number(fm[1]);
        if (!FLOORS.includes(floor)) issues.push(`${view}: floor group "${name}" is not a residential floor`);
        current = { floor, count: 0 };
        floors.push(current);
        lines.push(`<g id="floor-${view[0]}-${pad(floor)}" class="floor" data-floor="${floor}">`);
      }
      // The outer "Floor Container" group is dropped.
      continue;
    }
    if (tag === '</g>') {
      if (current) { lines.push('</g>'); current = null; }
      continue;
    }

    const p = /^<path id="([^"]*)" d="([^"]*)"/.exec(tag);
    if (p) {
      if (!current) { issues.push(`${view}: path outside a floor group`); continue; }
      const u = parseUnitName(p[1], view, issues);
      if (!u) continue;
      if (u.floor !== current.floor) issues.push(`${view}: ${u.id} sits in group Floor ${pad(current.floor)}`);
      current.count++;
      units.push({ ...u, view });
      bounds.push(pathBounds(p[2]));
      const attrs = [
        `id="${u.id}"`, 'class="unit"',
        `data-floor="${u.floor}"`, `data-unit="${u.unit}"`, `data-type="${u.type}"`, `data-area-ft2="${u.areaFt2}"`,
        u.note ? `data-note="${escapeAttr(u.note)}"` : '',
        `d="${p[2]}"`,
      ].filter(Boolean);
      lines.push(`<path ${attrs.join(' ')}/>`);
      continue;
    }
    issues.push(`${view}: unexpected element ${tag.slice(0, 40)}…`);
  }

  // Each unit must appear once per view.
  const seen = new Set();
  for (const u of units) {
    if (seen.has(u.id)) issues.push(`${view}: ${u.id} appears twice`);
    seen.add(u.id);
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" class="overlay-svg" data-view="${view}">`,
    ...lines,
    '</svg>',
    '',
  ].join('\n');
  return { svg, units, floors, bounds: mergeBounds(bounds) };
}

runMain('clean-svgs', async () => {
  const files = (await listVisible(SRC_SVGS)).filter((e) => e.isFile() && e.name.endsWith('.svg'));
  const issues = [];
  const index = {};

  for (const f of files) {
    const view = /\(([AB][123])\)\.svg$/.exec(f.name)?.[1];
    if (!view) { issues.push(`Unrecognised file name "${f.name}"`); continue; }
    const text = await fs.readFile(path.join(SRC_SVGS, f.name), 'utf8');
    const { svg, units, floors, bounds } = cleanSvg(text, view, issues);
    await fs.mkdir(path.join(PUBLIC, 'overlays'), { recursive: true });
    await fs.writeFile(path.join(PUBLIC, 'overlays', `${view.toLowerCase()}.svg`), svg);
    index[view] = { bounds, units };
    const flagged = units.filter((u) => u.note).length;
    log(`  ${view}: ${units.length} apartments on ${floors.length} floors` +
      `${flagged ? `, ${flagged} flagged ⚠` : ''} → overlays/${view.toLowerCase()}.svg (${(svg.length / 1024).toFixed(0)} KB)`);
  }

  const missing = VIEW_IDS.filter((v) => !index[v]);
  if (missing.length) issues.push(`Missing overlays for ${missing.join(', ')}`);
  if (issues.length) throw new BuildError(`${issues.length} issue(s):\n    ${issues.join('\n    ')}`);

  // Intermediate file read by build-units and build-manifest.
  await writeJson(path.join(CACHE, 'overlay-index.json'), index);
});
