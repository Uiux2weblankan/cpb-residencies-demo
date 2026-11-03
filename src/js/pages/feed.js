import { CONFIG } from '../config.js';
import { $ } from '../core/dom.js';
import { UnitStore } from '../data/unit-store.js';
import { DemoFeed } from '../ui/demo-feed.js';
import { initSiteMenu } from '../ui/site-menu.js';

/**
 * Demo tool: stands in for the client's sales system. Status changes are stored in
 * localStorage; an open Check Availability tab picks them up live (storage event),
 * and every new visit reads them on load, as an edited units.json would be.
 */
initSiteMenu();

new UnitStore().load(CONFIG.unitsUrl)
  .then((store) => new DemoFeed($('[data-demo-feed]'), { store }))
  .catch(() => {
    $('[data-demo-feed]').innerHTML = '<p class="notice">Unit data could not be loaded. Serve the demo over http (see README).</p>';
  });
