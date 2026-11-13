import { describe, it, expect } from "vitest";
import { toCsv, csvFileName } from "./csv.js";

const base = { nrt: false, pred: null };
const calendar = { weeks: [
  { ...base, year: 2020, week: 1, modis: 5, viirs: 30, harmonized: 30, lo: null, hi: null, status: "observed" },
  { ...base, year: 2020, week: 2, modis: 4, viirs: null, harmonized: 20.5, lo: 10, hi: 40, status: "estimated" },
  { ...base, year: 2020, week: 5, modis: null, viirs: null, harmonized: null, lo: null, hi: null, status: "gap" },
  { ...base, year: 2024, week: 52, modis: 0, viirs: 0, harmonized: 0, lo: null, hi: null, status: "observed" },
] };
const stats = new Map([
  ["2020:1", { percentile: 22 / 24, unusual: true, record: false }],
  ["2020:2", { percentile: 0.5, unusual: false, record: false }],
  ["2024:52", { percentile: null, unusual: false, record: false }],
]);

describe("toCsv", () => {
  it("writes one row per week with empty fields for nulls", () => {
    expect(toCsv(calendar, stats)).toBe(
      "year,week,week_start,modis,viirs,harmonized,lo,hi,status,percentile,unusual\n" +
        "2020,1,2020-01-01,5,30,30,,,observed,0.917,true\n" +
        "2020,2,2020-01-08,4,,20.5,10,40,estimated,0.5,false\n" +
        "2020,5,2020-01-29,,,,,,gap,,\n" +
        "2024,52,2024-12-23,0,0,0,,,observed,,\n",
    );
  });
  it("works without stats", () => {
    expect(toCsv({ weeks: [calendar.weeks[0]] }, new Map()).split("\n")[1]).toBe(
      "2020,1,2020-01-01,5,30,30,,,observed,,",
    );
  });
});

describe("csvFileName", () => {
  it("carries the bounds with one decimal", () => {
    expect(csvFileName([-58.5, -22.5, -54, -15.5])).toBe("fire-calendar_-58.5_-22.5_-54.0_-15.5.csv");
    expect(csvFileName([-58.5, -22.5, -58.2, -22.299999999])).toBe("fire-calendar_-58.5_-22.5_-58.2_-22.3.csv");
  });
});
