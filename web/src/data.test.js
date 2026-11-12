import { describe, it, expect, vi, afterEach } from "vitest";
import {
  weekIndex,
  decodePoints,
  weekSlice,
  loadData,
  loadForecast,
  forecastMonth,
  pooledShare,
  yearlyTotals,
} from "./data.js";

afterEach(() => vi.unstubAllGlobals());

describe("weekIndex", () => {
  it("maps year/week to a flat index", () => {
    expect(weekIndex(2001, 1)).toBe(0);
    expect(weekIndex(2002, 1)).toBe(52);
    expect(weekIndex(2026, 52)).toBe(1351);
  });
});

function buildBuffer(points) {
  const n = points.length;
  const buf = new ArrayBuffer(8 * n);
  const u16 = new Uint16Array(buf, 0, 3 * n);
  const u8 = new Uint8Array(buf, 6 * n);
  points.forEach((p, i) => {
    u16[i] = p.lon;
    u16[n + i] = p.lat;
    u16[2 * n + i] = p.doy;
    u8[i] = p.flags;
    u8[n + i] = p.frp;
  });
  return buf;
}

describe("decodePoints", () => {
  it("round-trips a small buffer", () => {
    const pts = [
      { lon: 0, lat: 0, doy: 1, flags: 0, frp: 0 },
      { lon: 2300, lat: 4500, doy: 200, flags: 0b0011, frp: 77 },
      { lon: 4500, lat: 7000, doy: 366, flags: 0b1100, frp: 255 },
    ];
    const d = decodePoints(buildBuffer(pts));
    expect(d.n).toBe(3);
    expect(d.lon[0]).toBeCloseTo(-58.5, 4);
    expect(d.lon[1]).toBeCloseTo(-56.2, 4);
    expect(d.lat[1]).toBeCloseTo(-18.0, 4);
    expect(d.lat[2]).toBeCloseTo(-15.5, 4);
    expect(Array.from(d.doy)).toEqual([1, 200, 366]);
    expect(Array.from(d.flags)).toEqual([0, 3, 12]);
    expect(Array.from(d.frp)).toEqual([0, 77, 255]);
  });

  it("throws on a truncated buffer", () => {
    expect(() => decodePoints(new ArrayBuffer(13))).toThrow();
  });
});

describe("weekSlice", () => {
  const index = { 2020: { n: 100, week_start: Array.from({ length: 52 }, (_, i) => i) } };
  it("returns [week_start[w-1], week_start[w])", () => {
    expect(weekSlice(index, 2020, 3)).toEqual([2, 3]);
  });
  it("uses n as the end of week 52", () => {
    expect(weekSlice(index, 2020, 52)).toEqual([51, 100]);
  });
});

describe("loadData", () => {
  it("rejects naming the missing file on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(loadData("./data")).rejects.toThrow(/calendar\.json/);
  });
});

describe("loadForecast", () => {
  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await loadForecast("./data")).toBeNull();
  });
  it("parses the file when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ cells: [] }) })),
    );
    expect(await loadForecast("./data")).toEqual({ cells: [] });
  });
});

describe("forecastMonth", () => {
  const cells = [
    { id: "a", released: true, p: [0.1, 0.2, null, 0.4, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: "b", released: false, p: Array(12).fill(null) },
    { id: "c", released: true, p: Array(12).fill(0.5) },
  ];
  it("keeps released cells with a value for that month", () => {
    const r = forecastMonth(cells, 2);
    expect(r.map((x) => [x.cell.id, x.p])).toEqual([
      ["a", 0.2],
      ["c", 0.5],
    ]);
  });
  it("filters null months", () => {
    expect(forecastMonth(cells, 3).map((x) => x.cell.id)).toEqual(["c"]);
  });
  it("keeps zero probabilities", () => {
    expect(forecastMonth(cells, 5).map((x) => x.cell.id)).toEqual(["a", "c"]);
  });
});

describe("pooledShare", () => {
  it("weights each row by its detection count", () => {
    const rows = [
      { u: 0.5, n: 100 },
      { u: 0.1, n: 300 },
    ];
    expect(pooledShare(rows, "u", "n")).toBeCloseTo(0.2, 10);
  });
  it("is null without rows", () => {
    expect(pooledShare([], "u", "n")).toBeNull();
  });
});

describe("yearlyTotals", () => {
  const wk = (year, week, modis, viirs, harmonized, status = "observed") => ({
    year,
    week,
    modis,
    viirs,
    harmonized,
    status,
  });
  const calendar = {
    weeks: [
      wk(2011, 1, 10, null, 40, "estimated"),
      wk(2011, 2, 20, null, 80, "estimated"),
      wk(2012, 1, 5, null, null, "gap"),
      wk(2012, 2, 6, 25, 25),
      wk(2012, 3, null, 30, 30),
    ],
  };
  const t = yearlyTotals(calendar);
  it("sums per year and series", () => {
    expect(t.map((r) => r.year)).toEqual([2011, 2012]);
    expect(t[0]).toMatchObject({ modis: 30, viirs: null, harmonized: 120 });
    expect(t[1]).toMatchObject({ modis: 6, viirs: 55, harmonized: 55 });
  });
  it("adds raw as modis plus viirs, ignoring nulls", () => {
    expect(t[0].raw).toBe(30);
    expect(t[1].raw).toBe(61);
    expect(t[0].partial.raw).toBe(true);
  });
  it("flags years with null or gap weeks as partial", () => {
    expect(t[0].partial).toEqual({ modis: false, viirs: true, harmonized: false, raw: true });
    expect(t[1].partial).toEqual({ modis: true, viirs: true, harmonized: true, raw: true });
  });
});
