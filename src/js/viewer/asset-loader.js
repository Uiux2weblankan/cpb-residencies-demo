import { CONFIG } from '../config.js';
import { isMobileLayout } from '../core/dom.js';

// 2×2 AVIF used to feature-test decoding support.
const AVIF_PROBE = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAE1pUHJhdmlmbWlhZm1pZjEAAAFebWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAAOcGl0bQAAAAAAAQAAADhpaW5mAAAAAAACAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAFWluZmUCAAABAAIAAEV4aWYAAAAAGmlyZWYAAAAAAAAADmNkc2MAAgABAAEAAACBaXBycAAAAGBpcGNvAAAAE2NvbHJuY2x4AAIAAgAGgAAAAAxjbGxpAMsAQAAAABRpc3BlAAAAAAAAAAIAAAACAAAACWlyb3QAAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAAB2gAAACYAAgAAAAEAAAGOAAAATAAAAAFtZGF0AAAAAAAAAIIAAAAGRXhpZgAATU0AKgAAAAgAAwEaAAUAAAABAAAAMgEbAAUAAAABAAAAOgEoAAMAAAABAAIAAAAAAAAAAAAZAAAAAQAAABkAAAABEgAKDAAAAAAGf/wIEBA0IDIUEAGSAAgggiABMi185qsly+f7a40=';

export const PRIORITY = { idle: 0, low: 1, high: 2, now: 3 };

/** Decodes a Blob to something drawImage accepts: ImageBitmap where possible, <img> otherwise. */
async function decodeBlob(blob, resize) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, resize ? { resizeWidth: resize.width, resizeHeight: resize.height, resizeQuality: 'medium' } : undefined);
    } catch {
      try { return await createImageBitmap(blob); } catch { /* fall through */ }
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

function closeImage(img) {
  if (img && typeof img.close === 'function') img.close();
}

/**
 * Decoded frames of one shot. Frames decode progressively, so playback can start
 * before the whole clip is ready; the player holds a frame if decoding falls behind.
 */
class FrameSet {
  constructor(shot, count) {
    this.shot = shot;
    this.count = count;
    this.images = new Array(count).fill(null);
    this.decoded = 0;
    this.failed = false;
    this.users = 0;
    this.waiters = new Map(); // index → [resolve]
  }
  has(i) { return Boolean(this.images[i]); }
  get complete() { return this.decoded === this.count; }
  set(i, img) {
    this.images[i] = img;
    this.decoded++;
    for (const resolve of this.waiters.get(i) ?? []) resolve(true);
    this.waiters.delete(i);
  }
  whenFrame(i) {
    if (this.has(i)) return Promise.resolve(true);
    return new Promise((resolve) => {
      if (!this.waiters.has(i)) this.waiters.set(i, []);
      this.waiters.get(i).push(resolve);
    });
  }
  dispose() {
    this.images.forEach(closeImage);
    this.images.fill(null);
    this.disposed = true;
  }
}

/**
 * Fetches and decodes stills and frame sequences.
 *  • Compressed frames are prefetched as Blobs (cheap: ~60 KB each in AVIF).
 *  • Only the shots about to play are decoded, and an LRU keeps memory bounded.
 */
export class AssetLoader {
  ext = 'jpg';
  #blobs = new Map();
  #stills = new Map();
  #sets = new Map(); // shotId → FrameSet, in LRU order
  #queue = [];
  #active = 0;

  constructor(manifest) {
    this.manifest = manifest;
  }

  async init() {
    this.ext = (await this.#supportsAvif()) ? 'avif' : 'jpg';
    return this;
  }

  async #supportsAvif() {
    try {
      const blob = await (await fetch(AVIF_PROBE)).blob();
      const img = await decodeBlob(blob);
      const ok = (img.width ?? img.naturalWidth) > 0;
      closeImage(img);
      return ok;
    } catch { return false; }
  }

  /* ---------- Fetch queue ---------- */

  fetchBlob(url, priority = PRIORITY.low) {
    const cached = this.#blobs.get(url);
    if (cached) {
      cached.bump?.(priority);
      return cached.promise;
    }
    let job;
    const promise = new Promise((resolve, reject) => {
      job = { url, priority, resolve, reject };
    });
    const entry = { promise, bump: (p) => { if (p > job.priority) { job.priority = p; this.#sortQueue(); } } };
    this.#blobs.set(url, entry);
    promise.catch(() => this.#blobs.delete(url)); // allow a retry later
    this.#queue.push(job);
    this.#sortQueue();
    this.#pump();
    return promise;
  }

  #sortQueue() { this.#queue.sort((a, b) => b.priority - a.priority); }

  #pump() {
    while (this.#active < CONFIG.fetchConcurrency && this.#queue.length) {
      const job = this.#queue.shift();
      this.#active++;
      fetch(job.url)
        .then((r) => { if (!r.ok) throw new Error(`${r.status} ${job.url}`); return r.blob(); })
        .then(job.resolve, job.reject)
        .finally(() => { this.#active--; this.#pump(); });
    }
  }

  /* ---------- Stills (kept at full quality) ---------- */

  still(viewId, priority = PRIORITY.high) {
    if (!this.#stills.has(viewId)) {
      const p = this.fetchBlob(this.manifest.stillUrl(viewId, this.ext), priority).then((b) => decodeBlob(b));
      p.catch(() => this.#stills.delete(viewId));
      this.#stills.set(viewId, p);
    } else {
      this.fetchBlob(this.manifest.stillUrl(viewId, this.ext), priority);
    }
    return this.#stills.get(viewId);
  }

  /* ---------- Frame sequences ---------- */

  /** Downloads the compressed frames of a shot without decoding them. */
  prefetchShot(shotId, priority = PRIORITY.idle) {
    const shot = this.manifest.shot(shotId);
    return Promise.all(Array.from({ length: shot.frames }, (_, i) => this.fetchBlob(this.manifest.frameUrl(shotId, i, this.ext), priority)));
  }

  /**
   * Returns the FrameSet for a shot, starting its decode if needed. `reverse`
   * decodes from the last frame first, so reverse playback can start early.
   */
  frames(shotId, { reverse = false, priority = PRIORITY.now } = {}) {
    let set = this.#sets.get(shotId);
    if (set && !set.failed) {
      this.#sets.delete(shotId); // refresh LRU position
      this.#sets.set(shotId, set);
      return set;
    }
    const shot = this.manifest.shot(shotId);
    set = new FrameSet(shotId, shot.frames);
    this.#sets.set(shotId, set);
    this.#evict();
    this.#decodeSet(set, reverse, priority);
    return set;
  }

  async #decodeSet(set, reverse, priority) {
    const mobile = isMobileLayout();
    const width = mobile ? CONFIG.decodeWidth.mobile : CONFIG.decodeWidth.desktop;
    const { width: sw, height: sh } = this.manifest.stage;
    const resize = { width, height: Math.round((width * sh) / sw) };
    const order = Array.from({ length: set.count }, (_, i) => (reverse ? set.count - 1 - i : i));
    let next = 0;
    const worker = async () => {
      while (next < order.length && !set.disposed) {
        const i = order[next++];
        try {
          const blob = await this.fetchBlob(this.manifest.frameUrl(set.shot, i, this.ext), priority);
          if (set.disposed) return;
          const img = await decodeBlob(blob, resize);
          if (set.disposed) { closeImage(img); return; }
          set.set(i, img);
        } catch (err) {
          set.failed = true;
          console.warn(`[viewer] frame ${i + 1} of ${set.shot} failed`, err);
          return;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  #evict() {
    const max = isMobileLayout() ? CONFIG.decodedShotCache.mobile : CONFIG.decodedShotCache.desktop;
    for (const [id, set] of this.#sets) {
      if (this.#sets.size <= max) break;
      if (set.users > 0) continue; // never drop a shot that is playing
      set.dispose();
      this.#sets.delete(id);
    }
  }
}
