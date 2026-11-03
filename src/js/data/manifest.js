/**
 * Loads manifest.json (written by scripts/build-manifest) and answers questions
 * about views and shots. Asset URLs are resolved against the public folder.
 */
export class Manifest {
  constructor(data, base) {
    this.data = data;
    this.base = base;
    this.views = new Map(data.views.map((v) => [v.id, v]));
    this.shots = new Map(data.shots.map((s) => [s.id, s]));
  }

  static async load(url, base) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Manifest failed to load (${res.status})`);
    return new Manifest(await res.json(), base);
  }

  get stage() { return this.data.stage; }
  view(id) { return this.views.get(id); }
  shot(id) { return this.shots.get(id); }
  loop(tower) { return this.data.loops[tower]; }

  stillUrl(viewId, ext) { return `${this.base}${this.view(viewId).still}.${ext}`; }
  overlayUrl(viewId) { return `${this.base}${this.view(viewId).overlay}`; }
  frameUrl(shotId, index, ext) {
    const s = this.shot(shotId);
    return `${this.base}${s.path}${String(index + 1).padStart(4, '0')}.${ext}`;
  }

  /** A short display name, e.g. "Tower A · Park ¾". */
  viewTitle(id) {
    const v = this.view(id);
    return v.tower ? `Tower ${v.tower} · ${v.name}` : 'Overview';
  }
}
