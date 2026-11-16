import { describe, it, expect } from "vitest";
import {
  regionState, MIN_YEARS_SCORED, parseHash, formatHash, regionView, regionTitle, regionHeading, createRegionLoader,
} from "./region.js";

const wt = (o = {}) => ({ years: 14, years_won: 9, mae_model: 1, mae_baseline: 2, ...o });

describe("regionState", () => {
  it("accepted when scored enough years", () => {
    const s = regionState({ accepted: true, method: "model", weekly_total: wt() });
    expect(s.state).toBe("accepted");
    expect([s.method, s.yearsScored, s.yearsWon, s.maeModel, s.maeBaseline]).toEqual(["model", 14, 9, 1, 2]);
    expect(MIN_YEARS_SCORED).toBe(14);
  });
  it("baseline when not accepted", () => {
    expect(regionState({ accepted: false, method: "baseline", weekly_total: wt() }).state).toBe("baseline");
  });
  it("not validated under 14 years", () => {
    expect(regionState({ accepted: true, method: "model", weekly_total: wt({ years: 13 }) }).state).toBe("not_validated");
  });
  it("the entry wins over the metrics", () => {
    const m = { accepted: true, method: "model", weekly_total: wt() };
    const e = { accepted: false, method: "baseline", years_scored: 14, weekly_total: wt() };
    expect(regionState(m, e).state).toBe("baseline");
  });
});

const R = [
  { id: "pantanal", status: "ok", nx: 45, ny: 70 },
  { id: "iberia", status: "ok", nx: 130, ny: 70 },
  { id: "indonesia", status: "no_data", nx: 160, ny: 70 },
];
const PANTANAL = { regionId: "pantanal", aoi: null };

describe("parseHash and formatHash", () => {
  it("reads an area for the default region", () => {
    expect(parseHash("#aoi=1,2,3,4", R)).toEqual({ regionId: "pantanal", aoi: { cx0: 1, cy0: 2, cx1: 3, cy1: 4 } });
  });
  it("keeps the area of another region within its grid and round-trips", () => {
    const h = parseHash("#region=iberia&aoi=100,2,129,4", R);
    expect(h).toEqual({ regionId: "iberia", aoi: { cx0: 100, cy0: 2, cx1: 129, cy1: 4 } });
    expect(formatHash("iberia", h.aoi)).toBe("#region=iberia&aoi=100,2,129,4");
  });
  it("falls back to the default for unknown or no_data regions", () => {
    expect(parseHash("#region=mars&aoi=1,2,3,4", R)).toEqual(PANTANAL);
    expect(parseHash("#region=indonesia", R)).toEqual(PANTANAL);
  });
  it("handles empty and unrelated hashes", () => {
    expect(parseHash("", R)).toEqual(PANTANAL);
    expect(parseHash("#outlook", R)).toEqual(PANTANAL);
  });
  it("formats the default region as empty and others by id", () => {
    expect(formatHash("pantanal", null)).toBe("");
    expect(formatHash("iberia", null)).toBe("#region=iberia");
  });
  it("names the region with an area, the Pantanal included", () => {
    const aoi = { cx0: 3, cy0: 4, cx1: 10, cy1: 12 };
    expect(formatHash("pantanal", aoi)).toBe("#region=pantanal&aoi=3,4,10,12");
    expect(parseHash(formatHash("pantanal", aoi), R)).toEqual({ regionId: "pantanal", aoi });
  });
});

describe("createRegionLoader", () => {
  const deferred = () => {
    const pending = {};
    const load = (region) => new Promise((resolve, reject) => { pending[region.id] = { resolve, reject }; });
    return { pending, loadRegion: createRegionLoader(load) };
  };
  const P = { id: "pantanal" }, I = { id: "iberia" };

  it("discards a late response from the previous region", async () => {
    const { pending, loadRegion } = deferred();
    const first = loadRegion(P);
    const second = loadRegion(I);
    pending.iberia.resolve("iberia data");
    pending.pantanal.resolve("pantanal data"); // the old region answers last
    expect(await second).toEqual({ region: I, data: "iberia data" });
    expect(await first).toBeNull();
  });
  it("discards a late failure of the previous region and rethrows the latest one", async () => {
    const { pending, loadRegion } = deferred();
    const first = loadRegion(P);
    const second = loadRegion(I);
    pending.pantanal.reject(new Error("old"));
    pending.iberia.reject(new Error("HTTP 404"));
    expect(await first).toBeNull();
    await expect(second).rejects.toThrow("HTTP 404");
  });
  it("keeps a single call", async () => {
    const { pending, loadRegion } = deferred();
    const only = loadRegion(P);
    pending.pantanal.resolve("data");
    expect(await only).toEqual({ region: P, data: "data" });
  });
  it("cancel drops a pending call, whether it succeeds or fails, and later calls still answer", async () => {
    const { pending, loadRegion } = deferred();
    const ok = loadRegion(P);
    loadRegion.cancel();
    pending.pantanal.resolve("late");
    expect(await ok).toBeNull();
    const bad = loadRegion(I);
    loadRegion.cancel();
    pending.iberia.reject(new Error("late failure"));
    expect(await bad).toBeNull();
    const next = loadRegion(P);
    pending.pantanal.resolve("fresh");
    expect(await next).toEqual({ region: P, data: "fresh" });
  });
});

describe("regionView and titles", () => {
  it("centres the box and sizes the zoom", () => {
    const v = regionView([-58.5, -22.5, -54, -15.5]);
    expect(v.longitude).toBeCloseTo(-56.25, 9);
    expect(v.latitude).toBeCloseTo(-19, 9);
    expect(Math.abs(v.zoom - 4.58)).toBeLessThan(0.05);
    expect(Math.abs(regionView([14, -17, 30, -10]).zoom - 3.39)).toBeLessThan(0.05);
  });
  it("builds the title and heading", () => {
    expect(regionTitle("Pantanal")).toBe("Pantanal - FireSeam, MODIS and VIIRS harmonized");
    expect(regionHeading("Pantanal")).toBe("FireSeam · Pantanal");
  });
});
