/**
 * Turns "go from view X to view Y" into a list of shots to play.
 * Every shot is an edge in both directions: forward as delivered, backward as the
 * same frames reversed. The shortest path wins, e.g.
 *   A2 → A1 = shot 03 reversed
 *   A3 → B1 = shot 05 (A3→A1) + shot 01 reversed (A1→K0) + shot 02 (K0→B1)
 */
export class RoutePlanner {
  constructor(manifest) {
    this.manifest = manifest;
    this.edges = new Map();
    for (const shot of manifest.data.shots) {
      this.#add(shot.from, { shotId: shot.id, reverse: false, from: shot.from, to: shot.to });
      this.#add(shot.to, { shotId: shot.id, reverse: true, from: shot.to, to: shot.from });
    }
  }

  #add(view, edge) {
    if (!this.edges.has(view)) this.edges.set(view, []);
    this.edges.get(view).push(edge);
  }

  /** Breadth-first search: fewest clips between two views. */
  route(from, to) {
    if (from === to) return [];
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const v = queue.shift();
      for (const e of this.edges.get(v) ?? []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, e);
        if (e.to === to) return this.#unwind(prev, to);
        queue.push(e.to);
      }
    }
    throw new Error(`No route from ${from} to ${to}`);
  }

  #unwind(prev, to) {
    const steps = [];
    for (let e = prev.get(to); e; e = prev.get(e.from)) steps.unshift(e);
    return steps;
  }

  /** Next / previous view around the tower loop (A1 → A2 → A3 → A1). */
  step(view, dir) {
    const v = this.manifest.view(view);
    if (!v?.tower) return null;
    const loop = this.manifest.loop(v.tower);
    const i = loop.indexOf(view);
    return loop[(i + dir + loop.length) % loop.length];
  }

  /** The other tower's arrival view (its park view). */
  otherTower(view) {
    const t = this.manifest.view(view)?.tower;
    if (!t) return null;
    return this.manifest.loop(t === 'A' ? 'B' : 'A')[0];
  }
}
