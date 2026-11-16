// Ranking rows for the region list. Pure: no DOM, no fetch.
import { analyze, typicalYear, yearToDate } from "./stats.js";
import { asOfWeek } from "./blindspots.js";
import { regionState } from "./region.js";

const NO_DATA = "data not downloaded";
const WRAPS = "season crosses the year end: year to date and critical period are unreliable here";
const ORDER = ["ranked", "no_percentile", "insufficient", "load_error", "no_data"];

export function elapsedShare(calendar, critical, week) {
  if (!critical) return null;
  const typical = typicalYear(calendar);
  let done = 0;
  let all = 0;
  for (let k = critical.start; k <= critical.end; k++) {
    all += typical[k];
    if (k <= week) done += typical[k];
  }
  return all > 0 ? done / all : null;
}

export function regionRow({ region, calendar, error }) {
  const base = {
    id: region.id, name: region.name, kind: "ranked", state: null, asOf: null, ytd: null,
    critical: null, elapsed: null, seasonWraps: !!region.season_wraps, selectable: true, note: null,
  };
  if (region.status !== "ok") return { ...base, kind: "no_data", selectable: false, note: NO_DATA };
  if (!calendar) return { ...base, kind: "load_error", selectable: false, note: error ?? "load error" };
  const out = { ...base, state: regionState(null, region).state, asOf: asOfWeek(calendar) };
  if (out.seasonWraps) out.note = WRAPS;
  const analysis = analyze(calendar);
  if (!analysis.sufficient || !out.asOf) return { ...out, kind: "insufficient" };
  out.critical = analysis.critical;
  out.ytd = yearToDate(calendar, out.asOf.year, out.asOf.week);
  out.elapsed = elapsedShare(calendar, out.critical, out.asOf.week);
  out.kind = out.ytd.percentile === null ? "no_percentile" : "ranked";
  return out;
}

export function sortRows(rows) {
  const rank = (r) => ORDER.indexOf(r.kind);
  return rows
    .map((r, i) => [r, i])
    .sort(([a, i], [b, j]) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.kind === "ranked") {
        return (
          b.ytd.percentile - a.ytd.percentile ||
          (b.elapsed ?? -1) - (a.elapsed ?? -1) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        );
      }
      return i - j;
    })
    .map(([r]) => r);
}

export const rankRegions = (entries) => sortRows(entries.map(regionRow));
