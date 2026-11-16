import { describe, it, expect } from "vitest";
import { analyze } from "./stats.js";
import { asOfWeek, blindSpotCounts, weekCodes, qualitySentence } from "./blindspots.js";

function cal(over) {
  const weeks = [];
  for (let year = 2001; year <= 2026; year++)
    for (let week = 1; week <= 52; week++)
      weeks.push({ year, week, modis: 5, viirs: 10, harmonized: 10, status: "observed",
        nrt: false, why: null, ...(over[`${year}:${week}`] ?? {}) });
  return { meta: {}, weeks };
}
const gap = { modis: null, viirs: null, harmonized: null, status: "gap", why: "not_downloaded" };
const est = (o) => ({ viirs: null, harmonized: 8, status: "estimated", why: "viirs_outage", ...o });
const over = { "2026:10": gap, "2026:20": est({}), "2026:21": est({ modis: 0 }),
  "2026:39": { nrt: true }, "2026:40": { nrt: true } };
for (let w = 41; w <= 52; w++) over[`2026:${w}`] = gap;
const c = cal(over);

describe("blind spots", () => {
  it("weeks after as_of are left out", () => {
    expect(asOfWeek(c)).toEqual({ year: 2026, week: 40 });
    const n = blindSpotCounts(c, analyze(c), { year: 2026 });
    expect([n.total, n.gap, n.estimated, n.no_factor, n.nrt, n.standard]).toEqual([40, 1, 2, 1, 2, 35]);
    expect(n.why.viirs_outage).toBe(2);
    expect(blindSpotCounts(c, analyze(c)).gap).toBe(1);
  });
  it("counts a window of weeks", () => {
    expect(blindSpotCounts(c, analyze(c), { year: 2026, from: 19, to: 22 }).standard).toBe(2);
  });
  it("reads factor false on an area calendar", () => {
    const a = { meta: { aoi: {} }, weeks: c.weeks.map((w) => ({ ...w })) };
    a.weeks.find((w) => w.year === 2026 && w.week === 5).factor = false;
    // week 21 has modis 5 here, so the regional rule would count 0 for it
    a.weeks.find((w) => w.year === 2026 && w.week === 21).modis = 5;
    expect(blindSpotCounts(a, analyze(a), { year: 2026 }).no_factor).toBe(1);
  });
  it("reads an estimated week with modis 0 or null on a regional calendar", () => {
    expect(blindSpotCounts(c, analyze(c), { year: 2026 }).no_factor).toBe(1);
    const r = cal({ ...over, "2026:22": est({ modis: null }) });
    expect(blindSpotCounts(r, analyze(r), { year: 2026 }).no_factor).toBe(2);
  });
  it("codes a gap week and a missing percentile", () => {
    expect(weekCodes(c.weeks.find((w) => w.year === 2026 && w.week === 10), undefined, { isArea: false, sufficient: true })).toEqual(["gap"]);
    const ok = c.weeks[0];
    expect(weekCodes(ok, undefined, { isArea: false, sufficient: true })).toEqual(["no_percentile"]);
    expect(weekCodes(ok, { percentile: null }, { isArea: false, sufficient: true })).toEqual(["no_percentile"]);
    expect(weekCodes(ok, undefined, { isArea: false, sufficient: false })).toEqual([]);
  });
  it("writes the quality sentence", () => {
    const n = { standard: 35, total: 40 };
    expect(qualitySentence(n, 2026, false)).toBe("In the 2026 critical period, 35 of 40 weeks are observed with standard-quality data");
    expect(qualitySentence(n, 2026, true)).toBe("In the 2026 critical period, 35 of 40 weeks are observed with standard-quality data (weeks after the last published week are not counted)");
  });
});
