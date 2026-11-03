#!/usr/bin/env node
// Runs the whole asset pipeline in order. Extra flags are passed to normalise-frames.
//   node scripts/build-all.mjs            incremental (skips unchanged frames)
//   node scripts/build-all.mjs --force    re-encode every still and frame

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
const steps = [
  ['normalise-frames.mjs', extra],
  ['clean-svgs.mjs', []],
  ['build-units.mjs', []],
  ['build-manifest.mjs', []],
];

for (const [script, args] of steps) {
  console.log(`\n▸ ${script.replace('.mjs', '')}`);
  const r = spawnSync(process.execPath, [path.join(dir, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('\nAll assets built into public/.');
