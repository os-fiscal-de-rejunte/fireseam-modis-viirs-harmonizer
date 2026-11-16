import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderBriefing, TEXT, TOKENS, readLang, writeLang } from "./briefing.js";

const input = { regionId: "pantanal", regionName: "Pantanal", bounds: [-58.5, -22.5, -54, -15.5],
  isArea: false, year: 2026, asOf: "2026-11-04",
  state: { state: "baseline", method: "baseline", yearsScored: 14, yearsWon: 6, maeModel: 251.4, maeBaseline: 240.3 },
  critical: { start: 30, end: 42, share: 0.81 }, ytd: { value: 12345, percentile: 0.72, missing: 8 },
  unusual: Array.from({ length: 12 }, (_, i) => ({ week: 20 + i, value: 1000 + i, percentile: 0.95, record: i === 0 })),
  band: { q10: 0.7055, q90: 1.3467 },
  spots: { year: { total: 44, standard: 22, gap: 8, estimated: 1, nrt: 13, no_factor: 0, no_percentile: 0 },
           critical: { total: 13, standard: 3, gap: 2, estimated: 0, nrt: 8, no_factor: 0, no_percentile: 0 } } };
const nums = (html) => html.replace(/<html[^>]*>/, "").match(/\d[\d.,]*/g);

describe("briefing", () => {
  it("same numbers in both languages", () => {
    const en = renderBriefing(input, "en"), pt = renderBriefing(input, "pt-BR");
    expect(nums(pt)).toEqual(nums(en));
    expect(en).not.toBe(pt);
    for (const v of ["12,345", "72%", "8", "2026-11-04", "251.4", "240.3", "0.7055", "1.3467"])
      expect(en).toContain(v);
  });
  it("names the acceptance state in both languages", () => {
    expect(renderBriefing(input, "en")).toContain(TEXT.en.state_baseline);
    expect(renderBriefing(input, "pt-BR")).toContain(TEXT["pt-BR"].state_baseline);
  });
  it("has the same text keys in both languages", () => {
    expect(Object.keys(TEXT["pt-BR"]).sort()).toEqual(Object.keys(TEXT.en).sort());
  });
  it("no alert block without F2 and no top cells block without F3", () => {
    const html = renderBriefing(input, "en");
    expect(html).not.toContain('data-block="alert"');
    expect(html).not.toContain('data-block="top-cells"');
  });
  it("carries the print rules and caps the rows", () => {
    const html = renderBriefing(input, "en");
    expect(html).toMatch(/@page\s*{\s*size:\s*A4;\s*margin:\s*12mm;/);
    expect(html).toMatch(/\.block\s*{[^}]*break-inside:\s*avoid/);
    expect(html.match(/data-row="unusual"/g).length).toBe(8);
    expect(html).toContain("and 4 more");
    expect(renderBriefing(input, "pt-BR")).toContain("e mais 4");
  });
  it("reads and writes the language", () => {
    const mem = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
    expect(readLang(mem)).toBe("en");
    writeLang(mem, "pt-BR");
    expect(readLang(mem)).toBe("pt-BR");
    const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
    expect(readLang(broken)).toBe("en");
    expect(() => writeLang(broken, "pt-BR")).not.toThrow();
    expect(readLang(undefined)).toBe("en");
  });
  it("alert block: label only when the test did not run", () => {
    const off = { ran: false, reason: "season_wraps" };
    for (const lang of ["en", "pt-BR"]) {
      const html = renderBriefing({ ...input, alert: { current: off, test: off } }, lang);
      expect(html).toContain('data-block="alert"');
      expect(html).toContain(TEXT[lang].no_alert_season_wraps);
      expect(html).not.toContain(TEXT[lang].alert_since);
    }
  });
  it("alert block: six counts, same numbers in both languages", () => {
    const alert = {
      current: { ran: true, year: 2026, state: "alert", alertWeek: 24, gaps: 0, armed: { start: 22, end: 33 } },
      test: { ran: true, p: 0.9, counts: { hit: 3, late: 4, miss: 5, false_alarm: 6, quiet: 7, incomplete: 0 }, medianLead: 8 },
    };
    const en = renderBriefing({ ...input, alert }, "en"), pt = renderBriefing({ ...input, alert }, "pt-BR");
    expect(en).toContain('data-block="alert"');
    expect(en).toContain(TEXT.en.alert_since);
    for (const o of ["hit", "late", "miss", "false_alarm", "quiet", "incomplete"]) expect(en).toContain(TEXT.en["o_" + o]);
    expect(nums(pt)).toEqual(nums(en));
  });
  it("tokens match the app", () => {
    const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
    const root = css.match(/:root\s*{([^}]*)}/)[1];
    const decl = Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const keys = Object.keys(TOKENS);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(TOKENS[k], k).toBe(decl[k]);
    for (const k of ["--bg", "--line", "--text", "--muted", "--modis", "--viirs", "--fire", "--font", "--serif"])
      expect(keys).toContain(k);
  });
  it("screen is dark and print is paper", () => {
    const html = renderBriefing(input, "en");
    const style = html.match(/<style>([\s\S]*)<\/style>/)[1];
    const at = style.indexOf("@media print");
    expect(at).toBeGreaterThan(-1);
    expect(style.slice(0, at)).toMatch(/body\s*{[^}]*background:\s*var\(--bg\)/);
    expect(style.slice(at)).toMatch(/--bg:\s*#fff\b/);
  });
  it("draws one quality bar per scope with a total", () => {
    const bars = (html) => html.match(/<div[^>]*data-bar="[^"]*"[^>]*>[\s\S]*?<\/div><\/div>/g) ?? [];
    const full = bars(renderBriefing(input, "en"));
    expect(full.length).toBe(2);
    for (const bar of full) {
      const sum = [...bar.matchAll(/width:\s*([\d.]+)%/g)].reduce((s, m) => s + Number(m[1]), 0);
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.5);
    }
    expect(bars(renderBriefing({ ...input, spots: { ...input.spots, critical: null } }, "en")).length).toBe(1);
    const empty = { ...input.spots.year, total: 0, standard: 0, gap: 0, estimated: 0, nrt: 0 };
    expect(bars(renderBriefing({ ...input, spots: { year: empty, critical: null } }, "en")).length).toBe(0);
  });
  it("leaves out a figure that has no value", () => {
    expect(renderBriefing(input, "en")).toContain('data-fig="ytd"');
    const html = renderBriefing({ ...input, ytd: null }, "en");
    expect(html).toContain('data-block="figures"');
    expect(html).not.toContain('data-fig="ytd"');
    expect(html).not.toContain('data-fig="percentile"');
    expect(html).toContain(TEXT.en.ytd_none);
  });
});
