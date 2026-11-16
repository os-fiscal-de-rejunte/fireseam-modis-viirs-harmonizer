import { describe, expect, it } from "vitest";
import { _GlobeViewport as GlobeViewport } from "deck.gl";
import { coverFrame, fitZoom, limbRadius, overviewZoom, ZERO } from "./framing.js";

const W = 1536;
const H = 695;

describe("limbRadius and overviewZoom", () => {
  it("measures the planet's radius on screen for a zoom", () => {
    const r = limbRadius({ width: W, height: H, latitude: 0, zoom: 0.9 });
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(150);
    expect(limbRadius({ width: W, height: H, latitude: 0, zoom: 2 })).toBeGreaterThan(r);
  });

  it("finds the zoom that gives the planet a wanted radius", () => {
    for (const [latitude, radius] of [[0, 305.8], [-12, 305.8], [30, 200]]) {
      const zoom = overviewZoom({ width: W, height: H, latitude, radius });
      expect(Math.abs(limbRadius({ width: W, height: H, latitude, zoom }) - radius)).toBeLessThan(0.5);
    }
  });
});

describe("coverFrame", () => {
  it("puts the planet's centre at 66% of the width, vertically centred, 88% of the height across", () => {
    const f = coverFrame({ width: W, height: H, textRight: 484, wide: true });
    expect(f.radius).toBeCloseTo(0.44 * H, 6);
    const v = new GlobeViewport({ width: W, height: H, longitude: 0, latitude: 0, zoom: 1, padding: f.padding });
    const [x, y] = v.project([0, 0]);
    expect(x).toBeCloseTo(0.66 * W, 3);
    expect(y).toBeCloseTo(H / 2, 3);
  });

  it("never makes the planet wider than 55% of the width", () => {
    const f = coverFrame({ width: 1000, height: 1000, textRight: 0, wide: true });
    expect(f.radius).toBeCloseTo(0.275 * 1000, 6);
  });

  it("keeps the planet at least 24 px clear of the text column", () => {
    const f = coverFrame({ width: 1100, height: 700, textRight: 484, wide: true });
    expect(0.66 * 1100 - f.radius).toBeCloseTo(484 + 24, 6);
  });

  it("centres the planet in its own box on narrow screens", () => {
    const f = coverFrame({ width: 390, height: 422, textRight: 374, wide: false });
    expect(f.padding).toEqual(ZERO);
    expect(f.radius).toBeCloseTo(Math.min(0.44 * 422, 0.46 * 390), 6);
  });
});

describe("fitZoom", () => {
  const padding = { left: 320, top: 68, right: 320, bottom: 380 };
  const bbox = [-58.5, -22.5, -54, -15.5];
  const corners = (zoom) => {
    const v = new GlobeViewport({
      width: W,
      height: H,
      longitude: (bbox[0] + bbox[2]) / 2,
      latitude: (bbox[1] + bbox[3]) / 2,
      zoom,
      padding,
    });
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[1]],
      [bbox[2], bbox[3]],
      [bbox[0], bbox[3]],
    ].map((c) => v.project(c));
  };
  const inside = (pts, m) =>
    pts.every(
      ([x, y]) => x >= padding.left + m - 0.5 && x <= W - padding.right - m + 0.5 && y >= padding.top + m - 0.5 && y <= H - padding.bottom - m + 0.5,
    );

  it("fits the box in the free area with the margin, as large as it can", () => {
    const zoom = fitZoom({ width: W, height: H, padding, bbox, margin: 20 });
    expect(inside(corners(zoom), 20)).toBe(true);
    expect(inside(corners(zoom + 0.05), 20)).toBe(false);
  });

  it("stays inside its zoom limits", () => {
    expect(fitZoom({ width: W, height: H, padding: ZERO, bbox: [0, 0, 0.01, 0.01], max: 6 })).toBe(6);
    expect(fitZoom({ width: 200, height: 120, padding: ZERO, bbox: [-60, -40, 60, 40], min: 1.5 })).toBe(1.5);
  });
});
