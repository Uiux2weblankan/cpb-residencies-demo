import { CONFIG } from '../config.js';
import {
  esc, STATUS_LABEL, TYPE_LABEL, TYPE_LONG, ICON_CLOSE, formatArea, isMobileLayout, openAnimated, closeAnimated,
} from '../core/dom.js';
import { clamp } from '../viewer/fit.js';

/**
 * Hover Floor Card (Figma: Hover Floor Card ##).
 *  • Desktop: hovering an apartment previews the card beside its floor; clicking pins it.
 *  • Mobile: tapping an apartment opens the card as a bottom sheet.
 */
export class FloorCard {
  unit = null;
  pinned = false;
  #hideTimer = 0;
  #returnFocusTo = null;

  constructor(el, { backdrop, viewer, store, manifest, getAvoidRect }) {
    this.el = el;
    this.backdrop = backdrop;
    this.viewer = viewer;
    this.store = store;
    this.manifest = manifest;
    this.getAvoidRect = getAvoidRect;
    this.#bind();
  }

  get isOpen() { return !this.el.hidden; }

  /** Desktop hover or keyboard focus: show without pinning. */
  preview(unit) {
    if (this.pinned || isMobileLayout()) return;
    this.cancelHide();
    this.#show(unit, false);
  }

  /** Click / tap / Enter: keep the card open until closed. */
  pin(unit, { via } = {}) {
    this.cancelHide();
    this.pinned = true;
    this.#returnFocusTo = via === 'keyboard' ? unit.id : null;
    this.#show(unit, true);
    if (via === 'keyboard') this.el.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  scheduleHide() {
    if (this.pinned) return;
    clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => this.close(), CONFIG.hoverHideDelayMs);
  }

  cancelHide() { clearTimeout(this.#hideTimer); }

  close({ restoreFocus = true } = {}) {
    if (!this.isOpen) return;
    const focusId = this.#returnFocusTo;
    this.pinned = false;
    this.unit = null;
    this.#returnFocusTo = null;
    this.el.classList.remove('is-pinned', 'is-sheet');
    closeAnimated(this.el);
    closeAnimated(this.backdrop);
    this.viewer.overlay.clearActive();
    if (restoreFocus && focusId) this.viewer.overlay.focusUnit(focusId);
  }

  /** Re-renders after a status change in the feed. */
  refresh() {
    if (this.unit) this.#show(this.store.get(this.unit.id), this.pinned);
  }

  /** Re-positions after a resize. */
  reposition() {
    if (this.unit && !isMobileLayout()) this.#position();
  }

  #show(unit, pinned) {
    // Only at rest on a tower view (a hover can still arrive as a clip starts).
    if (this.viewer.busy || !this.manifest.view(this.viewer.view)?.tower) return;
    this.unit = unit;
    const sheet = isMobileLayout();
    this.el.classList.toggle('is-pinned', pinned);
    this.el.classList.toggle('is-sheet', sheet);
    this.el.setAttribute('aria-modal', sheet ? 'true' : 'false');
    this.el.innerHTML = this.#template(unit, pinned || sheet);
    this.viewer.overlay.setActive(unit.id);
    if (sheet) {
      this.el.style.left = this.el.style.top = '';
      openAnimated(this.backdrop);
    } else {
      closeAnimated(this.backdrop);
    }
    openAnimated(this.el);
    if (!sheet) this.#position();
  }

  #template(u, closable) {
    const view = this.manifest.view(this.viewer.view);
    const soldOut = this.store.isFloorSoldOut(u.tower, u.floor);
    return `
      ${closable ? `<button class="card-close" type="button" data-close aria-label="Close details">${ICON_CLOSE}</button>` : ''}
      <div class="floor-card__body">
        <p class="floor-card__eyebrow">Tower ${esc(u.tower)} · ${esc(view?.name ?? '')} view${soldOut ? ' · Floor sold out' : ''}</p>
        <div class="floor-card__header">
          <h2 class="display floor-card__title" id="floor-card-title">Floor ${u.floor}</h2>
          <span class="pill pill--${u.status}">${STATUS_LABEL[u.status]}</span>
        </div>
        <div>
          <div class="options">
            <span><span class="options__label">Apartment No</span>: ${esc(u.unit)}</span>
            <i class="options__divider" aria-hidden="true"></i>
            <span>${TYPE_LABEL[u.type]}</span>
          </div>
          <p class="floor-card__meta">${TYPE_LONG[u.type]} · ${formatArea(u.area_ft2)} · Ref. ${esc(u.id)}</p>
        </div>
        <figure class="floor-card__plan">
          <img src="${esc(u.plan_url)}" alt="Illustrative floor plan, ${TYPE_LONG[u.type]}" width="326" height="287" loading="lazy">
          <div class="floor-card__plan-overlay">
            <a class="btn btn--secondary btn--sm" href="${esc(u.page_url)}"><span class="btn__dot" aria-hidden="true"></span>More Info</a>
          </div>
          <figcaption>Illustrative plan</figcaption>
        </figure>
        <a class="btn btn--secondary btn--block" href="contact.html?unit=${encodeURIComponent(u.id)}">
          <span class="btn__dot" aria-hidden="true"></span>Contact Us for More Info
        </a>
      </div>`;
  }

  /**
   * Places the card beside the tower, level with the floor, arrow pointing at it,
   * keeping clear of the filter panel and the bottom controls.
   */
  #position() {
    const root = this.viewer.root.getBoundingClientRect();
    const floor = this.viewer.overlay.floorRect(this.unit.id);
    if (!floor) return;
    const fit = this.viewer.fit;
    const [bx0, , bx1] = this.manifest.view(this.viewer.view).bounds;
    const towerLeft = fit.x + bx0 * fit.scale;
    const towerRight = fit.x + bx1 * fit.scale;
    const floorY = floor.top + floor.height / 2 - root.top;

    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const gap = 30;
    const margin = 16;
    let minX = margin;
    let maxX = root.width - margin;
    const avoid = this.getAvoidRect?.();
    if (avoid) {
      const aL = avoid.left - root.left;
      const aR = avoid.right - root.left;
      if (aL < root.width / 2) minX = Math.max(minX, aR + margin); else maxX = Math.min(maxX, aL - margin);
    }

    let side = 'right';
    let x = towerRight + gap;
    if (x + w > maxX) {
      side = 'left';
      x = towerLeft - gap - w;
    }
    if (x < minX) { side = 'none'; x = clamp(maxX - w, margin, root.width - w - margin); }

    const headerEl = document.body.classList.contains('show-header') ? document.querySelector('.site-header__logo') : null;
    const header = (headerEl?.getBoundingClientRect().bottom ?? root.top + 16) - root.top;
    const top = Math.min(header + 8, root.height * 0.2);
    // Keep clear of the controls at the bottom of the viewer.
    const controls = this.viewer.root.querySelector('[data-controls]')?.getBoundingClientRect();
    const bottom = controls ? controls.top - root.top - 12 : root.height - 120;
    const y = clamp(floorY - 44, top, Math.max(top, bottom - h));

    this.el.dataset.side = side;
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.el.style.setProperty('--arrow-y', `${clamp(floorY - y, 28, h - 28)}px`);
  }

  #bind() {
    this.el.addEventListener('pointerenter', () => this.cancelHide());
    this.el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.scheduleHide(); });
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.close();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    });
    this.backdrop.addEventListener('click', () => this.close({ restoreFocus: false }));
  }
}
