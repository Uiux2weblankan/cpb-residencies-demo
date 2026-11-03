// Shared helpers for the asset pipeline scripts (Node 18+, no dependencies).
// Image work uses macOS `sips`, which can write AVIF and JPEG.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE = path.join(ROOT, 'source-assets');
export const PUBLIC = path.join(ROOT, 'public');
export const CACHE = path.join(ROOT, 'scripts', '.cache');

export const SRC_STILLS = path.join(SOURCE, 'Base Images');
export const SRC_FRAMES = path.join(SOURCE, 'Frames Container');
export const SRC_SVGS = path.join(SOURCE, 'SVGs');

export const VIEW_IDS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
export const FLOORS = [6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
export const TYPES = ['STUDIO', '1BR', '2BR', '3BR', '4BR'];

export const STAGE = { width: 1920, height: 1080 };

/** Encoding settings. AVIF is the primary format, JPEG the fallback. */
export const ENCODE = {
  frame: { avif: 45, jpeg: 45 },
  still: { avif: 60, jpeg: 70 },
};

export const log = (...args) => console.log(...args);
export const warn = (...args) => console.warn('  ⚠', ...args);

export class BuildError extends Error {}

export async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Lists visible entries, skipping .DS_Store and other dot files. */
export async function listVisible(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => !e.name.startsWith('.'));
}

export async function readJson(p, fallback = undefined) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch (err) { if (fallback !== undefined) return fallback; throw err; }
}

export async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n');
}

/** True if `out` exists and is newer than `src`, so the encode can be skipped. */
export async function isFresh(src, out) {
  try {
    const [a, b] = await Promise.all([fs.stat(src), fs.stat(out)]);
    return b.mtimeMs >= a.mtimeMs;
  } catch { return false; }
}

export async function sips(args) {
  await execFileAsync('sips', args, { maxBuffer: 1 << 24 });
}

export async function imageSize(file) {
  const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  const w = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1]);
  return { width: w, height: h };
}

/**
 * Encodes one source image to AVIF + JPEG at `maxWidth` (aspect kept).
 * Returns true if anything was written.
 */
export async function encodeImage(src, outBase, quality, maxWidth = STAGE.width, force = false) {
  await fs.mkdir(path.dirname(outBase), { recursive: true });
  let wrote = false;
  for (const [fmt, ext] of [['avif', 'avif'], ['jpeg', 'jpg']]) {
    const out = `${outBase}.${ext}`;
    if (!force && (await isFresh(src, out))) continue;
    await sips(['-Z', String(maxWidth), '-s', 'format', fmt, '-s', 'formatOptions', String(quality[fmt]), src, '--out', out]);
    wrote = true;
  }
  return wrote;
}

/** Runs async jobs with a fixed concurrency. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Figma double-encodes UTF-8: "·" arrives as "&#194;&#183;" (the UTF-8 bytes
 * written as Latin-1 entities). Decode the entities, then reinterpret as UTF-8.
 */
export function decodeFigmaText(s) {
  const latin1 = s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return Buffer.from(latin1, 'latin1').toString('utf8');
}

export function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bounding box of an absolute M/L/H/V/Z path (the only commands Figma emits here). */
export function pathBounds(d) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let cmd = 'M'; let x = 0; let y = 0; let i = 0;
  const add = () => { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t; i++;
      if (cmd === 'Z' || cmd === 'z') continue;
      if (cmd !== cmd.toUpperCase()) throw new BuildError(`Relative path command "${cmd}" not supported`);
      continue;
    }
    if (cmd === 'M' || cmd === 'L') { x = Number(tokens[i]); y = Number(tokens[i + 1]); i += 2; }
    else if (cmd === 'H') { x = Number(tokens[i]); i += 1; }
    else if (cmd === 'V') { y = Number(tokens[i]); i += 1; }
    else throw new BuildError(`Unexpected token "${t}" after "${cmd}"`);
    add();
  }
  return b;
}

export function mergeBounds(list) {
  return list.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

export const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Runs a script's main() and turns BuildErrors into a clean exit code. */
export function runMain(name, main) {
  const t0 = Date.now();
  main().then(() => log(`✓ ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`))
    .catch((err) => {
      console.error(`✗ ${name} failed: ${err.message}`);
      if (!(err instanceof BuildError)) console.error(err.stack);
      process.exitCode = 1;
    });
}
