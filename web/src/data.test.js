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
  decodeCube,
  loadCube,
  loadRegions,
  regionBase,
  loadRegionData,
  loadCalendars,
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

function cubeBuffer(entries) {
  const n = entries.length;
  const buf = new ArrayBuffer(7 * n);
  const dv = new DataView(buf);
  entries.forEach(([cell, week, modis, viirs], i) => {
    dv.setUint16(2 * i, cell, true);
    dv.setUint8(2 * n + i, week);
    dv.setUint16(3 * n + 2 * i, modis, true);
    dv.setUint16(5 * n + 2 * i, viirs, true);
  });
  return buf;
}

describe("decodeCube", () => {
  it("decodes the four blocks", () => {
    const c = decodeCube(cubeBuffer([[0, 1, 2, 10], [3149, 52, 65535, 0]]));
    expect(c.n).toBe(2);
    expect([...c.cell]).toEqual([0, 3149]);
    expect([...c.week]).toEqual([1, 52]);
    expect([...c.modis]).toEqual([2, 65535]);
    expect([...c.viirs]).toEqual([10, 0]);
  });
  it("rejects a size that is not a multiple of 7", () => {
    expect(() => decodeCube(new ArrayBuffer(6))).toThrow(/multiple of 7/);
  });
});

describe("loadCube", () => {
  const index = { nx: 45, ny: 70, years: { 2011: { n: 1 }, 2020: { n: 1 } } };
  const ok = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => body });

  it("loads every listed year", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.endsWith("index.json") ? ok(index) : ok(cubeBuffer([[7, 3, 1, 0]])),
    ));
    const cube = await loadCube("./a");
    expect([cube.nx, cube.ny]).toEqual([45, 70]);
    expect([...cube.years.keys()]).toEqual([2011, 2020]);
    expect(cube.years.get(2020).cell[0]).toBe(7);
  });

  it("names the failing file and retries on the next call", async () => {
    const fetchMock = vi.fn(async (url) =>
      url.endsWith("index.json") ? ok(index)
        : url.endsWith("2020.bin") ? { ok: false, status: 404 }
        : ok(cubeBuffer([[7, 3, 1, 0]])),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadCube("./b")).rejects.toThrow(/cube\/2020\.bin/);
    const calls = fetchMock.mock.calls.length;
    await expect(loadCube("./b")).rejects.toThrow();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("names the file when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.endsWith("index.json")) return ok(index);
      if (url.endsWith("2020.bin")) throw new TypeError("Failed to fetch");
      return ok(cubeBuffer([[7, 3, 1, 0]]));
    }));
    await expect(loadCube("./c")).rejects.toThrow(/cube\/2020\.bin/);
  });

  it("names the file when the body is not a multiple of 7", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.endsWith("index.json")) return ok(index);
      if (url.endsWith("2020.bin")) return ok(new ArrayBuffer(6));
      return ok(cubeBuffer([[7, 3, 1, 0]]));
    }));
    await expect(loadCube("./d")).rejects.toThrow(/cube\/2020\.bin/);
  });

  it("names the index file when its body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    })));
    await expect(loadCube("./e")).rejects.toThrow(/cube\/index\.json/);
  });

  it("rejects a year whose entry count differs from the index", async () => {
    const short = { nx: 45, ny: 70, years: { 2020: { n: 2 } } };
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.endsWith("index.json") ? ok(short) : ok(cubeBuffer([[7, 3, 1, 0]])),
    ));
    const err = await loadCube("./f").catch((e) => e);
    expect(err.message).toMatch(/cube\/2020\.bin/);
    expect(err.message).toMatch(/expected 2 entries, got 1/);
  });
});

describe("decodePoints origin", () => {
  it("decodes against a region origin and keeps the default", () => {
    const buf = buildBuffer([{ lon: 1000, lat: 1000, doy: 1, flags: 0, frp: 0 }]);
    const d = decodePoints(buf, [100, -4]);
    expect(d.lon[0]).toBeCloseTo(101, 4);
    expect(d.lat[0]).toBeCloseTo(-3, 4);
    const e = decodePoints(buf);
    expect(e.lon[0]).toBeCloseTo(-57.5, 4);
    expect(e.lat[0]).toBeCloseTo(-21.5, 4);
  });
});

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

describe("regionBase", () => {
  it("is the base for the root path and a subfolder otherwise", () => {
    expect(regionBase("./data", { path: "." })).toBe("./data");
    expect(regionBase("./data", { path: "regions/iberia" })).toBe("./data/regions/iberia");
  });
});

describe("loadRegions", () => {
  it("reads regions.json", async () => {
    const fetchMock = vi.fn(async () => okJson([{ id: "a" }]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadRegions("./d")).toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledWith("./d/regions.json");
  });
});

describe("loadRegionData", () => {
  it("never fetches the points index without the points file", async () => {
    const urls = [];
    vi.stubGlobal("fetch", vi.fn(async (u) => (urls.push(u), okJson({ u }))));
    const out = await loadRegionData({ path: "regions/x", has: [] }, "./data");
    expect(out.index).toBeNull();
    expect(out.calendar).toEqual({ u: "./data/regions/x/calendar.json" });
    expect(urls.some((u) => u.includes("points/index.json"))).toBe(false);
  });
  it("fetches the points index when listed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u) => okJson({ u })));
    const out = await loadRegionData({ path: ".", has: ["points"] }, "./data");
    expect(out.index).toEqual({ u: "./data/points/index.json" });
  });
});

describe("loadCalendars", () => {
  it("keeps a failure as an error and never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u) => (u.includes("/b/") ? { ok: false, status: 404 } : okJson({ u }))),
    );
    const regions = [
      { id: "a", status: "ok", path: "regions/a" },
      { id: "b", status: "ok", path: "regions/b" },
      { id: "c", status: "no_data", path: "regions/c" },
    ];
    const out = await loadCalendars(regions, "./data");
    expect(out.map((e) => e.region.id)).toEqual(["a", "b", "c"]);
    expect(out[0].calendar).toEqual({ u: "./data/regions/a/calendar.json" });
    expect(out[0].error).toBeNull();
    expect(out[1].calendar).toBeNull();
    expect(out[1].error).toMatch(/404/);
    expect([out[2].calendar, out[2].error]).toEqual([null, null]);
  });
});
