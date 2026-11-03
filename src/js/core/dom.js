/** Small DOM and formatting helpers shared by all modules. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escapes text for safe use inside HTML template strings. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const STATUS_LABEL = { available: 'Available', reserved: 'Reserved', sold: 'Sold' };
export const TYPE_LABEL = { STUDIO: 'Studio', '1BR': '1BR', '2BR': '2BR', '3BR': '3BR', '4BR': '4BR' };
export const TYPE_LONG = { STUDIO: 'Studio', '1BR': '1 Bedroom', '2BR': '2 Bedroom', '3BR': '3 Bedroom', '4BR': '4 Bedroom' };

const nf = new Intl.NumberFormat('en-US');
export const formatNumber = (n) => nf.format(n);
export const formatArea = (n) => `${nf.format(n)} sq.ft`;
export const pad2 = (n) => String(n).padStart(2, '0');

export const isMobileLayout = () => window.matchMedia('(max-width: 767px)').matches;
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export const ICON_CLOSE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/** Shows an element with a CSS enter transition (.is-open), keeping `hidden` semantics. */
export function openAnimated(el) {
  if (!el.hidden && el.classList.contains('is-open')) return;
  clearTimeout(el._closeTimer);
  el.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
}

/** Hides an element after its exit transition. */
export function closeAnimated(el, duration = 260) {
  if (el.hidden) return;
  el.classList.remove('is-open');
  clearTimeout(el._closeTimer);
  el._closeTimer = setTimeout(() => { el.hidden = true; }, prefersReducedMotion() ? 0 : duration);
}
