/** Viewer configuration. Paths are relative to the page that loads the viewer. */
export const CONFIG = {
  publicBase: 'public/',
  manifestUrl: 'public/manifest.json',
  // The status feed. Swap for a CMS or sales-system endpoint that returns the same shape.
  unitsUrl: 'public/data/units.json',

  fps: 30,
  /** Frames at each end of a clip blended with the still, so the hand-off is pixel-exact. */
  endpointBlendFrames: 3,
  /** Crossfade used under prefers-reduced-motion, or when frames are not ready in time. */
  crossfadeMs: 450,
  /** How long a transition may wait for frames before falling back to the crossfade. */
  maxStallMs: 1200,

  /** Decoded frame width. Frames carry motion blur, so a lighter decode is not visible. */
  decodeWidth: { desktop: 1280, mobile: 1080 },
  /** Decoded shots kept in memory (ImageBitmaps are closed on eviction). */
  decodedShotCache: { desktop: 3, mobile: 2 },
  fetchConcurrency: 6,
  maxPixelRatio: 2,

  /** Card hides this long after the pointer leaves the tower, unless it enters the card. */
  hoverHideDelayMs: 280,
  /** Horizontal swipe distance that steps around the tower (mobile). */
  swipeThreshold: 50,
};
