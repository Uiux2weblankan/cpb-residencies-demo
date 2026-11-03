import { Emitter } from '../core/emitter.js';

export const STATUSES = ['available', 'reserved', 'sold'];
export const TYPES = ['STUDIO', '1BR', '2BR', '3BR', '4BR'];
export const FT2_PER_M2 = 10.7639;
export const areaM2 = (unit) => Math.round(unit.area_ft2 / FT2_PER_M2);

const OVERRIDES_KEY = 'cpb-demo-status-feed';

/**
 * Unit data (type, area, status) indexed by id, plus the active filters.
 * Status always comes from this feed; the SVG overlays carry geometry and ids only.
 *
 * Events: 'status' {id, status}, 'reset', 'filters'
 */
export class UnitStore extends Emitter {
  units = [];
  byId = new Map();
  meta = {};
  /** Figma 2.1.1 filters: price range (USD), area range (m²), rooms (types). */
  filters = { price: null, area: null, rooms: new Set() };
  #original = new Map();

  async load(url) {
    // no-cache: a status change in the feed shows on reload without a redeploy.
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Unit data failed to load (${res.status})`);
    const data = await res.json();
    this.meta = { version: data.version, source: data.status_source, updated: data.updated };
    this.units = data.units;
    for (const u of this.units) {
      this.byId.set(u.id, u);
      this.#original.set(u.id, u.status);
    }
    this.#applyOverrides();
    // Another tab (the demo feed page) changed a status: apply it live.
    window.addEventListener('storage', (e) => {
      if (e.key !== OVERRIDES_KEY) return;
      for (const u of this.units) u.status = this.#original.get(u.id);
      this.#applyOverrides();
      this.emit('status', { id: null });
    });
    return this;
  }

  get(id) { return this.byId.get(id); }
  forTower(tower) { return this.units.filter((u) => u.tower === tower); }

  /** Counts by status for a list of units. */
  stats(list = this.units) {
    const s = { total: list.length, available: 0, reserved: 0, sold: 0 };
    for (const u of list) s[u.status]++;
    return s;
  }

  /** True when every unit on that floor of the tower is sold (all views, not just one). */
  isFloorSoldOut(tower, floor) {
    const list = this.units.filter((u) => u.tower === tower && u.floor === floor);
    return list.length > 0 && list.every((u) => u.status === 'sold');
  }

  typesInTower(tower) {
    const present = new Set(this.forTower(tower).map((u) => u.type));
    return TYPES.filter((t) => present.has(t));
  }

  /* ---------- Filters ---------- */

  /** Slider bounds for a tower: price in USD (rounded to 10k), area in m². */
  ranges(tower) {
    const list = this.forTower(tower);
    const prices = list.map((u) => u.price_usd);
    const areas = list.map(areaM2);
    return {
      price: [Math.floor(Math.min(...prices) / 10000) * 10000, Math.ceil(Math.max(...prices) / 10000) * 10000],
      area: [Math.min(...areas), Math.max(...areas)],
    };
  }

  matches(unit) {
    const { price, area, rooms } = this.filters;
    if (price && (unit.price_usd < price[0] || unit.price_usd > price[1])) return false;
    if (area) { const m2 = areaM2(unit); if (m2 < area[0] || m2 > area[1]) return false; }
    if (rooms.size && !rooms.has(unit.type)) return false;
    return true;
  }

  get activeFilterCount() {
    return (this.filters.price ? 1 : 0) + (this.filters.area ? 1 : 0) + this.filters.rooms.size;
  }

  /** price / area: [min, max] or null (full range). */
  setRange(key, range) {
    this.filters[key] = range;
    this.emit('filters', this.filters);
  }

  toggleRoom(type) {
    const set = this.filters.rooms;
    if (set.has(type)) set.delete(type); else set.add(type);
    this.emit('filters', this.filters);
  }

  clearFilters() {
    this.filters = { price: null, area: null, rooms: new Set() };
    this.emit('filters', this.filters);
  }

  /* ---------- Demo status feed ----------
     Simulates the client's sales feed: changes are stored in localStorage and
     survive a reload, the way an edited units.json or CMS record would. */

  setStatus(id, status) {
    const unit = this.byId.get(id);
    if (!unit || !STATUSES.includes(status)) return false;
    unit.status = status;
    const overrides = this.#readOverrides();
    if (status === this.#original.get(id)) delete overrides[id]; else overrides[id] = status;
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    this.emit('status', { id, status });
    return true;
  }

  resetStatuses() {
    localStorage.removeItem(OVERRIDES_KEY);
    for (const u of this.units) u.status = this.#original.get(u.id);
    this.emit('reset');
  }

  get overrideCount() { return Object.keys(this.#readOverrides()).length; }

  #readOverrides() {
    try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {}; } catch { return {}; }
  }

  #applyOverrides() {
    for (const [id, status] of Object.entries(this.#readOverrides())) {
      const unit = this.byId.get(id);
      if (unit && STATUSES.includes(status)) unit.status = status;
    }
  }
}
