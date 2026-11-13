import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeCube } from "./data.js";
import { areaCalendar } from "./aoi.js";

const root = new URL("../public/data/", import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const calendar = json("calendar.json");
const index = json("cube/index.json");
const years = new Map(
  Object.keys(index.years).map((y) => {
    const b = readFileSync(new URL(`cube/${y}.bin`, root));
    return [Number(y), decodeCube(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))];
  }),
);
const cube = { nx: index.nx, ny: index.ny, years };

describe("published export", () => {
  it("full-grid area equals the regional calendar", () => {
    const full = { cx0: 0, cy0: 0, cx1: index.nx - 1, cy1: index.ny - 1 };
    const out = areaCalendar(cube, calendar, full).weeks;
    expect(out.length).toBe(1352);
    calendar.weeks.forEach((w, i) => {
      const a = out[i];
      expect([a.year, a.week, a.modis, a.viirs, a.status]).toEqual([w.year, w.week, w.modis, w.viirs, w.status]);
      if (a.factor === false) return;
      expect(a.harmonized).toBe(w.harmonized);
      expect([a.lo, a.hi]).toEqual([w.lo, w.hi]);
    });
  });
  it("has few weeks without a regional factor", () => {
    const n = calendar.weeks.filter((w) => w.status === "estimated" && !w.modis).length;
    expect(n).toBeLessThan(100);
  });
});
