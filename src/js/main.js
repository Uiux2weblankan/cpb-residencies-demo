import { CONFIG } from './config.js';
import { $, canHover, isMobileLayout, openAnimated, closeAnimated } from './core/dom.js';
import { Manifest } from './data/manifest.js';
import { UnitStore } from './data/unit-store.js';
import { Viewer } from './viewer/viewer.js';
import { FloorCard } from './ui/floor-card.js';
import { TowerCard } from './ui/tower-card.js';
import { TowerPanel } from './ui/tower-panel.js';
import { ViewControls } from './ui/view-controls.js';
import { initSiteMenu } from './ui/site-menu.js';

/**
 * Check Availability page.
 *  2.1   (K0): "Find Your Residence"; hover a tower for its card, click to fly in.
 *  2.1.1 (tower views): "Tower A | Availability" panel with filters; apartments coloured
 *        by status; hover one to highlight its floor and preview its card, click to pin it.
 * Deep links: ?view=A2 opens a view; ?unit=A-25-U07 also opens that residence.
 */
const root = $('[data-viewer]');
initSiteMenu();
// Header only on the overview: decide before the first paint to avoid a flash on deep links.
const startParam = new URLSearchParams(location.search).get('view')?.toUpperCase();
document.body.classList.toggle('show-header', !startParam || startParam === 'K0');
boot();

async function boot() {
  if (location.protocol === 'file:') {
    fail('This demo loads its data with fetch(), so it must be served over http. Run "node scripts/serve.mjs" and open http://localhost:8080.');
    return;
  }

  let manifest; let store;
  try {
    [manifest, store] = await Promise.all([
      Manifest.load(CONFIG.manifestUrl, CONFIG.publicBase),
      new UnitStore().load(CONFIG.unitsUrl),
    ]);
  } catch (err) {
    console.error(err);
    fail('The residences could not be loaded. Run the asset scripts (node scripts/build-all.mjs), then reload.');
    return;
  }

  const viewer = new Viewer(root, { manifest, store });
  const backdrop = $('[data-sheet-backdrop]', root);
  const k0Title = $('[data-k0-title]', root);
  const controls = new ViewControls(root, { viewer, manifest, store });
  const panel = new TowerPanel($('[data-tower-panel]', root), { viewer, store, manifest });
  const floorCard = new FloorCard($('[data-floor-card]', root), {
    backdrop, viewer, store, manifest,
    getAvoidRect: () => panel.avoidRect(),
  });
  panel.onLayoutChange = () => floorCard.reposition();
  // Frame every tower view so the tower stays clear of the panel (same rule in every angle).
  viewer.player.exclusion = (viewId) => panel.exclusion(viewId);
  const scrim = $('[data-tower-scrim]', root);
  const towerCard = new TowerCard($('[data-tower-card]', root), {
    backdrop, store, manifest,
    getFit: () => viewer.fit,
    onExplore: (tower) => viewer.go(manifest.loop(tower)[0]),
    onHide: () => viewer.towers.setHover(null),
  });

  /* ---------- 2.1 · K0 (Figma: Residencies Check Image Container) ---------- */
  viewer.towers.on('hover', ({ tower }) => {
    root.classList.toggle('is-k0-hover', Boolean(tower));
    if (!tower) return;
    viewer.warm(manifest.loop(tower)[0]); // start decoding the push-in on hover intent
    if (canHover() && !isMobileLayout()) towerCard.show(tower);
  });
  viewer.towers.on('leave', () => towerCard.scheduleHide());
  viewer.towers.on('select', ({ tower, via }) => {
    const touch = via === 'touch' || via === 'pen' || isMobileLayout();
    if (touch && towerCard.tower !== tower) {
      // First tap shows the card; "Explore Tower" or a second tap flies in.
      viewer.towers.setHover(tower);
      towerCard.show(tower);
      return;
    }
    towerCard.hide();
    viewer.go(manifest.loop(tower)[0]);
  });

  /* ---------- 2.1.1 · apartments: hover previews the card, click / tap pins it ---------- */
  const o = viewer.overlay;
  o.on('hover', ({ unit }) => floorCard.preview(unit));
  o.on('leave', () => floorCard.scheduleHide());
  o.on('select', ({ unit, via }) => {
    panel.closeSheet();
    controls.hideHint();
    floorCard.pin(unit, { via });
  });

  /* ---------- Lifecycle ---------- */
  const syncChrome = (viewId, moving) => {
    const tower = manifest.view(viewId).tower;
    document.body.classList.toggle('show-header', !tower);
    if (tower) {
      closeAnimated(k0Title, 400);
      panel.placeFor(viewId);
      scrim.dataset.side = panel.sideFor(viewId);
      scrim.classList.add('is-on');
      panel.show(tower);
    } else {
      scrim.classList.remove('is-on');
      panel.hide();
      if (!moving) openAnimated(k0Title);
    }
  };
  viewer.on('transition:start', ({ to }) => {
    floorCard.close({ restoreFocus: false });
    towerCard.hide();
    syncChrome(to, true);
  });
  viewer.on('queued', ({ target }) => { if (target) syncChrome(target, true); });
  viewer.on('view', ({ view }) => {
    syncChrome(view, false);
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    url.searchParams.delete('unit');
    history.replaceState(null, '', url);
  });
  viewer.on('resize', () => {
    if (manifest.view(viewer.view)?.tower) panel.placeFor(viewer.view);
    floorCard.reposition();
    if (towerCard.tower) towerCard.place();
  });

  const repaint = () => {
    o.applyStatuses();
    o.applyFilters();
    floorCard.refresh();
    towerCard.refresh();
  };
  store.on('status', repaint);
  store.on('reset', repaint);
  store.on('filters', () => o.applyFilters());

  /* ---------- Dismissal and keyboard ---------- */
  $('[data-stage]', root).addEventListener('click', () => {
    floorCard.close({ restoreFocus: false });
    if (isMobileLayout()) towerCard.hide();
  });
  panel.el.querySelector('[data-action="overview"]').addEventListener('click', () => viewer.overview());
  panel.el.querySelector('[data-action="switch-tower"]').addEventListener('click', () => viewer.switchTower());

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t.closest?.('input, select, textarea, .site-menu')) return;
    if (e.key === 'Escape') {
      if (floorCard.isOpen) floorCard.close();
      else if (panel.box.classList.contains('is-open')) panel.closeSheet();
      else towerCard.hide();
      return;
    }
    // ← → move around the tower, unless focus is on an apartment (arrows move between apartments there).
    if (t.closest?.('.overlay-svg, [data-filter-box]')) return;
    if (!manifest.view(viewer.destination).tower) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); viewer.next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); viewer.prev(); }
  });

  /* ---------- Start ---------- */
  const params = new URLSearchParams(location.search);
  const linkedUnit = store.get((params.get('unit') || '').toUpperCase());
  let start = params.get('view')?.toUpperCase() || 'K0';
  if (linkedUnit && !linkedUnit.views.includes(start)) start = linkedUnit.views[0];

  setLoaderText('Preparing the view…');
  try {
    await viewer.init(start);
  } catch (err) {
    console.error(err);
    fail('The viewer could not start. Please reload the page.');
    return;
  }
  if (linkedUnit && o.paths.has(linkedUnit.id)) floorCard.pin(linkedUnit);

  window.cpbViewer = { viewer, store, manifest };
}

function setLoaderText(text) {
  $('[data-loader-text]', root).textContent = text;
}

function fail(message) {
  document.body.classList.add('show-header');
  root.dataset.state = 'error';
  setLoaderText(message);
}
