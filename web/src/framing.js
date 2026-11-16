// Where the globe sits on the screen: the planet's size and place on the cover, and the zoom
// that fits a region's box in the free part of the screen. Pure geometry on deck.gl's own
// GlobeViewport, so what is computed here is what deck.gl draws.
import { _GlobeViewport as GlobeViewport } from "deck.gl";

export const ZERO = { left: 0, top: 0, right: 0, bottom: 0 };

const RAD = Math.PI / 180;
const ITER = 40;

// Point at `deg` degrees from [0, lat] along the great circle heading east.
function east(lat, deg) {
  const p = lat * RAD;
  const d = deg * RAD;
  const lat2 = Math.asin(Math.sin(p) * Math.cos(d));
  const lon2 = Math.atan2(Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(lat2));
  return [lon2 / RAD, lat2 / RAD];
}

// Radius on screen, in pixels, of the planet's outline for a view centred at `latitude`.
// Along a great circle from the centre the projected distance grows up to the outline and
// shrinks behind it, so its maximum is the outline.
export function limbRadius({ width, height, latitude = 0, zoom }) {
  const v = new GlobeViewport({ width, height, longitude: 0, latitude, zoom });
  const [cx, cy] = v.project([0, latitude]);
  const dist = (deg) => {
    const [x, y] = v.project(east(latitude, deg));
    return Math.hypot(x - cx, y - cy);
  };
  let a = 0;
  let b = 90;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < ITER; i++) {
    const m1 = b - g * (b - a);
    const m2 = a + g * (b - a);
    if (dist(m1) < dist(m2)) a = m1;
    else b = m2;
  }
  return dist((a + b) / 2);
}

// The zoom at which the planet's outline has `radius` pixels.
export function overviewZoom({ width, height, latitude = 0, radius }) {
  let lo = -4;
  let hi = 6;
  for (let i = 0; i < ITER; i++) {
    const mid = (lo + hi) / 2;
    if (limbRadius({ width, height, latitude, zoom: mid }) < radius) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The planet on the cover. Wide screens: centre at 66% of the width and half the height,
// diameter 88% of the height, never wider than 55% of the width, and at least 24 px
// clear of the right edge of the text column. Narrow screens: centred in its own box.
export function coverFrame({ width, height, textRight = 0, wide = true }) {
  if (!wide) return { padding: ZERO, radius: Math.min(0.44 * height, 0.46 * width) };
  const cx = 0.66 * width;
  const radius = Math.max(0, Math.min(0.44 * height, 0.275 * width, cx - textRight - 24));
  return { padding: { left: 2 * cx - width, top: 0, right: 0, bottom: 0 }, radius };
}

// The largest zoom (within min and max) at which the box, centred, fits inside the screen less
// the padding and a margin on every side.
export function fitZoom({ width, height, padding = ZERO, bbox, margin = 24, min = 1.5, max = 6 }) {
  const [w, s, e, n] = bbox;
  const longitude = (w + e) / 2;
  const latitude = (s + n) / 2;
  const outline = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    outline.push([w + (e - w) * t, s], [w + (e - w) * t, n], [w, s + (n - s) * t], [e, s + (n - s) * t]);
  }
  const x0 = padding.left + margin;
  const x1 = width - padding.right - margin;
  const y0 = padding.top + margin;
  const y1 = height - padding.bottom - margin;
  const fits = (zoom) => {
    const v = new GlobeViewport({ width, height, longitude, latitude, zoom, padding });
    return outline.every((c) => {
      const [x, y] = v.project(c);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    });
  };
  if (x1 <= x0 || y1 <= y0 || !fits(min)) return min;
  if (fits(max)) return max;
  let lo = min;
  let hi = max;
  for (let i = 0; i < ITER; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
