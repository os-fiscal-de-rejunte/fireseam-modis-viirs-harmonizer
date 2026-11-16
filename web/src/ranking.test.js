import { describe, it, expect } from "vitest";
import { elapsedShare, regionRow, sortRows, rankRegions } from "./ranking.js";

function mk(value) {
  const weeks = [];
  for (let year = 2001; year <= 2026; year++)
    for (let week = 1; week <= 52; week++)
      weeks.push({ year, week, harmonized: value(year, week), status: "observed" });
  return { meta: {}, weeks };
}

const row = (id, kind, percentile, elapsed, state = "accepted") =>
  ({ id, kind, state, ytd: percentile === null ? null : { percentile }, elapsed });

describe("sortRows", () => {
  it("sorts by percentile, then elapsed share, and removes nothing", () => {
    const out = sortRows([row("nodata", "no_data", null, null, null), row("a", "ranked", 0.9, 0.2),
      row("failed", "ranked", 0.5, 0.9, "baseline"), row("b", "ranked", 0.9, 0.6), row("thin", "insufficient", null, null)]);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "failed", "thin", "nodata"]);
    expect(out.find((r) => r.id === "failed").state).toBe("baseline");
  });
  it("breaks full ties by id and keeps input order inside the other groups", () => {
    const out = sortRows([row("z", "ranked", 0.5, 0.5), row("y", "ranked", 0.5, 0.5),
      row("e2", "load_error", null, null), row("np", "no_percentile", null, null), row("e1", "load_error", null, null)]);
    expect(out.map((r) => r.id)).toEqual(["y", "z", "np", "e2", "e1"]);
  });
});

const crit = { start: 30, end: 33, share: 1 };
const prof = (last) => mk((y, w) => ({ 30: 10, 31: 40, 32: 40, 33: last })[w] ?? 0);

describe("elapsedShare", () => {
  it("is a fraction over the critical weeks", () => {
    expect(elapsedShare(prof(10), crit, 31)).toBeCloseTo(0.5, 9);
    expect(elapsedShare(prof(60), crit, 31)).toBeCloseTo(50 / 150, 9);
    expect(elapsedShare(prof(10), crit, 29)).toBe(0);
    expect(elapsedShare(prof(10), crit, 33)).toBe(1);
    expect(elapsedShare(prof(10), crit, 40)).toBe(1);
    expect(elapsedShare(prof(10), null, 31)).toBeNull();
  });
});

describe("regionRow", () => {
  const meta = (o = {}) => ({ id: "iberia", name: "Iberia", status: "ok", accepted: false, years_scored: 14, season_wraps: false, ...o });
  it("marks a region without data", () => {
    const r = regionRow({ region: { id: "iberia", name: "Iberia", status: "no_data" }, calendar: null, error: null });
    expect([r.kind, r.note, r.selectable, r.state]).toEqual(["no_data", "data not downloaded", false, null]);
  });
  it("marks a load error with its text", () => {
    const r = regionRow({ region: meta(), calendar: null, error: "HTTP 404" });
    expect([r.kind, r.note, r.selectable, r.state]).toEqual(["load_error", "HTTP 404", false, null]);
  });
  it("ranks a region with a calendar and keeps its baseline state", () => {
    const cal = mk((y, w) => ({ 30: 10, 31: 40, 32: 40, 33: 10 })[w] * 10 || 0);
    const r = regionRow({ region: meta(), calendar: cal, error: null });
    expect(r.kind).toBe("ranked");
    expect(r.state).toBe("baseline");
    expect(r.ytd).toHaveProperty("missing");
    expect(r.selectable).toBe(true);
    expect(r.asOf).toEqual({ year: 2026, week: 52 });
  });
  it("keeps an insufficient region selectable", () => {
    const r = regionRow({ region: meta(), calendar: mk(() => 0), error: null });
    expect([r.kind, r.selectable, r.ytd, r.critical]).toEqual(["insufficient", true, null, null]);
  });
  it("flags a season that crosses the year end", () => {
    const cal = mk(() => 20);
    const r = regionRow({ region: meta({ season_wraps: true }), calendar: cal, error: null });
    expect(r.seasonWraps).toBe(true);
    expect(r.note).toBe("season crosses the year end: year to date and critical period are unreliable here");
  });
});

describe("rankRegions", () => {
  it("returns one row per entry", () => {
    const e = { region: { id: "x", name: "X", status: "no_data" }, calendar: null, error: null };
    expect(rankRegions([e]).length).toBe(1);
  });
});
