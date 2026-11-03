import { CONFIG } from '../config.js';
import { esc, ICON_CLOSE, isMobileLayout, openAnimated, closeAnimated } from '../core/dom.js';
import { clamp } from '../viewer/fit.js';

/** Card labels for residence types (Figma lists 1BR · 2BR · 3BR · Sky Villas; 4BR are the Sky Villas). */
const CARD_TYPES = [['1BR', '1BR'], ['2BR', '2BR'], ['3BR', '3BR'], ['4BR', 'Sky Villas']];

/**
 * Hover Tower Card (Figma: Residencies Check Image Container › Hover Tower Card).
 *  • Desktop: placed where the Figma frame puts it (Tower A: left 100; Tower B: right edge 1820;
 *    top 431), mapped through the canvas cover-fit; it rises 40 px and fades in.
 *  • Mobile: bottom sheet.
 */
export class TowerCard {
  tower = null;
  #hideTimer = 0;

  constructor(el, { backdrop, store, manifest, getFit, onExplore, onHide }) {
    this.el = el;
    this.backdrop = backdrop;
    this.store = store;
    this.manifest = manifest;
    this.getFit = getFit;
    this.onExplore = onExplore;
    this.onHide = onHide;
    this.#bind();
  }

  show(tower) {
    clearTimeout(this.#hideTimer);
    if (!tower) { this.scheduleHide(); return; }
    if (tower !== this.tower || this.el.hidden) {
      this.tower = tower;
      this.el.dataset.tower = tower;
      this.el.innerHTML = this.#template(tower);
    }
    if (isMobileLayout()) openAnimated(this.backdrop);
    this.el.hidden = false;
    this.place();
    openAnimated(this.el);
  }

  scheduleHide() {
    clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => this.hide(), CONFIG.hoverHideDelayMs);
  }

  cancelHide() { clearTimeout(this.#hideTimer); }

  hide() {
    clearTimeout(this.#hideTimer);
    this.tower = null;
    closeAnimated(this.el, 460);
    closeAnimated(this.backdrop);
    document.querySelectorAll('.tower-label.is-covered').forEach((n) => n.classList.remove('is-covered'));
    this.onHide?.();
  }

  refresh() { if (this.tower && !this.el.hidden) this.el.innerHTML = this.#template(this.tower); }

  #template(tower) {
    const units = this.store.forTower(tower);
    const available = units.filter((u) => u.status === 'available');
    const present = new Set(units.map((u) => u.type));
    const types = CARD_TYPES.filter(([t]) => present.has(t));
    const label = this.manifest.view('K0').towers[tower].label;
    return `
      ${isMobileLayout() ? `<button class="card-close" type="button" data-close aria-label="Close">${ICON_CLOSE}</button>` : ''}
      <h2 class="visually-hidden">${esc(label)}</h2>
      <div class="tower-card__header">
        <span class="display tower-card__count">${available.length}</span>
        <div class="tower-card__info">
          <span class="display tower-card__apartments">Apartments</span>
          <span class="tower-card__available">Available</span>
        </div>
      </div>
      <div class="tower-card__body">
        <div class="tower-card__info-group">
          <p class="tower-card__kicker">Luxury Residences</p>
          <div class="options" aria-label="Residence types">
            ${types.map(([, name], i) => `${i ? '<i class="options__divider" aria-hidden="true"></i>' : ''}<span>${name}</span>`).join('')}
          </div>
        </div>
        <button class="btn btn--secondary btn--block" type="button" data-explore>
          <span class="btn__dot" aria-hidden="true"></span>Explore Tower
        </button>
      </div>`;
  }

  /**
   * Maps the Figma position through the cover-fit. On viewports too narrow for the
   * card and the tower pill side by side, the card is kept on screen and covers the
   * pill (which is then hidden; the veil already marks the tower).
   */
  place() {
    const tower = this.tower;
    const label = document.querySelector(`.tower-label[data-tower="${tower}"]`);
    label?.classList.remove('is-covered');
    if (!tower || isMobileLayout() || !this.el.offsetParent) {
      this.el.style.left = this.el.style.top = '';
      return;
    }
    const fit = this.getFit();
    const pos = this.manifest.view('K0').towers[tower].card;
    const root = this.el.offsetParent.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const margin = 24;
    const headerBottom = (document.querySelector('.site-header__logo')?.getBoundingClientRect().bottom ?? root.top) - root.top;

    let left = pos.left != null ? fit.x + pos.left * fit.scale : fit.x + pos.right * fit.scale - w;
    let top = fit.y + pos.top * fit.scale;
    left = clamp(left, margin, root.width - w - margin);
    top = clamp(top, Math.max(margin, headerBottom + 8), Math.max(margin, root.height - h - margin));

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.setProperty('--rise', `${Math.round(40 * fit.scale)}px`);

    if (label) {
      const l = label.getBoundingClientRect();
      const overlaps = l.right - root.left > left && l.left - root.left < left + w;
      label.classList.toggle('is-covered', overlaps);
    }
  }

  #bind() {
    this.el.addEventListener('pointerenter', () => this.cancelHide());
    this.el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.scheduleHide(); });
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-explore]')) { const t = this.tower; this.hide(); this.onExplore(t); }
      else if (e.target.closest('[data-close]')) this.hide();
    });
    this.backdrop.addEventListener('click', () => { if (this.tower) this.hide(); });
  }
}
