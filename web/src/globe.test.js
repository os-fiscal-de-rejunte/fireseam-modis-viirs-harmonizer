import { describe, it, expect } from "vitest";
import {
  bestOverviewCenter, buildColors, cellGlow, halfDiagonalMeters, facesCentre, greatCircleDeg, maxCellValue, overviewView, turnToward,
} from "./globe.js";

describe("buildColors", () => {
  const points = { n: 2, flags: Uint8Array.from([0, 0]),
    lon: Float32Array.from([-57.5, -55.0]), lat: Float32Array.from([-18.5, -18.5]) };
  const show = { modis: true, viirs: true, ghostOnly: false };
  it("keeps alpha without an area and dims outside one", () => {
    const plain = buildColors(points, show, "modis");
    expect([plain[3], plain[7]]).toEqual([255, 255]);
    const dim = buildColors(points, show, "modis", [-58, -19, -57, -18]);
    expect([dim[3], dim[7]]).toEqual([255, 64]);
  });
});

describe("maxCellValue", () => {
  it("finds the largest value without spreading the cells into arguments", () => {
    const cells = Array.from({ length: 300000 }, (_, i) => ({ value: i % 977 }));
    cells[123456].value = 5000;
    expect(maxCellValue(cells)).toBe(5000);
    expect(maxCellValue([])).toBe(0);
  });
});

describe("overview geometry", () => {
  const box = (lon, lat) => ({ bbox: [lon - 1, lat - 1, lon + 1, lat + 1] });
  it("measures great-circle angles in degrees", () => {
    expect(greatCircleDeg([0, 0], [90, 0])).toBeCloseTo(90, 9);
    expect(greatCircleDeg([179, 0], [-179, 0])).toBeCloseTo(2, 9);
    expect(greatCircleDeg([10, 90], [-70, 90])).toBeCloseTo(0, 6);
  });
  it("tells a centre facing the camera from one past the cap", () => {
    expect(facesCentre([0, 0], [60, 0], 70)).toBe(true);
    expect(facesCentre([0, 0], [80, 0], 70)).toBe(false);
    expect(facesCentre([-170, 0], [170, 0], 70)).toBe(true);
  });
  it("centres the overview where the most boxes face the camera, across the antimeridian", () => {
    const v = overviewView([box(174, 0), box(-174, 0)]);
    expect(Math.abs(Math.abs(v.longitude) - 180)).toBeLessThanOrEqual(1);
    expect(Math.abs(v.latitude)).toBeLessThanOrEqual(1);
    expect(v.zoom).toBeCloseTo(0.9, 9);
    // Three boxes together and one on the far side: the three win over the mean of all four.
    const rows = [box(0, 0), box(20, 0), box(40, 0), box(180, 0)];
    const c = bestOverviewCenter(rows);
    expect(rows.filter((r) => facesCentre([c.longitude, c.latitude], [r.bbox[0] + 1, r.bbox[1] + 1])).length).toBe(3);
    expect(c.longitude).toBeCloseTo(20, 9);
  });
  it("turns toward a point and stops short of it by the kept angle", () => {
    const t = turnToward({ longitude: 0, latitude: 0 }, [100, 0], 30);
    expect(t.longitude).toBeCloseTo(70, 6);
    expect(t.latitude).toBeCloseTo(0, 6);
    expect(greatCircleDeg([t.longitude, t.latitude], [100, 0])).toBeCloseTo(30, 6);
    const same = turnToward({ longitude: 5, latitude: 5 }, [10, 5], 30);
    expect([same.longitude, same.latitude]).toEqual([5, 5]);
  });
});

describe("cell glow", () => {
  it("grows from 0.75 to 1.3 of the half-diagonal and brightens with the value", () => {
    expect(cellGlow(0, 100)).toEqual({ t: 0.2, scale: 0.75, alpha: 40 });
    expect(cellGlow(100, 100)).toEqual({ t: 1, scale: 1.3, alpha: 240 });
    const quarter = cellGlow(25, 100);
    // the ramp's position runs from 0.2 to 1, so the faintest cells are not dark
    expect(quarter.t).toBeCloseTo(0.6, 9);
    expect(quarter.scale).toBeCloseTo(1.025, 9);
    expect(quarter.alpha).toBe(140);
  });
  it("stays on the ramp for values past the maximum or with no maximum", () => {
    expect(cellGlow(500, 100).t).toBe(1);
    expect(cellGlow(5, 0)).toEqual({ t: 0.2, scale: 0.75, alpha: 40 });
  });
  it("measures a cell's half-diagonal in metres", () => {
    const at = (lat) => halfDiagonalMeters([[10, lat], [10.1, lat], [10.1, lat + 0.1], [10, lat + 0.1], [10, lat]]);
    expect(at(-0.05)).toBeCloseTo(0.5 * Math.hypot(11132, 11057.4), 0);
    expect(at(40)).toBeLessThan(at(-0.05));
  });
});
