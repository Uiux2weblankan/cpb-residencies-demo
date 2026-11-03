import { formatNumber, STATUS_LABEL, isMobileLayout, openAnimated, closeAnimated } from '../core/dom.js';
import { TYPES } from '../data/unit-store.js';

const COLLAPSED_KEY = 'cpb-filters-hidden';

const ROOM_LABEL = { STUDIO: 'Studio', '1BR': '1', '2BR': '2', '3BR': '3', '4BR': '4' };
const ROOM_ARIA = { STUDIO: 'Studio', '1BR': '1 bedroom', '2BR': '2 bedrooms', '3BR': '3 bedrooms', '4BR': '4 bedrooms (Sky Villas)' };

/**
 * 2.1.1 Tower Check Availability: Back, "Tower A | Availability" and the filter box
 * (Price and Area range sliders, Rooms). Sits on the side of the screen away from
 * the tower; on mobile the filter box opens as a bottom sheet.
 */
export class TowerPanel {
  tower = null;

  constructor(el, { viewer, store, manifest }) {
    this.el = el;
    this.viewer = viewer;
    this.store = store;
    this.manifest = manifest;
    this.title = el.querySelector('[data-tower-name]');
    this.switchBtn = el.querySelector('[data-action="switch-tower"]');
    this.box = el.querySelector('[data-filter-box]');
    this.filtersBtn = el.querySelector('[data-action="filters"]');
    // Label of the Show / Hide button (falls back to the first <span> on older markup).
    this.filtersLabel = el.querySelector('[data-filters-label]') ?? this.filtersBtn.querySelector('span:not([data-filter-count])');
    this.onLayoutChange = null;
    // Desktop / tablet: the filter box can be hidden so it doesn't cover the view.
    this.collapsed = localStorage.getItem(COLLAPSED_KEY) === '1';
    this.#bind();
    this.#syncToggle();
  }

  /** Shows or hides the filter box (desktop / tablet). The choice is remembered. */
  setCollapsed(collapsed) {
    this.collapsed = collapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    this.#syncToggle();
    // Let the floor card use the freed space once the box has faded.
    setTimeout(() => this.onLayoutChange?.(), 320);
  }

  #syncToggle() {
    const mobile = isMobileLayout();
    this.el.classList.toggle('is-collapsed', !mobile && this.collapsed);
    if (mobile) {
      this.filtersLabel.textContent = 'Filters';
      this.filtersBtn.setAttribute('aria-expanded', String(this.box.classList.contains('is-open')));
    } else {
      this.filtersLabel.textContent = this.collapsed ? 'Show filters' : 'Hide filters';
      this.filtersBtn.setAttribute('aria-expanded', String(!this.collapsed));
    }
  }

  /** Shows the panel for a tower (also during the flight to it). */
  show(tower) {
    if (tower !== this.tower) {
      this.tower = tower;
      this.title.textContent = `Tower ${tower}`;
      const other = tower === 'A' ? 'B' : 'A';
      (this.switchBtn.querySelector('[data-switch-label]') ?? this.switchBtn.querySelector('span:last-child')).textContent = `Tower ${other}`;
      this.switchBtn.setAttribute('aria-label', `Switch to Tower ${other}`);
      this.#renderFilters();
    }
    openAnimated(this.el);
  }

  hide() { closeAnimated(this.el, 400); this.closeSheet(); }

  /**
   * One side per tower, mirrored: Tower A on the left (as in Figma 2.1.1), Tower B on
   * the right, in every angle. Each view is then framed so its tower stays clear of
   * the panel (see exclusion()).
   */
  sideFor(viewId) {
    if (isMobileLayout()) return 'left';
    return this.manifest.view(viewId)?.tower === 'B' ? 'right' : 'left';
  }

  placeFor(viewId) {
    this.#syncToggle();
    this.el.dataset.side = this.sideFor(viewId);
  }

  /**
   * Screen band the tower must stay out of, in CSS px: gutter + panel width, mirroring
   * the CSS sizes (left = --gutter, width = clamp(420px, 31.25vw, 600px)). The band is
   * the same whether the filter box is shown or hidden, so the framing never jumps.
   */
  exclusion(viewId) {
    const view = this.manifest.view(viewId);
    if (!view?.tower || isMobileLayout()) return null;
    const vw = this.viewer.root.clientWidth;
    const gutter = Math.min(100, Math.max(16, vw * 0.052));
    const width = Math.min(600, Math.max(420, vw * 0.3125));
    return { side: this.sideFor(viewId), size: gutter + width };
  }

  /** Rect the floor card should keep clear of (desktop). */
  avoidRect() {
    if (this.el.hidden || isMobileLayout()) return null;
    if (!this.collapsed) return this.el.getBoundingClientRect();
    // Filter box hidden: only the buttons and the title take space.
    const rects = [...this.el.children].filter((n) => n !== this.box).map((n) => n.getBoundingClientRect());
    return {
      left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  }

  openSheet() { openAnimated(this.box); this.filtersBtn.setAttribute('aria-expanded', 'true'); }
  closeSheet() {
    if (!isMobileLayout()) return;
    closeAnimated(this.box);
    this.filtersBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- Filters ---------- */

  #renderFilters() {
    const r = this.store.ranges(this.tower);
    this.ranges = r;
    const types = TYPES.filter((t) => this.store.forTower(this.tower).some((u) => u.type === t));
    this.box.querySelector('[data-rows]').innerHTML = `
      ${this.#range('price', 'Price', r.price, 10000)}
      ${this.#range('area', 'Area, m<sup>2</sup>', r.area, 1)}
      <div class="filter-row">
        <span class="filter-row__label" id="rooms-label">Rooms</span>
        <div class="rooms" role="group" aria-labelledby="rooms-label">
          ${types.map((t) => `<button type="button" class="rooms__option" data-room="${t}" aria-pressed="false" aria-label="${ROOM_ARIA[t]}"><span class="gold-text">${ROOM_LABEL[t]}</span></button>`).join('')}
        </div>
      </div>`;
    this.#sync();
  }

  #range(key, label, [min, max], step) {
    return `
      <div class="filter-row">
        <span class="filter-row__label" id="${key}-label">${label}</span>
        <div class="range" data-range="${key}" style="--lo:0;--hi:1">
          <div class="range__values">
            <span><small>From</small> <output class="gold-text" data-out="lo"></output></span>
            <span><small>To</small> <output class="gold-text" data-out="hi"></output></span>
          </div>
          <div class="range__track">
            <input type="range" min="${min}" max="${max}" step="${step}" value="${min}" data-thumb="lo" aria-label="Minimum ${label.replace(/<[^>]+>/g, '')}">
            <input type="range" min="${min}" max="${max}" step="${step}" value="${max}" data-thumb="hi" aria-label="Maximum ${label.replace(/<[^>]+>/g, '')}">
          </div>
        </div>
      </div>`;
  }

  #format(key, v) { return key === 'price' ? `$ ${formatNumber(v)}` : formatNumber(v); }

  /** Store → controls (values, filled segment, room toggles, result line). */
  #sync() {
    for (const range of this.box.querySelectorAll('[data-range]')) {
      const key = range.dataset.range;
      const [min, max] = this.ranges[key];
      const [lo, hi] = this.store.filters[key] ?? [min, max];
      const loIn = range.querySelector('[data-thumb="lo"]');
      const hiIn = range.querySelector('[data-thumb="hi"]');
      loIn.value = lo; hiIn.value = hi;
      range.style.setProperty('--lo', ((lo - min) / (max - min)).toFixed(4));
      range.style.setProperty('--hi', ((hi - min) / (max - min)).toFixed(4));
      range.querySelector('[data-out="lo"]').textContent = this.#format(key, lo);
      range.querySelector('[data-out="hi"]').textContent = this.#format(key, hi);
      loIn.setAttribute('aria-valuetext', this.#format(key, lo));
      hiIn.setAttribute('aria-valuetext', this.#format(key, hi));
    }
    for (const b of this.box.querySelectorAll('[data-room]')) {
      b.setAttribute('aria-pressed', String(this.store.filters.rooms.has(b.dataset.room)));
    }
    this.renderResult();
  }

  renderResult() {
    if (!this.tower) return;
    const units = this.store.forTower(this.tower);
    const matching = units.filter((u) => this.store.matches(u));
    const s = this.store.stats(matching);
    const n = this.store.activeFilterCount;
    this.box.querySelector('[data-result]').innerHTML = n
      ? `<strong>${s.available}</strong> available of ${matching.length} matching residences`
      : `<strong>${s.available}</strong> of ${units.length} residences available`;
    this.box.querySelector('[data-clear]').disabled = n === 0;
    const count = this.filtersBtn.querySelector('[data-filter-count]');
    count.hidden = n === 0;
    count.textContent = n;
    this.box.querySelector('[data-legend]').innerHTML = ['available', 'reserved', 'sold']
      .map((k) => `<li><span class="status-dot status-dot--${k}" aria-hidden="true"></span>${STATUS_LABEL[k]}</li>`).join('');
  }

  #bind() {
    this.box.addEventListener('input', (e) => {
      const input = e.target.closest('[data-thumb]');
      if (!input) return;
      const range = input.closest('[data-range]');
      const key = range.dataset.range;
      const [min, max] = this.ranges[key];
      let lo = Number(range.querySelector('[data-thumb="lo"]').value);
      let hi = Number(range.querySelector('[data-thumb="hi"]').value);
      // Thumbs cannot cross.
      if (lo > hi) { if (input.dataset.thumb === 'lo') lo = hi; else hi = lo; }
      this.store.setRange(key, lo === min && hi === max ? null : [lo, hi]);
    });
    this.box.addEventListener('click', (e) => {
      const room = e.target.closest('[data-room]');
      if (room) this.store.toggleRoom(room.dataset.room);
      if (e.target.closest('[data-clear]')) this.store.clearFilters();
      if (e.target.closest('[data-close-sheet]')) this.closeSheet();
    });
    this.filtersBtn.addEventListener('click', () => {
      if (!isMobileLayout()) { this.setCollapsed(!this.collapsed); return; }
      if (this.box.classList.contains('is-open')) this.closeSheet(); else this.openSheet();
    });
    this.store.on('filters', () => this.#sync());
    this.store.on('status', () => this.renderResult());
    this.store.on('reset', () => this.renderResult());
  }
}
