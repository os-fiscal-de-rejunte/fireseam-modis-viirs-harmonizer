import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeCube } from "./data.js";
import { areaCalendar } from "./aoi.js";
import { analyze, yearToDate, criticalPeriod } from "./stats.js";
import { renderBriefing } from "./briefing.js";
import { asOfWeek, blindSpotCounts } from "./blindspots.js";
import { regionState } from "./region.js";
import { alertTest } from "./alert.js";
import { cellTotals } from "./hotcells.js";
import { rankRegions } from "./ranking.js";

const root = new URL("../public/data/", import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const calendar = json("calendar.json");
const index = json("cube/index.json");
const metrics = json("metrics.json");
const reference = JSON.parse(readFileSync(new URL("./pantanal.reference.json", import.meta.url), "utf8"));
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
  it("matches the committed reference counts", () => {
    expect(asOfWeek(calendar)).toEqual({ year: reference.as_of_week[0], week: reference.as_of_week[1] });
    const n = blindSpotCounts(calendar, analyze(calendar));
    expect([n.gap, n.estimated, n.estimated_2012_on, n.nrt, n.no_factor]).toEqual([
      reference.gap_weeks_f1, reference.estimated, reference.estimated_2012_on, reference.nrt, reference.no_factor,
    ]);
  });
  it("accepts the regional model on today's export", () => {
    if (metrics.accepted && metrics.weekly_total.years >= 14) expect(regionState(metrics).state).toBe("accepted");
  });
  it("runs the alert test on the published calendar", () => {
    const analysis = analyze(calendar);
    const r = alertTest(calendar, analysis);
    expect(r.ran).toBe(true);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(25);
    const sums = new Map();
    for (const w of calendar.weeks) if (w.harmonized != null) sums.set(w.year, (sums.get(w.year) ?? 0) + w.harmonized);
    for (const s of r.seasons) {
      const gaps = calendar.weeks.filter(
        (w) => w.year === s.year && w.week >= r.armed.start && w.week <= r.armed.end && w.harmonized == null,
      ).length;
      if (gaps > 0) expect(s.outcome).toBe("incomplete");
      const others = [];
      for (let y = 2001; y <= 2025; y++) if (y !== s.year && sums.has(y)) others.push(sums.get(y));
      const pct = others.length < 10 ? null : others.filter((v) => v < sums.get(s.year)).length / others.length;
      expect(s.high).toBe(pct !== null && pct >= 0.75);
    }
    console.table(
      r.seasons.map((s) => ({
        year: s.year, outcome: s.outcome, alertWeek: s.alertWeek, peakWeek: s.peakWeek, lead: s.lead,
        total: Math.round(s.total), high: s.high, gaps: s.gaps,
      })),
    );
  });
  it("cell totals add up to the regional calendar", () => {
    for (const year of [2005, 2020]) {
      let want = 0;
      for (const w of calendar.weeks) {
        if (w.year !== year || w.status === "gap" || w.harmonized == null) continue;
        if (w.status === "estimated" && !w.modis) continue;
        want += w.harmonized;
      }
      let got = 0;
      for (const v of cellTotals(cube, calendar, { year }).values()) got += v;
      expect(got).toBeCloseTo(want, 3);
    }
  });
  it("briefing carries the screen's numbers, the same in both languages", () => {
    const [year, week] = reference.as_of_week;
    const analysis = analyze(calendar);
    const ytd = yearToDate(calendar, year, week);
    const c = analysis.critical;
    const input = {
      regionId: calendar.meta.region, regionName: "Pantanal", bounds: calendar.meta.bbox, isArea: false,
      year, asOf: calendar.meta.as_of, state: regionState(metrics), critical: c, ytd,
      unusual: [], band: metrics.uncertainty.full,
      spots: {
        year: blindSpotCounts(calendar, analysis, { year }),
        critical: c ? blindSpotCounts(calendar, analysis, { year, from: c.start, to: c.end }) : null,
      },
    };
    const en = renderBriefing(input, "en");
    const pt = renderBriefing(input, "pt-BR");
    expect(en).toContain(new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Math.round(ytd.value)));
    expect(en).toContain(calendar.meta.as_of);
    expect(en).toContain(String(input.spots.year.gap));
    const nums = (h) => h.replace(/<html[^>]*>/, "").match(/\d[\d.,]*/g);
    expect(nums(pt)).toEqual(nums(en));
  });
});

describe("published regions", () => {
  const regions = json("regions.json");
  const sample = JSON.parse(readFileSync(new URL("../../data/sample/export/regions.json", import.meta.url), "utf8"));
  const sampleRoot = new URL("../../data/sample/export/", import.meta.url);

  it("lists the five regions with the Pantanal first", () => {
    expect(regions.map((r) => r.id)).toEqual(sample.map((r) => r.id).filter((id) => id !== "synthetic"));
    expect(regions.length).toBe(5);
    expect(regions[0].id).toBe("pantanal");
  });
  it("the Pantanal row equals the metrics", () => {
    const p = regions.find((r) => r.id === "pantanal");
    expect([p.accepted, p.method, p.weekly_total]).toEqual([metrics.accepted, metrics.method, metrics.weekly_total]);
    expect(regionState(metrics, p)).toEqual(regionState(metrics));
  });
  it("season_wraps matches criticalPeriod", () => {
    const syn = sample.find((r) => r.id === "synthetic");
    const synCal = JSON.parse(readFileSync(new URL(`${syn.path}/calendar.json`, sampleRoot), "utf8"));
    const pairs = [[regions.find((r) => r.id === "pantanal"), calendar], [syn, synCal]];
    for (const [row, cal] of pairs) {
      const c = criticalPeriod(cal);
      expect(row.season_wraps).toBe(c !== null && (c.start === 1 || c.end === 52));
    }
  });
  it("ranks every region: no_data rows stay unselectable, the Pantanal ranks with a state", () => {
    const entries = regions.map((region) => ({
      region,
      calendar: region.id === "pantanal" ? calendar : null,
      error: region.status === "ok" && region.id !== "pantanal" ? "not loaded in this test" : null,
    }));
    const rows = rankRegions(entries);
    expect(rows.length).toBe(regions.length);
    for (const region of regions) {
      const r = rows.find((x) => x.id === region.id);
      if (region.status === "no_data") expect([r.kind, r.note, r.selectable]).toEqual(["no_data", "data not downloaded", false]);
    }
    const p = rows.find((r) => r.id === "pantanal");
    expect(p.selectable).toBe(true);
    expect(["accepted", "baseline", "not_validated"]).toContain(p.state);
  });

  // The entries the app builds: every row, with its published calendar when the row is `ok`.
  const entriesFrom = (rows, at) =>
    rows.map((region) => ({
      region,
      calendar:
        region.status === "ok"
          ? JSON.parse(readFileSync(new URL(`${region.path === "." ? "" : `${region.path}/`}calendar.json`, at), "utf8"))
          : null,
      error: null,
    }));
  const checkRanking = (rows, ranked) => {
    expect(ranked.length).toBe(rows.length);
    expect(new Set(ranked.map((r) => r.id))).toEqual(new Set(rows.map((r) => r.id)));
    for (const region of rows) {
      const r = ranked.find((x) => x.id === region.id);
      if (region.status === "ok") {
        expect(r.selectable).toBe(true);
        expect(["accepted", "baseline", "not_validated"]).toContain(r.state);
        expect(r.state).toBe(regionState(null, region).state);
      } else {
        expect([r.kind, r.note, r.selectable]).toEqual(["no_data", "data not downloaded", false]);
      }
    }
    const firstNoData = ranked.findIndex((r) => r.kind === "no_data");
    if (firstNoData >= 0) expect(ranked.slice(firstNoData).every((r) => r.kind === "no_data")).toBe(true);
  };
  it("ranks the published regions as the app loads them, none removed", () => {
    checkRanking(regions, rankRegions(entriesFrom(regions, root)));
  });
  it("ranks the six sample regions with both sample calendars, none removed", () => {
    expect(sample.length).toBe(6);
    checkRanking(sample, rankRegions(entriesFrom(sample, sampleRoot)));
  });
});
