import { CONFIG } from '../config.js';
import { Emitter } from '../core/emitter.js';
import { isMobileLayout } from '../core/dom.js';
import { AssetLoader, PRIORITY } from './asset-loader.js';
import { FramePlayer } from './frame-player.js';
import { OverlayLayer } from './overlay-layer.js';
import { TowerLayer } from './tower-layer.js';
import { RoutePlanner } from './route-planner.js';

/**
 * The viewer's state machine. It holds the current view (K0, A1–A3, B1–B3), maps
 * each move to shots via the route planner, and locks input during a transition:
 * clicks made while a clip plays are queued, and only the last one is kept.
 *
 * Events:
 *   'ready' {view}
 *   'transition:start' {from, to, steps}
 *   'transition:end' {view}
 *   'view' {view}               arrived and at rest, overlay visible
 *   'queued' {action}
 */
export class Viewer extends Emitter {
  view = null;
  busy = false;
  #queued = null;
  #target = null;

  constructor(root, { manifest, store }) {
    super();
    this.root = root;
    this.manifest = manifest;
    this.store = store;
    this.loader = new AssetLoader(manifest);
    this.planner = new RoutePlanner(manifest);
    this.player = new FramePlayer(root.querySelector('[data-canvas]'), manifest, this.loader);
    this.overlay = new OverlayLayer(root.querySelector('[data-overlay-layer]'), { manifest, store });
    this.towers = new TowerLayer(root.querySelector('[data-tower-layer]'), { manifest });
    this.stage = root.querySelector('[data-stage]');
  }

  async init(startView = 'K0') {
    if (!this.manifest.view(startView)) startView = 'K0';
    await this.loader.init();
    this.player.resize();
    // First paint: the start still (and the unit data, loaded by the caller).
    await this.player.showStill(startView);
    this.view = startView;
    this.#bindResize();
    this.#bindSwipe();
    await this.#arrive(startView);
    this.emit('ready', { view: startView });
  }

  /* ---------- Navigation API ---------- */

  go(target) { return this.#request({ type: 'go', target }); }
  next() { return this.#request({ type: 'step', dir: 1 }); }
  prev() { return this.#request({ type: 'step', dir: -1 }); }
  overview() { return this.go('K0'); }
  switchTower() { return this.#request({ type: 'switch' }); }

  /** Where a transition is heading, or the current view at rest. */
  get destination() { return this.#target ?? this.view; }

  #resolve(action, from) {
    if (action.type === 'go') return action.target;
    if (action.type === 'step') return this.planner.step(from, action.dir);
    if (action.type === 'switch') return this.planner.otherTower(from);
    return null;
  }

  async #request(action) {
    if (this.busy) {
      // Input during a clip: keep only the last request; it runs when the clip lands.
      this.#queued = action;
      this.emit('queued', { action, target: this.#resolve(action, this.#target ?? this.view) });
      return;
    }
    const target = this.#resolve(action, this.view);
    if (!target || target === this.view) return;
    await this.#travel(target);
  }

  async #travel(target) {
    this.busy = true;
    this.#target = target;
    const steps = this.planner.route(this.view, target);
    this.root.dataset.state = 'transition';
    this.overlay.hide();
    this.towers.hide();
    this.overlay.prefetch(target);
    this.emit('transition:start', { from: this.view, to: target, steps });

    for (const step of steps) {
      // Warm the following step while this one plays.
      const nextStep = steps[steps.indexOf(step) + 1];
      if (nextStep) this.loader.frames(nextStep.shotId, { reverse: nextStep.reverse, priority: PRIORITY.high });
      await this.player.play(step);
      this.view = step.to;
      this.root.dataset.view = step.to;
    }

    this.busy = false;
    this.#target = null;
    this.emit('transition:end', { view: this.view });

    const queued = this.#queued;
    this.#queued = null;
    if (queued) {
      const next = this.#resolve(queued, this.view);
      if (next && next !== this.view) { await this.#travel(next); return; }
    }
    await this.#arrive(this.view);
  }

  async #arrive(viewId) {
    this.root.dataset.view = viewId;
    this.#layoutLayers();
    if (viewId === 'K0') {
      this.towers.show();
    } else {
      try {
        await this.overlay.show(viewId);
      } catch (err) {
        console.error('[viewer] overlay failed', err);
      }
    }
    if (this.busy || this.view !== viewId) { this.overlay.hide(); return; } // a new transition started meanwhile
    this.root.dataset.state = 'ready';
    this.emit('view', { view: viewId });
    this.#preloadAround(viewId);
  }

  /* ---------- Loading strategy ---------- */

  #preloadAround(viewId) {
    const L = this.loader;
    const decodeAhead = !isMobileLayout();
    if (viewId === 'K0') {
      // Next after first paint: shots 01 and 02, and the stills they land on.
      for (const s of ['shot-01', 'shot-02']) L.prefetchShot(s, PRIORITY.low);
      L.still('A1', PRIORITY.low); L.still('B1', PRIORITY.low);
      if (decodeAhead) { L.frames('shot-01', { priority: PRIORITY.idle }); L.frames('shot-02', { priority: PRIORITY.idle }); }
      return;
    }
    // On a tower: that loop's three shots and the reverse path to K0, then the other tower.
    const tower = this.manifest.view(viewId).tower;
    const loop = this.manifest.loop(tower);
    const loopShots = this.manifest.data.shots.filter((s) => loop.includes(s.from) && loop.includes(s.to));
    const pushIn = tower === 'A' ? 'shot-01' : 'shot-02';
    const otherPushIn = tower === 'A' ? 'shot-02' : 'shot-01';
    for (const s of loopShots) L.prefetchShot(s.id, PRIORITY.low);
    L.prefetchShot(pushIn, PRIORITY.low);
    L.prefetchShot(otherPushIn, PRIORITY.idle);
    for (const v of [...loop, 'K0']) L.still(v, PRIORITY.low);
    for (const v of loop) this.overlay.prefetch(v);

    // Decode the clips one click away: next and previous around the loop.
    const nextStep = this.planner.route(viewId, this.planner.step(viewId, 1))[0];
    const prevStep = this.planner.route(viewId, this.planner.step(viewId, -1))[0];
    L.frames(nextStep.shotId, { reverse: nextStep.reverse, priority: PRIORITY.low });
    if (decodeAhead) L.frames(prevStep.shotId, { reverse: prevStep.reverse, priority: PRIORITY.idle });
  }

  /** Starts decoding the shot for a likely next move (e.g. hovering a tower on K0). */
  warm(target) {
    if (this.busy || !target || target === this.view) return;
    const step = this.planner.route(this.view, target)[0];
    if (step) this.loader.frames(step.shotId, { reverse: step.reverse, priority: PRIORITY.high });
  }

  /* ---------- Layout ---------- */

  /** The cover-fit box of the current still, in CSS px relative to the stage. */
  get fit() {
    return this.player.layout(this.view);
  }

  /** Re-applies the framing (e.g. after the UI panel changed) and re-places the layers. */
  relayout() {
    this.player.redraw();
    this.#layoutLayers();
    this.emit('resize');
  }

  #layoutLayers() {
    const fit = this.fit;
    this.overlay.setBox(fit);
    this.towers.setBox(fit);
  }

  #bindResize() {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        this.player.resize();
        this.#layoutLayers();
        this.emit('resize');
      });
    };
    new ResizeObserver(onResize).observe(this.stage);
    window.addEventListener('orientationchange', onResize);
  }

  /** Mobile: swipe left/right steps around the tower loop. */
  #bindSwipe() {
    let start = null;
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.stage.addEventListener('pointerup', (e) => {
      if (!start || e.pointerType === 'mouse') return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) < CONFIG.swipeThreshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (!this.manifest.view(this.destination)?.tower) return;
      this.overlay.suppressClick();
      this.emit('swipe', { dir: dx < 0 ? 1 : -1 });
      if (dx < 0) this.next(); else this.prev();
    });
    this.stage.addEventListener('pointercancel', () => { start = null; });
  }
}
