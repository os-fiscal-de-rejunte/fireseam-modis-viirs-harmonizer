import { describe, it, expect } from "vitest";
import { cellValue, cellTotals, cellPolygons, cellLayerLabel } from "./hotcells.js";

const u16 = (a) => Uint16Array.from(a);
const cube = { nx: 2, ny: 2, years: new Map([[2020, { n: 5, cell: u16([0, 1, 0, 3, 2]),
  week: Uint8Array.from([1, 1, 2, 2, 3]), modis: u16([2, 0, 1, 3, 4]), viirs: u16([10, 20, 0, 0, 9]) }]]) };
const wk = (week, o) => ({ year: 2020, week, modis: null, viirs: null, pred: null, harmonized: null, status: "gap", ...o });
const calendar = { meta: {}, weeks: [
  wk(1, { modis: 2, viirs: 30, harmonized: 30, status: "observed" }),
  wk(2, { modis: 4, pred: 20, harmonized: 20, status: "estimated" }),
  wk(3, {}) ] };

describe("hotcells", () => {
  it("cellValue follows the area rule for one cell", () => {
    expect(cellValue(2, 10, calendar.weeks[0])).toBe(10);
    expect(cellValue(1, 0, calendar.weeks[1])).toBe(5);
    expect(cellValue(3, 0, { status: "estimated", modis: 0, pred: 1.5 })).toBe(0);
    expect(cellValue(4, 9, calendar.weeks[2])).toBeNull();
  });
  it("sums a year per cell and never counts a gap week", () => {
    const t = cellTotals(cube, calendar, { year: 2020 });
    expect([...t].sort((a, b) => a[0] - b[0])).toEqual([[0, 15], [1, 20], [3, 15]]);
    expect(cellTotals(cube, calendar, { year: 2020, from: 2, to: 2 }).get(0)).toBe(5);
    expect(cellTotals(cube, calendar, { year: 2019 }).size).toBe(0);
  });
  it("restricts the sum to an area", () => {
    const t = cellTotals(cube, calendar, { year: 2020, aoi: { cx0: 1, cy0: 0, cx1: 1, cy1: 1 } });
    expect([...t].sort((a, b) => a[0] - b[0])).toEqual([[1, 20], [3, 15]]);
  });
  it("draws one square per cell with detections", () => {
    const p = cellPolygons(cellTotals(cube, calendar, { year: 2020 }), [10, 20, 10.2, 20.2], 0.1, 2);
    expect(p.length).toBe(3);
    const c3 = p.find((x) => x.cell === 3).polygon;
    expect(c3.length).toBe(5);
    [[10.1, 20.1], [10.2, 20.1], [10.2, 20.2], [10.1, 20.2], [10.1, 20.1]].forEach(([x, y], i) => {
      expect(c3[i][0]).toBeCloseTo(x, 9); expect(c3[i][1]).toBeCloseTo(y, 9); });
  });
  it("labels the layer", () => {
    expect(cellLayerLabel(2020)).toBe("detections per 0.1 degree cell in 2020; not burned area and not risk");
  });
});
