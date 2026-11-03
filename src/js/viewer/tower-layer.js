import { Emitter } from '../core/emitter.js';
import { esc } from '../core/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * K0 overview, built to Figma "Residencies Check Image Container" (Default / Left / Right):
 *  • Default: a dark gradient over the sky (gray-950 at the top → clear at 53%) that
 *    leaves the towers bright, and a "Tower A" / "Tower B" pill beside each tower.
 *  • Hover (Left / Right): everything except the hovered tower is veiled in
 *    green-900 at 60% with a 2 px backdrop blur, through a rounded cut-out around the
 *    tower; the other tower's pill drops to 20%.
 * The window shapes are also the hover / click areas. All geometry is in 1920×1080
 * image coordinates (manifest), and the layer is placed with the canvas cover-fit.
 *
 * Events: 'hover' {tower|null}, 'leave', 'select' {tower, via}
 */
export class TowerLayer extends Emitter {
  hovered = null;

  constructor(el, { manifest }) {
    super();
    this.el = el;
    this.k0 = manifest.view('K0');
    this.stage = manifest.stage;
    this.#render();
    this.#bindEvents();
  }

  #render() {
    const { width: W, height: H } = this.stage;
    const towers = Object.entries(this.k0.towers);
    const frame = `M-40 -40H${W + 40}V${H + 40}H-40Z`;

    // 1. Sky gradient, masked so the towers stay bright (Figma: tower cut-out above the gradient).
    const sky = svg(`
      <defs>
        <linearGradient id="k0-sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#070a0d"/>
          <stop offset="0.532" stop-color="#070a0d" stop-opacity="0"/>
        </linearGradient>
        <filter id="k0-feather" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.5"/></filter>
        <mask id="k0-sky-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <rect width="${W}" height="${H}" fill="#fff"/>
          ${towers.map(([, t]) => `<path d="${roundedPath(t.roof, 4)}" fill="#000" filter="url(#k0-feather)"/>`).join('')}
        </mask>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#k0-sky-grad)" mask="url(#k0-sky-mask)"/>`, 'k0-sky');

    // 2. One veil per tower: full frame minus the rounded window (CSS mask keeps the backdrop blur).
    const veils = towers.map(([id, t]) => {
      const div = document.createElement('div');
      div.className = 'tower-veil';
      div.dataset.veil = id;
      const mask = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path fill="#fff" fill-rule="evenodd" d="${frame} ${roundedPath(t.window, 20)}"/></svg>`;
      const url = `url("data:image/svg+xml,${encodeURIComponent(mask)}")`;
      div.style.webkitMaskImage = url;
      div.style.maskImage = url;
      return div;
    });

    // 3. Hover / click areas: the same rounded windows.
    const hits = svg(towers.map(([id, t]) => `<path class="tower-hit" data-tower="${id}" d="${roundedPath(t.window, 20)}"/>`).join(''), 'k0-hits');

    // 4. Tower pills (Figma: Primary_Button).
    const labels = towers.map(([id, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tower-label tower-label--${t.labelSide}`;
      b.dataset.tower = id;
      // Compact layouts (portrait crop) centre the pill on the tower instead.
      const xs = t.window.map((q) => q[0]);
      const ys = t.window.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.3;
      b.style.setProperty('--x', pct(t.labelAnchor[0], W));
      b.style.setProperty('--y', pct(t.labelAnchor[1], H));
      b.style.setProperty('--cx', pct(cx, W));
      b.style.setProperty('--cy', pct(cy, H));
      b.innerHTML = `<span class="btn__dot btn__dot--green" aria-hidden="true"></span>${esc(t.label)}`;
      b.setAttribute('aria-label', `Explore ${t.label}`);
      return b;
    });

    this.el.replaceChildren(sky, ...veils, hits, ...labels);
  }

  #bindEvents() {
    const towerOf = (e) => e.target.closest?.('[data-tower]')?.dataset.tower ?? null;
    this.el.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'mouse') { const t = towerOf(e); if (t) this.setHover(t); }
    });
    this.el.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!e.relatedTarget?.closest?.('[data-tower]')) this.emit('leave');
    });
    this.el.addEventListener('focusin', (e) => { const t = towerOf(e); if (t) this.setHover(t); });
    this.el.addEventListener('focusout', (e) => { if (!e.relatedTarget?.closest?.('[data-tower]')) this.emit('leave'); });
    this.el.addEventListener('click', (e) => {
      const t = towerOf(e);
      if (!t) return;
      e.stopPropagation();
      this.emit('select', { tower: t, via: e.pointerType || (e.detail === 0 ? 'keyboard' : 'mouse') });
    });
  }

  /** Switches between the Default (null), Left (A) and Right (B) states. */
  setHover(tower) {
    if (tower === this.hovered) return;
    this.hovered = tower;
    this.el.querySelectorAll('[data-veil]').forEach((n) => n.classList.toggle('is-on', n.dataset.veil === tower));
    this.el.querySelectorAll('.tower-label').forEach((n) => {
      n.classList.toggle('is-dim', Boolean(tower) && n.dataset.tower !== tower);
      n.classList.toggle('is-active', n.dataset.tower === tower);
    });
    this.emit('hover', { tower });
  }

  show() { this.el.classList.add('is-visible'); this.el.inert = false; }
  hide() { this.el.classList.remove('is-visible'); this.el.inert = true; this.setHover(null); }

  setBox({ x, y, w, h }) {
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }
}

function svg(inner, className) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 1920 1080');
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', className);
  el.innerHTML = inner;
  return el;
}

const pct = (v, total) => `${(v / total) * 100}%`;

/** Closed polygon path with rounded corners (radius clamped to half of each edge). */
export function roundedPath(points, radius) {
  const n = points.length;
  const corner = (i) => {
    const p = points[i];
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    const toward = (q) => {
      const dx = q[0] - p[0]; const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy);
      const r = Math.min(radius, len / 2);
      return [p[0] + (dx / len) * r, p[1] + (dy / len) * r];
    };
    return { p, in: toward(a), out: toward(b) };
  };
  const cs = points.map((_, i) => corner(i));
  const f = (q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  let d = `M${f(cs[0].out)}`;
  for (let i = 1; i <= n; i++) {
    const c = cs[i % n];
    d += `L${f(c.in)}Q${f(c.p)} ${f(c.out)}`;
  }
  return `${d}Z`;
}
