import { $, esc, isMobileLayout, canHover } from '../core/dom.js';

/**
 * The Action Container at the bottom (Figma: 2.1 "Select Your Tower"), reused on the
 * tower views for moving around the tower: ‹ Tower A · Park ¾ ● ○ ○ ›.
 * Also the first-visit hint and the screen-reader announcer.
 */
export class ViewControls {
  #hintShown = false;
  #hintTimer = 0;

  constructor(root, { viewer, manifest, store }) {
    this.root = root;
    this.viewer = viewer;
    this.manifest = manifest;
    this.store = store;
    this.bar = $('[data-action-bar]', root);
    this.title = $('[data-view-title]', root);
    this.dots = $('[data-view-dots]', root);
    this.prev = $('[data-action="prev"]', root);
    this.next = $('[data-action="next"]', root);
    this.hint = $('[data-hint]', root);
    this.announcer = $('[data-announcer]', root);
    this.#bind();
  }

  #bind() {
    const v = this.viewer;
    this.prev.addEventListener('click', () => v.prev());
    this.next.addEventListener('click', () => v.next());
    this.dots.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (b) v.go(b.dataset.view);
    });
    v.on('transition:start', ({ to }) => { this.render(to, true); this.hideHint(); });
    v.on('queued', ({ target }) => { if (target) this.render(target, true); });
    v.on('view', ({ view }) => { this.render(view, false); this.#announceView(view); this.#maybeHint(view); });
  }

  /** Updates the bar for a view (the destination while a clip plays). */
  render(viewId, moving) {
    const view = this.manifest.view(viewId);
    const atTower = Boolean(view.tower);
    this.bar.classList.toggle('is-tower', atTower);
    this.title.innerHTML = atTower
      ? `<small>Tower ${esc(view.tower)}</small>${esc(view.name)}`
      : (moving ? 'Overview' : 'Select Your Tower');
    this.prev.hidden = this.next.hidden = this.dots.hidden = !atTower;
    if (!atTower) return;
    const loop = this.manifest.loop(view.tower);
    this.next.setAttribute('aria-label', `Next view: ${this.manifest.view(this.viewer.planner.step(viewId, 1)).name}`);
    this.prev.setAttribute('aria-label', `Previous view: ${this.manifest.view(this.viewer.planner.step(viewId, -1)).name}`);
    this.dots.innerHTML = loop.map((id) => {
      const v = this.manifest.view(id);
      return `<li><button type="button" data-view="${id}" aria-label="${esc(`Tower ${v.tower} · ${v.name}`)}"${id === viewId ? ' aria-current="true"' : ''}></button></li>`;
    }).join('');
  }

  announce(text) {
    this.announcer.textContent = '';
    requestAnimationFrame(() => { this.announcer.textContent = text; });
  }

  #announceView(viewId) {
    if (viewId === 'K0') { this.announce('Find your residence. Choose Tower A or Tower B.'); return; }
    const s = this.store.stats(this.store.forTower(this.manifest.view(viewId).tower));
    this.announce(`${this.manifest.viewTitle(viewId)} view. ${s.available} of ${s.total} residences available.`);
  }

  #maybeHint(viewId) {
    if (this.#hintShown || viewId === 'K0') return;
    this.#hintShown = true;
    this.hint.textContent = isMobileLayout() || !canHover()
      ? 'Tap an apartment for details · swipe to move around'
      : 'Hover an apartment for details · click to keep the card open · ← → to move around';
    this.hint.classList.add('is-visible');
    this.#hintTimer = setTimeout(() => this.hideHint(), 5000);
  }

  hideHint() {
    clearTimeout(this.#hintTimer);
    this.hint.classList.remove('is-visible');
  }
}
