import { describe, it, expect } from "vitest";
import { weekStats, criticalPeriod, yearToDate, isSufficient, analyze } from "./stats.js";

// value(year, week) -> harmonized (null allowed), for 2001-2026 x 52 weeks
function mk(value) {
  const weeks = [];
  for (let year = 2001; year <= 2026; year++)
    for (let week = 1; week <= 52; week++)
      weeks.push({ year, week, harmonized: value(year, week), status: "observed" });
  return { weeks };
}

describe("weekStats", () => {
  const cal = mk((y, w) => (w === 30 ? (y === 2026 ? 100 : y - 2000) : 0));
  const s = weekStats(cal);
  it("ranks a week against the same week in the other years", () => {
    expect(s.get("2013:30")).toEqual({ percentile: 0.5, unusual: false, record: false });
    expect(s.get("2022:30").unusual).toBe(false); // 21 of 24 below
    expect(s.get("2023:30")).toEqual({ percentile: 22 / 24, unusual: true, record: false });
  });
  it("marks records, and scores 2026 against 2001-2025", () => {
    expect(s.get("2025:30")).toEqual({ percentile: 1, unusual: true, record: true });
    expect(s.get("2026:30")).toEqual({ percentile: 1, unusual: true, record: true });
  });
  it("never flags a zero", () => {
    expect(s.get("2020:5")).toEqual({ percentile: 0, unusual: false, record: false });
  });
  it("gives no percentile with fewer than 10 reference values", () => {
    const few = weekStats(mk((y, w) => (w === 7 && y > 2010 ? null : 5)));
    expect(few.get("2005:7")).toEqual({ percentile: null, unusual: false, record: false });
    expect(few.has("2015:7")).toBe(false);
  });
});

describe("criticalPeriod", () => {
  it("finds the shortest run holding 80% of the mean year", () => {
    const cal = mk((y, w) => ({ 30: 10, 31: 40, 32: 40, 33: 10 })[w] ?? 0);
    const c = criticalPeriod(cal);
    expect([c.start, c.end]).toEqual([31, 32]);
    expect(c.share).toBeCloseTo(0.8, 9);
  });
  it("takes the earliest run on a tie", () => {
    const c = criticalPeriod(mk(() => 1));
    expect([c.start, c.end]).toEqual([1, 42]);
  });
  it("ignores 2026 and returns null on a zero profile", () => {
    expect(criticalPeriod(mk((y) => (y === 2026 ? 9 : 0)))).toBeNull();
  });
});

describe("yearToDate", () => {
  it("compares the cumulative total with the other years", () => {
    const r = yearToDate(mk((y, w) => (w <= 3 ? y - 2000 : 0)), 2020, 3);
    expect(r).toEqual({ value: 60, percentile: 19 / 24 });
  });
  it("skips null weeks", () => {
    const r = yearToDate(mk((y, w) => (w === 2 ? null : 1)), 2020, 3);
    expect(r.value).toBe(2);
  });
});

describe("isSufficient and analyze", () => {
  it("needs a mean yearly total of at least 100", () => {
    expect(isSufficient(mk((y, w) => (w === 1 ? 99 : 0)))).toBe(false);
    expect(isSufficient(mk((y, w) => (w === 1 ? 100 : 0)))).toBe(true);
  });
  it("returns nothing to flag for a sparse area", () => {
    const a = analyze(mk((y, w) => (w === 1 && y === 2020 ? 50 : 0)));
    expect(a.sufficient).toBe(false);
    expect(a.stats.size).toBe(0);
    expect(a.critical).toBeNull();
  });
  it("returns stats and a critical period otherwise", () => {
    const a = analyze(mk((y, w) => (w === 30 ? 200 : 0)));
    expect(a.sufficient).toBe(true);
    expect([a.critical.start, a.critical.end]).toEqual([30, 30]);
    expect(a.stats.size).toBe(1352);
  });
});
