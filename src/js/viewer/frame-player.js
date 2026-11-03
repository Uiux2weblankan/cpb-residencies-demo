import { CONFIG } from '../config.js';
import { prefersReducedMotion } from '../core/dom.js';
import { framedFit, easeInOut, lerpFit } from './fit.js';
import { PRIORITY } from './asset-loader.js';

/**
 * Draws stills and frame sequences on a <canvas>.
 *  • At rest: the view's still at full quality.
 *  • In motion: the shot's frames at 30 fps (forward or reverse). The first and last
 *    frames are blended with the stills, so the hand-off to the overlay is exact.
 *  • Falls back to a crossfade under prefers-reduced-motion, or if frames are late.
 *  • Framing: each view is cover-fitted so its tower stays clear of the UI panel
 *    (see `exclusion`); a clip blends from the start view's framing to the end view's.
 */
export class FramePlayer {
  rest = null; // { image, viewId }
  #raf = 0;
  /** (viewId) → { side: 'left' | 'right', size } in CSS px, or null. Set by the page. */
  exclusion = null;

  constructor(canvas, manifest, loader) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.manifest = manifest;
    this.loader = loader;
    this.stage = manifest.stage;
  }

  /** Size the backing store to the element (capped DPR) and redraw. */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w && h && (w !== this.canvas.width || h !== this.canvas.height)) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.imageSmoothingQuality = 'high';
    }
    this.redraw();
  }

  /** Framing of a view in CSS pixels, used to place the overlay layers. */
  layout(viewId) {
    return this.#fit(viewId, this.canvas.clientWidth, this.canvas.clientHeight, 1);
  }

  /** Framing of a view in canvas (device) pixels. */
  #deviceFit(viewId) {
    const k = this.canvas.clientWidth ? this.canvas.width / this.canvas.clientWidth : 1;
    return this.#fit(viewId, this.canvas.width, this.canvas.height, k);
  }

  #fit(viewId, W, H, k) {
    const view = this.manifest.view(viewId);
    const ex = this.exclusion?.(viewId);
    const exclusion = ex ? { side: ex.side, size: ex.size * k } : null;
    return framedFit(W, H, this.stage.width, this.stage.height, view, exclusion, 40 * k);
  }

  async showStill(viewId) {
    const image = await this.loader.still(viewId, PRIORITY.now);
    this.rest = { image, viewId };
    this.redraw();
  }

  redraw() {
    if (this.rest) this.#draw(this.rest.image, this.#deviceFit(this.rest.viewId), 1);
  }

  #draw(image, f, alpha) {
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(image, f.x, f.y, f.w, f.h);
    this.ctx.globalAlpha = 1;
  }

  /**
   * Plays one step of a route: { shotId, reverse, from, to }.
   * Resolves once the destination still is on screen.
   */
  async play(step) {
    const from = this.#deviceFit(step.from);
    const to = this.#deviceFit(step.to);
    const [fromStill, toStill] = await Promise.all([
      this.loader.still(step.from, PRIORITY.now),
      this.loader.still(step.to, PRIORITY.now),
    ]);

    if (prefersReducedMotion()) {
      await this.#crossfade(fromStill, from, toStill, to);
    } else {
      const ok = await this.#playFrames(step, fromStill, from, toStill, to);
      if (!ok) await this.#crossfade(this.lastFrame ?? fromStill, this.lastFit ?? from, toStill, to);
    }
    this.rest = { image: toStill, viewId: step.to };
    this.redraw();
  }

  /** Returns false if the frames could not keep up, so the caller can crossfade. */
  async #playFrames(step, fromStill, fromFit, toStill, toFit) {
    const set = this.loader.frames(step.shotId, { reverse: step.reverse });
    const n = set.count;
    const first = step.reverse ? n - 1 : 0;
    set.users++;
    this.lastFrame = null;
    this.lastFit = null;

    try {
      // Wait briefly for the first frame; a cold shot falls back to the crossfade.
      const ready = await Promise.race([set.whenFrame(first), wait(CONFIG.maxStallMs).then(() => false)]);
      if (!ready || set.failed) return false;

      const frameMs = 1000 / CONFIG.fps;
      const blend = CONFIG.endpointBlendFrames;
      let elapsed = 0;
      let stalled = 0;
      let last = performance.now();

      return await new Promise((resolve) => {
        const tick = (now) => {
          const dt = Math.min(now - last, 100);
          last = now;
          elapsed += dt;
          const pos = Math.min(Math.floor(elapsed / frameMs), n - 1);
          const index = step.reverse ? n - 1 - pos : pos;

          if (!set.has(index)) {
            // Decoding is behind: hold the current frame instead of skipping ahead.
            elapsed -= dt;
            stalled += dt;
            if (stalled > CONFIG.maxStallMs || set.failed) { resolve(false); return; }
            this.#raf = requestAnimationFrame(tick);
            return;
          }

          const t = n > 1 ? pos / (n - 1) : 1;
          const fit = lerpFit(fromFit, toFit, easeInOut(t));
          const image = set.images[index];
          this.#draw(image, fit, 1);
          // Endpoint blend: frame 1 becomes the start still, frame 31 the end still.
          if (pos < blend) this.#draw(fromStill, fromFit, 1 - pos / blend);
          if (pos > n - 1 - blend) this.#draw(toStill, toFit, 1 - (n - 1 - pos) / blend);
          this.lastFrame = image;
          this.lastFit = fit;

          if (pos >= n - 1) { resolve(true); return; }
          this.#raf = requestAnimationFrame(tick);
        };
        this.#raf = requestAnimationFrame(tick);
      });
    } finally {
      set.users--;
    }
  }

  #crossfade(fromImage, fromFit, toImage, toFit) {
    const ms = CONFIG.crossfadeMs;
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = (now) => {
        const t = Math.min((now - start) / ms, 1);
        this.#draw(fromImage, fromFit, 1);
        this.#draw(toImage, toFit, easeInOut(t));
        if (t < 1) this.#raf = requestAnimationFrame(tick); else resolve();
      };
      this.#raf = requestAnimationFrame(tick);
    });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
