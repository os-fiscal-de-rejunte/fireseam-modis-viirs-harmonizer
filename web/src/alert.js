// Retrospective test of a year-to-date alert, and the alert state of the current year.
// Pure: no DOM, no fetch.

import { yearToDate, REF_FIRST, REF_LAST, MIN_REF } from "./stats.js";
import { asOfWeek } from "./blindspots.js";

export const DEFAULT_P = 0.9;
export const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
export const ARM_LEAD_WEEKS = 8;
export const HIGH_SEASON_P = 0.75;
export const OUTCOMES = ["hit", "late", "miss", "false_alarm", "quiet", "incomplete"];

const WEEKS = 52;

function rowsByYear(calendar) {
  const byYear = new Map();
  for (const w of calendar.weeks) {
    if (!byYear.has(w.year)) byYear.set(w.year, new Array(WEEKS + 1).fill(null));
    byYear.get(w.year)[w.week] = w.harmonized ?? null;
  }
  return byYear;
}

function armedWindow(critical) {
  return { start: Math.max(1, critical.start - ARM_LEAD_WEEKS), end: critical.end };
}

function notRun(analysis, seasonWraps) {
  if (seasonWraps) return { ran: false, reason: "season_wraps" };
  if (!analysis.sufficient || !analysis.critical) return { ran: false, reason: "insufficient" };
  return null;
}

// First armed week (not after `last`) where the year to date is at or above p and above 0.
function alertWeekOf(calendar, year, armed, p, last) {
  for (let k = armed.start; k <= Math.min(armed.end, last); k++) {
    const ytd = yearToDate(calendar, year, k);
    if (ytd.percentile !== null && ytd.percentile >= p && ytd.value > 0) return k;
  }
  return null;
}

function sumOf(row) {
  let s = 0;
  for (let k = 1; k <= WEEKS; k++) if (row[k] !== null) s += row[k];
  return s;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function alertTest(calendar, analysis, p = DEFAULT_P, seasonWraps = false) {
  const skip = notRun(analysis, seasonWraps);
  if (skip) return skip;
  const armed = armedWindow(analysis.critical);
  const byYear = rowsByYear(calendar);
  const sums = new Map();
  for (let y = REF_FIRST; y <= REF_LAST; y++) if (byYear.has(y)) sums.set(y, sumOf(byYear.get(y)));

  const seasons = [];
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  const leads = [];
  for (let year = REF_FIRST; year <= REF_LAST; year++) {
    const row = byYear.get(year);
    if (!row) continue;
    let gaps = 0;
    for (let k = armed.start; k <= armed.end; k++) if (row[k] === null) gaps++;
    let peakWeek = null;
    for (let k = 1; k <= WEEKS; k++) if (row[k] !== null && (peakWeek === null || row[k] > row[peakWeek])) peakWeek = k;
    const total = sums.get(year);
    const others = [...sums].filter(([y]) => y !== year).map(([, s]) => s);
    const high = others.length >= MIN_REF && others.filter((s) => s < total).length / others.length >= HIGH_SEASON_P;
    let alertWeek = null;
    let outcome = "incomplete";
    let lead = null;
    if (gaps === 0) {
      alertWeek = alertWeekOf(calendar, year, armed, p, WEEKS);
      if (high) {
        if (alertWeek === null) outcome = "miss";
        else if (alertWeek < peakWeek) {
          outcome = "hit";
          lead = peakWeek - alertWeek;
          leads.push(lead);
        } else outcome = "late";
      } else outcome = alertWeek !== null ? "false_alarm" : "quiet";
    }
    counts[outcome]++;
    seasons.push({ year, outcome, alertWeek, peakWeek, lead, total, high, gaps });
  }
  return { ran: true, p, armed, seasons, counts, medianLead: leads.length ? median(leads) : null };
}

export function currentAlert(calendar, analysis, p = DEFAULT_P, seasonWraps = false) {
  const skip = notRun(analysis, seasonWraps);
  if (skip) return skip;
  const armed = armedWindow(analysis.critical);
  const asOf = asOfWeek(calendar);
  if (!asOf) return { ran: false, reason: "insufficient" };
  const { year, week } = asOf;
  if (week < armed.start) return { ran: true, year, state: "not_armed", alertWeek: null, gaps: 0, armed };
  const row = rowsByYear(calendar).get(year);
  let gaps = 0;
  for (let k = armed.start; k <= Math.min(armed.end, week); k++) if (row[k] === null) gaps++;
  if (gaps > 0) return { ran: true, year, state: "incomplete", alertWeek: null, gaps, armed };
  const alertWeek = alertWeekOf(calendar, year, armed, p, week);
  return { ran: true, year, state: alertWeek === null ? "no_alert" : "alert", alertWeek, gaps: 0, armed };
}

export const LABELS = {
  season_wraps: "No alert for this region: its fire season crosses the year end, so the alert cannot be tested here",
  insufficient: "No alert: too few detections in this area to test it",
};

export function alertReadout(current, test) {
  if (!current.ran) return { kind: "label", text: LABELS[current.reason] ?? LABELS.insufficient };
  if (!test.ran) return { kind: "label", text: LABELS[test.reason] ?? LABELS.insufficient };
  const P = Math.round(test.p * 100);
  let head;
  if (current.state === "alert") head = `Alert since week ${current.alertWeek}: ${current.year} to date is at or above the ${P}th percentile`;
  else if (current.state === "no_alert") head = `No alert at the ${P}th percentile so far`;
  else if (current.state === "incomplete") head = `Incomplete: ${current.gaps} gap weeks inside the armed window`;
  else head = `Not armed yet: arms at week ${current.armed.start}`;
  const c = test.counts;
  // `head` is the current state alone, for a line that must never be cut.
  return {
    kind: "alert",
    head: `${head}.`,
    text: `${head}. Test at this threshold, ${REF_FIRST}-${REF_LAST}: ${c.hit} hits, ${c.late} late, ${c.miss} missed, ${c.false_alarm} false alarms, ${c.quiet} quiet, ${c.incomplete} incomplete`,
  };
}
