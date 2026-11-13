import { describe, it, expect } from "vitest";
import { areaCalendar, cellsFromLonLat, aoiBounds, parseAoiHash, formatAoiHash } from "./aoi.js";

const BBOX = [-58.5, -22.5, -54.0, -15.5];
const u16 = (a) => Uint16Array.from(a);
// 3 x 2 grid; entries are [cell, week, modis, viirs]
const cube = {
  nx: 3, ny: 2,
  years: new Map([[2020, {
    n: 4,
    cell: u16([0, 4, 0, 5]),
    week: Uint8Array.from([1, 1, 2, 3]),
    modis: u16([2, 3, 4, 1]),
    viirs: u16([10, 20, 0, 0]),
  }]]),
};
const wk = (week, o) => ({ year: 2020, week, modis: null, viirs: null, pred: null,
  harmonized: null, lo: null, hi: null, status: "gap", nrt: false, ...o });
const calendar = { meta: { method: "model" }, weeks: [
  wk(1, { modis: 5, viirs: 30, pred: 28, harmonized: 30, status: "observed" }),
  wk(2, { modis: 4, pred: 20, harmonized: 20, lo: 10, hi: 40, status: "estimated" }),
  wk(3, { modis: 1, pred: 6, harmonized: 6, lo: 3, hi: 12, status: "estimated" }),
  wk(4, { modis: 0, pred: 1.5, harmonized: 1.5, lo: 0.8, hi: 3, status: "estimated" }),
  wk(5, {}),
  { ...wk(1, { modis: 0, viirs: 0, pred: 0, harmonized: 0, status: "observed" }), year: 2019 },
] };
const FULL = { cx0: 0, cy0: 0, cx1: 2, cy1: 1 };
const pick = (w) => [w.modis, w.viirs, w.harmonized, w.lo, w.hi, w.status];

describe("areaCalendar", () => {
  it("reproduces the regional calendar on the full grid", () => {
    const out = areaCalendar(cube, calendar, FULL).weeks;
    expect(pick(out[0])).toEqual([5, 30, 30, null, null, "observed"]);
    expect(pick(out[1])).toEqual([4, null, 20, 10, 40, "estimated"]);
    expect(pick(out[2])).toEqual([1, null, 6, 3, 12, "estimated"]);
    expect(pick(out[4])).toEqual([null, null, null, null, null, "gap"]);
  });
  it("gives 0 and factor false when the regional MODIS count is 0", () => {
    const w = areaCalendar(cube, calendar, FULL).weeks[3];
    expect(pick(w)).toEqual([0, null, 0, null, null, "estimated"]);
    expect(w.factor).toBe(false);
  });
  it("scales a single cell by the regional factor", () => {
    const out = areaCalendar(cube, calendar, { cx0: 0, cy0: 0, cx1: 0, cy1: 0 }).weeks;
    expect(pick(out[0])).toEqual([2, 10, 10, null, null, "observed"]);
    expect(pick(out[1])).toEqual([4, null, 20, 10, 40, "estimated"]);
    expect(pick(out[2])).toEqual([0, null, 0, 0, 0, "estimated"]);
    expect(out[2].factor).toBeUndefined();
  });
  it("reads cx and cy from the cell id", () => {
    const out = areaCalendar(cube, calendar, { cx0: 1, cy0: 1, cx1: 1, cy1: 1 }).weeks;
    expect(pick(out[0])).toEqual([3, 20, 20, null, null, "observed"]);
  });
  it("returns zeros for an empty area and for a year absent from the cube", () => {
    const out = areaCalendar(cube, calendar, { cx0: 2, cy0: 0, cx1: 2, cy1: 0 }).weeks;
    expect(pick(out[0])).toEqual([0, 0, 0, null, null, "observed"]);
    expect(pick(out[5])).toEqual([0, 0, 0, null, null, "observed"]);
  });
  it("rounds estimated values to one decimal and records the area", () => {
    const cal = { meta: {}, weeks: [wk(3, { modis: 3, pred: 10, harmonized: 10, lo: 5, hi: 20, status: "estimated" })] };
    const out = areaCalendar(cube, cal, { cx0: 2, cy0: 1, cx1: 2, cy1: 1 });
    expect(pick(out.weeks[0])).toEqual([1, null, 3.3, 1.7, 6.7, "estimated"]);
    expect(out.meta.aoi).toEqual({ cx0: 2, cy0: 1, cx1: 2, cy1: 1 });
  });
});

describe("cellsFromLonLat", () => {
  it("snaps two corners in any order", () => {
    const want = { cx0: 0, cy0: 0, cx1: 2, cy1: 1 };
    expect(cellsFromLonLat([-58.45, -22.45], [-58.21, -22.31], BBOX, 0.1, 45, 70)).toEqual(want);
    expect(cellsFromLonLat([-58.21, -22.31], [-58.45, -22.45], BBOX, 0.1, 45, 70)).toEqual(want);
  });
  it("clamps corners outside the region and on the far edge", () => {
    expect(cellsFromLonLat([-70, -30], [0, 0], BBOX, 0.1, 45, 70)).toEqual({ cx0: 0, cy0: 0, cx1: 44, cy1: 69 });
    expect(cellsFromLonLat([-54.0, -15.5], [-54.0, -15.5], BBOX, 0.1, 45, 70)).toEqual({ cx0: 44, cy0: 69, cx1: 44, cy1: 69 });
  });
});

describe("aoiBounds", () => {
  it("returns the outer edges of the cells", () => {
    const b = aoiBounds({ cx0: 0, cy0: 0, cx1: 2, cy1: 1 }, BBOX, 0.1);
    [-58.5, -22.5, -58.2, -22.3].forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9));
  });
});

describe("area hash", () => {
  it("round-trips", () => {
    const aoi = { cx0: 1, cy0: 2, cx1: 3, cy1: 4 };
    expect(formatAoiHash(aoi)).toBe("#aoi=1,2,3,4");
    expect(parseAoiHash("#aoi=1,2,3,4", 45, 70)).toEqual(aoi);
  });
  it.each(["", "#outlook", "#aoi=1,2,3", "#aoi=3,4,1,2", "#aoi=0,0,45,0", "#aoi=0,0,0,70",
    "#aoi=-1,0,2,2", "#aoi=1.5,2,3,4", "#aoi=a,b,c,d", "#aoi=1,2,3,4,5"])(
    "ignores %s", (hash) => expect(parseAoiHash(hash, 45, 70)).toBeNull(),
  );
});
