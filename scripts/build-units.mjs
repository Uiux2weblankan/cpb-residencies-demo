#!/usr/bin/env node
// build-units: public/data/units.json, checked against the cleaned overlays.
//
// units.json is the source the viewer reads for the card (type, area, status).
//  • First run (or --regenerate): seeds units.json from the overlay metadata, which
//    carries the type and area taken from the floor plans and unit sheets.
//    Statuses and prices are DEMO values (deterministic per id) until the client feed exists.
//  • Later runs: verify every overlay id against units.json. A missing record or a
//    type/area mismatch fails the build. Existing statuses are never overwritten.
//
// Also reports coverage: every unit should be visible from at least one view.

import path from 'node:path';
import {
  PUBLIC, CACHE, FLOORS, BuildError, exists, readJson, writeJson, log, warn, runMain,
} from './lib/shared.mjs';

const UNITS_FILE = path.join(PUBLIC, 'data', 'units.json');
const REGENERATE = process.argv.includes('--regenerate');
const EXPECTED_PER_TOWER = 313;

// Floors shown fully sold in the demo data, so the "sold-out floor" state is visible.
const DEMO_SOLD_OUT_FLOORS = ['A-07', 'B-33'];

/** Small deterministic hash → [0, 1) so demo statuses are stable between runs. */
function hash01(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

function demoStatus(id) {
  if (DEMO_SOLD_OUT_FLOORS.includes(id.slice(0, 4))) return 'sold';
  const r = hash01(id);
  if (r < 0.6) return 'available';
  if (r < 0.78) return 'reserved';
  return 'sold';
}

/** Merges the per-view overlay records into one record per unit. */
function collect(index) {
  const units = new Map();
  const issues = [];
  for (const [view, { units: list }] of Object.entries(index)) {
    for (const u of list) {
      const prev = units.get(u.id);
      if (!prev) {
        units.set(u.id, { ...u, views: [view], notes: u.note ? [u.note] : [] });
        continue;
      }
      if (prev.type !== u.type) issues.push(`${u.id}: type ${prev.type} in ${prev.views[0]} but ${u.type} in ${view}`);
      if (prev.areaFt2 !== u.areaFt2) issues.push(`${u.id}: ${prev.areaFt2} ft² in ${prev.views[0]} but ${u.areaFt2} ft² in ${view}`);
      prev.views.push(view);
      if (u.note && !prev.notes.includes(u.note)) prev.notes.push(u.note);
    }
  }
  return { units, issues };
}

/** Demo list price in USD: rate per ft² rises with the floor; 4BR Sky Villas carry a premium. */
function demoPrice(u) {
  const rate = 240 + (u.floor - 6) * 6 + (u.type === '4BR' ? 60 : 0);
  const jitter = 0.95 + hash01(`${u.id}-price`) * 0.1;
  return Math.round((u.areaFt2 * rate * jitter) / 1000) * 1000;
}

function toRecord(u, status) {
  return {
    id: u.id,
    tower: u.tower,
    floor: u.floor,
    unit: u.unit,
    type: u.type,
    area_ft2: u.areaFt2,
    status,
    price_usd: demoPrice(u),
    plan_url: 'public/img/floor-plan-sample.png',
    page_url: `residence.html?unit=${u.id}`,
    views: u.views,
    ...(u.notes.length ? { note: u.notes.join('; ') } : {}),
  };
}

function sortUnits(a, b) {
  return a.tower.localeCompare(b.tower) || b.floor - a.floor || a.unit.localeCompare(b.unit);
}

runMain('build-units', async () => {
  const index = await readJson(path.join(CACHE, 'overlay-index.json'));
  const { units, issues } = collect(index);
  if (issues.length) throw new BuildError(`Overlays disagree:\n    ${issues.join('\n    ')}`);

  let data;
  if (REGENERATE || !(await exists(UNITS_FILE))) {
    const previous = await readJson(UNITS_FILE, { units: [] });
    const keep = new Map(previous.units.map((u) => [u.id, u.status]));
    data = {
      version: 1,
      status_source: 'demo',
      updated: new Date().toISOString(),
      units: [...units.values()].map((u) => toRecord(u, keep.get(u.id) ?? demoStatus(u.id))).sort(sortUnits),
    };
    log(`  seeded ${data.units.length} units from the overlays (statuses: ${previous.units.length ? 'kept' : 'demo'})`);
  } else {
    data = await readJson(UNITS_FILE);
    const byId = new Map(data.units.map((u) => [u.id, u]));
    const errors = [];
    for (const u of units.values()) {
      const rec = byId.get(u.id);
      if (!rec) { errors.push(`${u.id} is in ${u.views.join(', ')} but has no units.json record`); continue; }
      if (rec.type !== u.type) errors.push(`${u.id}: units.json says ${rec.type}, overlay says ${u.type}`);
      if (rec.area_ft2 !== u.areaFt2) errors.push(`${u.id}: units.json says ${rec.area_ft2} ft², overlay says ${u.areaFt2} ft²`);
      rec.views = u.views; // coverage is derived from the overlays
    }
    if (errors.length) throw new BuildError(`${errors.length} mismatch(es) between overlays and units.json:\n    ${errors.join('\n    ')}`);
    for (const rec of data.units) {
      if (!units.has(rec.id)) { rec.views = []; warn(`${rec.id} is not visible from any view`); }
    }
    log(`  verified ${units.size} overlay ids against units.json: 0 mismatches`);
  }

  // Coverage and sanity report.
  for (const tower of ['A', 'B']) {
    const list = data.units.filter((u) => u.tower === tower);
    const floors = new Set(list.map((u) => u.floor));
    const hidden = list.filter((u) => !u.views.length).length;
    const badFloors = [...floors].filter((f) => !FLOORS.includes(f));
    if (badFloors.length) throw new BuildError(`Tower ${tower} has records on non-existent floors ${badFloors.join(', ')}`);
    const count = (s) => list.filter((u) => u.status === s).length;
    log(`  Tower ${tower}: ${list.length} units on ${floors.size} floors, ${hidden} not visible in any view · ` +
      `${count('available')} available, ${count('reserved')} reserved, ${count('sold')} sold`);
    if (list.length !== EXPECTED_PER_TOWER) warn(`Tower ${tower} has ${list.length} units, the plans list ${EXPECTED_PER_TOWER}`);
  }

  await writeJson(UNITS_FILE, data);
});
