import { Emitter } from '../core/emitter.js';
import { STATUS_LABEL, TYPE_LABEL, formatArea } from '../core/dom.js';

/**
 * The apartment overlay of a tower view: the cleaned SVG inlined above the canvas.
 * Status classes come from the unit feed; geometry and ids come from the SVG.
 *
 * Events: 'hover' {unit, path}, 'leave', 'select' {unit, path, via}
 */
export class OverlayLayer extends Emitter {
  #svgText = new Map();
  #suppressClickUntil = 0;
  view = null;
  svg = null;
  paths = new Map(); // id → <path>
  activeId = null;

  constructor(el, { manifest, store }) {
    super();
    this.el = el;
    this.manifest = manifest;
    this.store = store;
    this.#bindEvents();
  }

  /** Fetches the view's SVG (cached), without showing it. */
  prefetch(viewId) {
    if (!this.manifest.view(viewId)?.overlay) return null;
    if (!this.#svgText.has(viewId)) {
      const p = fetch(this.manifest.overlayUrl(viewId)).then((r) => {
        if (!r.ok) throw new Error(`Overlay ${viewId} failed (${r.status})`);
        return r.text();
      });
      p.catch(() => this.#svgText.delete(viewId));
      this.#svgText.set(viewId, p);
    }
    return this.#svgText.get(viewId);
  }

  async show(viewId) {
    const text = await this.prefetch(viewId);
    if (this.view !== viewId) this.#mount(viewId, text);
    this.applyStatuses();
    this.applyFilters();
    this.el.classList.add('is-visible');
  }

  hide() {
    this.el.classList.remove('is-visible');
    this.clearActive();
  }

  get visible() { return this.el.classList.contains('is-visible'); }

  setBox({ x, y, w, h }) {
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  #mount(viewId, text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = document.importNode(doc.documentElement, true);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'group');
    const tower = this.manifest.view(viewId).tower;
    svg.setAttribute('aria-label', `Tower ${tower} residences. Use the arrow keys to move between floors and apartments, Enter to open details.`);
    this.el.replaceChildren(svg);
    this.svg = svg;
    this.view = viewId;
    this.paths.clear();

    const orphans = [];
    for (const path of svg.querySelectorAll('.unit')) {
      const unit = this.store.get(path.id);
      if (!unit) {
        // A polygon with no data record is hidden and logged.
        path.classList.add('is-orphan');
        orphans.push(path.id);
        continue;
      }
      path.setAttribute('tabindex', '-1');
      path.setAttribute('role', 'button');
      this.paths.set(path.id, path);
    }
    if (orphans.length) console.warn(`[viewer] ${viewId}: ${orphans.length} polygon(s) without a unit record hidden`, orphans);

    // Roving tabindex: one apartment is in the tab order; arrows move within the overlay.
    const first = this.#ordered()[0];
    if (first) first.setAttribute('tabindex', '0');
  }

  /** Sets status classes, labels and sold-out floors from the unit feed. */
  applyStatuses() {
    if (!this.svg) return;
    for (const [id, path] of this.paths) {
      const u = this.store.get(id);
      path.classList.remove('unit--available', 'unit--reserved', 'unit--sold');
      path.classList.add(`unit--${u.status}`);
      path.setAttribute('aria-label', `Floor ${u.floor}, apartment ${u.unit}, ${TYPE_LABEL[u.type]}, ${formatArea(u.area_ft2)}, ${STATUS_LABEL[u.status]}`);
    }
    const tower = this.manifest.view(this.view).tower;
    for (const g of this.svg.querySelectorAll('.floor')) {
      g.classList.toggle('is-sold-out', this.store.isFloorSoldOut(tower, Number(g.dataset.floor)));
    }
  }

  /** Dims non-matching apartments, and floors with no match at all. */
  applyFilters() {
    if (!this.svg) return;
    const active = this.store.activeFilterCount > 0;
    for (const g of this.svg.querySelectorAll('.floor')) {
      let any = false;
      for (const path of g.querySelectorAll('.unit:not(.is-orphan)')) {
        const match = !active || this.store.matches(this.store.get(path.id));
        path.classList.toggle('is-dimmed', !match);
        any ||= match;
      }
      g.classList.toggle('is-dimmed', !any);
    }
  }

  /** Units in this view, for counts. */
  units() {
    return [...this.paths.keys()].map((id) => this.store.get(id));
  }

  setActive(id) {
    if (!this.svg) return;
    this.clearActive();
    const path = this.paths.get(id);
    if (!path) return;
    this.activeId = id;
    path.classList.add('is-active');
    path.parentNode.classList.add('is-hover');
    this.svg.classList.add('has-focus');
  }

  clearActive() {
    this.activeId = null;
    this.svg?.querySelectorAll('.is-active, .is-hover').forEach((n) => n.classList.remove('is-active', 'is-hover'));
    this.svg?.classList.remove('has-focus');
  }

  /** Bounding rect of an apartment's floor group, in viewport pixels. */
  floorRect(id) {
    return this.paths.get(id)?.parentNode.getBoundingClientRect();
  }

  /** Suppresses the click that follows a swipe gesture. */
  suppressClick(ms = 350) { this.#suppressClickUntil = performance.now() + ms; }

  focusUnit(id) {
    const path = this.paths.get(id);
    if (!path) return;
    this.svg.querySelectorAll('[tabindex="0"]').forEach((n) => n.setAttribute('tabindex', '-1'));
    path.setAttribute('tabindex', '0');
    path.focus({ preventScroll: true });
  }

  /* ---------- Interaction ---------- */

  #bindEvents() {
    const unitFrom = (e) => {
      const path = e.target.closest?.('.unit');
      return path && this.paths.has(path.id) ? path : null;
    };

    this.el.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || !this.visible) return;
      const path = unitFrom(e);
      if (path) this.emit('hover', { unit: this.store.get(path.id), path });
    });
    this.el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.emit('leave');
    });
    this.el.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (unitFrom(e) && !e.relatedTarget?.closest?.('.unit')) this.emit('leave');
    });
    this.el.addEventListener('click', (e) => {
      const path = unitFrom(e);
      if (!path || performance.now() < this.#suppressClickUntil) return;
      e.stopPropagation();
      this.emit('select', { unit: this.store.get(path.id), path, via: 'pointer' });
    });

    this.el.addEventListener('focusin', (e) => {
      const path = unitFrom(e);
      if (path && path.matches(':focus-visible')) this.emit('hover', { unit: this.store.get(path.id), path, via: 'keyboard' });
    });
    this.el.addEventListener('keydown', (e) => this.#onKey(e, unitFrom(e)));
  }

  #onKey(e, path) {
    if (!path) return;
    const unit = this.store.get(path.id);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.emit('select', { unit, path, via: 'keyboard' });
      return;
    }
    const target = this.#neighbour(path, e.key);
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      this.focusUnit(target.id);
      this.emit('hover', { unit: this.store.get(target.id), path: target, via: 'keyboard' });
    }
  }

  /** Units sorted top floor first, then left to right. */
  #ordered() {
    return [...this.paths.values()].sort((a, b) => {
      const fa = Number(a.dataset.floor); const fb = Number(b.dataset.floor);
      return fb - fa || this.#cx(a) - this.#cx(b);
    });
  }

  #cx(path) {
    if (path._cx === undefined) { const b = path.getBBox(); path._cx = b.x + b.width / 2; }
    return path._cx;
  }

  #neighbour(path, key) {
    const floor = Number(path.dataset.floor);
    const sameFloor = (f) => [...this.paths.values()].filter((p) => Number(p.dataset.floor) === f).sort((a, b) => this.#cx(a) - this.#cx(b));
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const row = sameFloor(floor);
      const i = row.indexOf(path) + (key === 'ArrowRight' ? 1 : -1);
      return row[i] ?? null;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const floors = [...new Set([...this.paths.values()].map((p) => Number(p.dataset.floor)))].sort((a, b) => a - b);
      const fi = floors.indexOf(floor) + (key === 'ArrowUp' ? 1 : -1);
      if (fi < 0 || fi >= floors.length) return null;
      const row = sameFloor(floors[fi]);
      const x = this.#cx(path);
      return row.reduce((best, p) => (Math.abs(this.#cx(p) - x) < Math.abs(this.#cx(best) - x) ? p : best), row[0]);
    }
    if (key === 'Home') return this.#ordered()[0];
    if (key === 'End') return this.#ordered().at(-1);
    return null;
  }
}
