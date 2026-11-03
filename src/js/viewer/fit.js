/**
 * Cover-fit maths shared by the canvas and the SVG overlay, so polygons stay locked
 * to the picture at any size. The focal point (in 1920×1080 image coordinates) is
 * kept as close to the centre as the crop allows: on a portrait phone this keeps the
 * tower centred, which replaces separate mobile crops.
 */
export function coverFit(boxW, boxH, imgW, imgH, focal) {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const [fx, fy] = focal ?? [imgW / 2, imgH / 2];
  const x = clamp(boxW / 2 - fx * scale, boxW - w, 0);
  const y = clamp(boxH / 2 - fy * scale, boxH - h, 0);
  return { scale, x, y, w, h };
}

/**
 * Cover-fit that keeps a view's tower clear of a UI panel on one side of the box.
 * exclusion = { side: 'left' | 'right', size } in box units, margin likewise.
 * Pans within the crop first; only if that is not enough, eases the picture in
 * (at most +25%). Returns the plain cover-fit when nothing needs to move.
 */
export function framedFit(boxW, boxH, imgW, imgH, view, exclusion, margin = 24) {
  const base = coverFit(boxW, boxH, imgW, imgH, view.focal);
  if (!exclusion || !view.bounds) return base;
  const [bx0, , bx1] = view.bounds;
  const freeL = (exclusion.side === 'left' ? exclusion.size : 0) + margin;
  const freeR = (exclusion.side === 'right' ? boxW - exclusion.size : boxW) - margin;
  const s0 = Math.max(boxW / imgW, boxH / imgH);
  const [fx, fy] = view.focal;

  let best = null;
  for (let z = 1; z <= 1.2501; z += 0.01) {
    const scale = s0 * z;
    const w = imgW * scale;
    const h = imgH * scale;
    // x range that keeps the tower inside the free area, within the image crop.
    const lo = Math.max(boxW - w, freeL - bx0 * scale);
    const hi = Math.min(0, freeR - bx1 * scale);
    const preferred = boxW / 2 - fx * scale;
    const y = clamp(boxH / 2 - fy * scale, boxH - h, 0);
    if (lo <= hi) return { scale, x: clamp(preferred, lo, hi), y, w, h };
    // Not possible yet: remember the closest attempt in case even +25% is not enough.
    best = { scale, x: clamp(freeR - bx1 * scale, boxW - w, 0), y, w, h };
  }
  return best ?? base;
}

export const lerpFit = (a, b, t) => {
  const scale = lerp(a.scale, b.scale, t);
  return { scale, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
};

export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPoint = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
export const easeInOut = (t) => 0.5 - Math.cos(Math.PI * t) / 2;
