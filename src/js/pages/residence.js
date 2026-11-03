import { CONFIG } from '../config.js';
import { $, esc, STATUS_LABEL, TYPE_LONG, formatArea, formatNumber } from '../core/dom.js';
import { UnitStore, areaM2 } from '../data/unit-store.js';
import { initSiteMenu } from '../ui/site-menu.js';

/** 2.2.1 Residence Inner (demo): details of one residence, from the same unit feed. */
initSiteMenu();
render();

const VIEW_NAMES = { A1: 'Park ¾', A2: 'West flank', A3: 'Street front', B1: 'Park ¾', B2: 'East flank', B3: 'Street front' };

async function render() {
  const main = $('[data-residence]');
  const id = (new URLSearchParams(location.search).get('unit') || '').toUpperCase();
  let store;
  try {
    store = await new UnitStore().load(CONFIG.unitsUrl);
  } catch {
    main.innerHTML = '<p class="notice">Residence data could not be loaded. Serve the demo over http (see README).</p>';
    return;
  }
  const u = store.get(id);
  if (!u) {
    main.innerHTML = `
      <p class="notice">We could not find residence “${esc(id || 'none')}”. Pick one in the viewer instead.</p>
      <p style="margin-top:20px"><a class="btn btn--secondary" href="index.html"><span class="btn__dot" aria-hidden="true"></span>Back to the residences</a></p>`;
    return;
  }

  document.title = `Residence ${u.id} · Central Park Boulevard`;
  const viewerLink = `index.html?view=${u.views[0]}&unit=${encodeURIComponent(u.id)}`;
  main.innerHTML = `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="index.html">Check Availability</a><span class="breadcrumb__sep" aria-hidden="true"></span><span aria-current="page">${esc(u.id)}</span>
    </nav>
    <div class="inner__grid">
      <div>
        <span class="pill pill--${u.status}">${STATUS_LABEL[u.status]}</span>
        <h1 class="display inner__title">${TYPE_LONG[u.type]} Residence</h1>
        <p class="inner__lead">Tower ${esc(u.tower)}, floor ${u.floor}, apartment ${esc(u.unit)}. A ${formatArea(u.area_ft2)} ${TYPE_LONG[u.type].toLowerCase()} home at Central Park Boulevard, Port City Colombo.</p>
        <dl class="spec-list">
          <div><dt>Reference</dt><dd>${esc(u.id)}</dd></div>
          <div><dt>Type</dt><dd>${TYPE_LONG[u.type]}</dd></div>
          <div><dt>Interior area</dt><dd>${areaM2(u)} m² · ${formatArea(u.area_ft2)}</dd></div>
          <div><dt>Price</dt><dd>$ ${formatNumber(u.price_usd)}</dd></div>
          <div><dt>Floor</dt><dd>${u.floor} of 35</dd></div>
          <div><dt>Tower</dt><dd>Tower ${esc(u.tower)}</dd></div>
          <div><dt>Seen from</dt><dd>${u.views.map((v) => VIEW_NAMES[v] ?? v).join(', ')}</dd></div>
        </dl>
        <div class="actions">
          <a class="btn btn--primary" href="contact.html?unit=${encodeURIComponent(u.id)}">Contact Us for More Info</a>
          <a class="btn btn--secondary" href="${viewerLink}"><span class="btn__dot" aria-hidden="true"></span>See it on the tower</a>
        </div>
      </div>
      <figure class="plan-figure panel" style="padding:0">
        <img src="${esc(u.plan_url)}" alt="Illustrative floor plan" width="326" height="287">
        <figcaption>Illustrative plan. The final floor plan for ${esc(u.id)} will replace this sample.</figcaption>
      </figure>
    </div>`;
}
