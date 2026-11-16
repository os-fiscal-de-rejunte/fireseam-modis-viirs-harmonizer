import { describe, expect, it } from "vitest";
import { asOfDate, weekSentence, ytdComparison } from "./weekline.js";

const observed = { status: "observed", modis: 120, viirs: 340, harmonized: 340 };
const estimated = { status: "estimated", modis: 120, viirs: null, harmonized: 310 };
const gapCell = { status: "gap", modis: null, viirs: null, harmonized: null };

describe("weekSentence", () => {
  it("names a record week, in the fire tone", () => {
    const s = weekSentence(observed, { percentile: 1, unusual: true, record: true });
    expect(s).toEqual({ text: "Record for this week of the year", fire: true });
  });

  it("names an unusual week with its percentile, in the fire tone", () => {
    const s = weekSentence(observed, { percentile: 0.92, unusual: true, record: false });
    expect(s).toEqual({ text: "Unusual week: above 92% of other years", fire: true });
  });

  it("places a usual week in the range of the other years", () => {
    const s = weekSentence(observed, { percentile: 0.4, unusual: false, record: false });
    expect(s).toEqual({ text: "Within the usual range: above 40% of other years", fire: false });
  });

  it("says the ends in words, never as 0% or 100%", () => {
    const low = weekSentence(observed, { percentile: 0, unusual: false, record: false });
    expect(low.text).toBe("Within the usual range: at or below every other year");
    const high = weekSentence(observed, { percentile: 0.996, unusual: true, record: false });
    expect(high).toEqual({ text: "Unusual week: at or above every other year", fire: true });
  });

  it("says an estimated week comes from MODIS", () => {
    expect(weekSentence(estimated, { percentile: 0.4, unusual: false, record: false }).text).toBe(
      "Within the usual range: above 40% of other years, estimated from MODIS",
    );
    expect(weekSentence(estimated, { percentile: 1, unusual: true, record: true })).toEqual({
      text: "Record for this week of the year, estimated from MODIS",
      fire: true,
    });
  });

  it("reads a gap week as no data, never as a number", () => {
    for (const cell of [gapCell, null, undefined, { status: "observed", harmonized: null }]) {
      const s = weekSentence(cell, { percentile: 0.5, unusual: false, record: false });
      expect(s).toEqual({ text: "No data this week", fire: false });
      expect(s.text).not.toMatch(/\d/);
    }
  });

  it("is hidden with no percentile and no gap", () => {
    expect(weekSentence(observed, undefined)).toBeNull();
    expect(weekSentence(observed, { percentile: null, unusual: false, record: false })).toBeNull();
    expect(weekSentence(estimated, { percentile: null, unusual: false, record: false })).toBeNull();
  });
});

describe("ytdComparison", () => {
  it("says at or below every other year when the percentile rounds to 0", () => {
    expect(ytdComparison(0)).toBe("at or below every other year");
    expect(ytdComparison(0.004)).toBe("at or below every other year");
  });

  it("says at or above every other year when the percentile rounds to 100", () => {
    expect(ytdComparison(1)).toBe("at or above every other year");
    expect(ytdComparison(0.996)).toBe("at or above every other year");
  });

  it("keeps the share of other years in between", () => {
    expect(ytdComparison(0.5)).toBe("above 50% of other years");
    expect(ytdComparison(0.006)).toBe("above 1% of other years");
    expect(ytdComparison(0.994)).toBe("above 99% of other years");
  });
});

describe("asOfDate", () => {
  it("writes the data date as day, short month and year in UTC", () => {
    expect(asOfDate("2026-11-11")).toBe("11 Nov 2026");
    expect(asOfDate("2026-09-01")).toBe("1 Sep 2026");
    expect(asOfDate("2025-12-31")).toBe("31 Dec 2025");
  });

  it("passes through a value that is not an ISO date", () => {
    expect(asOfDate("soon")).toBe("soon");
  });
});
