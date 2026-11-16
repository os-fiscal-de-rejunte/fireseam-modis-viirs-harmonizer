import { describe, it, expect } from "vitest";
import { alertTest, currentAlert, alertReadout, DEFAULT_P } from "./alert.js";

// value(year, week) -> harmonized (null allowed), for 2001-2026 x 52 weeks
function mk(value) {
  const weeks = [];
  for (let year = 2001; year <= 2026; year++)
    for (let week = 1; week <= 52; week++) {
      const harmonized = value(year, week);
      weeks.push({ year, week, harmonized, status: harmonized === null ? "gap" : "observed" });
    }
  return { weeks };
}

const A = { sufficient: true, critical: { start: 30, end: 33, share: 1 } }; // armed 22-33
const season = (w) => (w >= 30 && w <= 33 ? 10 : 0);
const of = (r, y) => r.seasons.find((s) => s.year === y);

describe("alertTest", () => {
  it("hit with a known lead", () => {
    const r = alertTest(mk((y, w) => (y !== 2020 ? season(w) : w === 24 ? 100 : w === 32 ? 500 : season(w))), A);
    expect(of(r, 2020)).toMatchObject({ outcome: "hit", alertWeek: 24, peakWeek: 32, lead: 8, high: true });
    expect(r.counts).toEqual({ hit: 1, late: 0, miss: 0, false_alarm: 0, quiet: 24, incomplete: 0 });
    expect(r.medianLead).toBe(8);
    expect(r.armed).toEqual({ start: 22, end: 33 });
  });
  it("late when the alert comes with the peak", () => {
    const r = alertTest(mk((y, w) => (y === 2020 && w === 30 ? 500 : season(w))), A);
    expect(of(r, 2020)).toMatchObject({ outcome: "late", alertWeek: 30, peakWeek: 30 });
  });
  // four equal big years: each is above 21 of 24 others (0.875) at every armed week
  const four = mk((y, w) => (y >= 2020 && y <= 2023 ? season(w) * 10 : season(w)));
  it("miss at 0.90, and the threshold flips it", () => {
    expect(alertTest(four, A, 0.9).counts).toEqual({ hit: 0, late: 0, miss: 4, false_alarm: 0, quiet: 21, incomplete: 0 });
    expect(alertTest(four, A, 0.85).counts).toEqual({ hit: 0, late: 4, miss: 0, false_alarm: 0, quiet: 21, incomplete: 0 });
  });
  it("false alarm, quiet and incomplete", () => {
    const fa = alertTest(mk((y, w) => (y !== 2020 ? season(w) : w === 24 ? 5 : 0)), A);
    expect(of(fa, 2020)).toMatchObject({ outcome: "false_alarm", alertWeek: 24, high: false });
    expect(of(fa, 2010).outcome).toBe("quiet");
    const inc = alertTest(mk((y, w) => (y === 2020 && w === 25 ? null : season(w))), A);
    expect(of(inc, 2020)).toMatchObject({ outcome: "incomplete", gaps: 1 });
    expect(Object.values(inc.counts).reduce((a, b) => a + b)).toBe(25);
  });
  it("returns no state and a reason", () => {
    const c = mk((y, w) => season(w));
    expect(alertTest(c, A, 0.9, true)).toEqual({ ran: false, reason: "season_wraps" });
    expect(alertTest(c, { sufficient: false, critical: null })).toEqual({ ran: false, reason: "insufficient" });
    expect(currentAlert(c, A, 0.9, true)).toEqual({ ran: false, reason: "season_wraps" });
    expect(currentAlert(c, { sufficient: false, critical: null })).toEqual({ ran: false, reason: "insufficient" });
  });
});

describe("currentAlert", () => {
  it("current year state", () => {
    const upTo = (last, extra) => mk((y, w) => (y === 2026 ? (w > last ? null : extra(w)) : season(w)));
    expect(currentAlert(upTo(26, (w) => (w === 24 ? 100 : 0)), A)).toMatchObject({ year: 2026, state: "alert", alertWeek: 24, gaps: 0 });
    expect(currentAlert(upTo(26, () => 0), A).state).toBe("no_alert");
    expect(currentAlert(upTo(20, () => 0), A).state).toBe("not_armed");
    expect(currentAlert(upTo(26, (w) => (w === 23 ? null : 0)), A)).toMatchObject({ state: "incomplete", gaps: 1 });
  });
});

it("the default is 0.90", () => expect(DEFAULT_P).toBe(0.9));

describe("alertReadout", () => {
  const c = mk((y, w) => season(w));
  it("labels a wrapping season", () => {
    const r = alertReadout(currentAlert(c, A, 0.9, true), alertTest(c, A, 0.9, true));
    expect(r.kind).toBe("label");
    expect(r.text).toBe("No alert for this region: its fire season crosses the year end, so the alert cannot be tested here");
    expect(r.text).not.toContain("percentile");
  });
  it("labels an insufficient area", () => {
    const B = { sufficient: false, critical: null };
    const r = alertReadout(currentAlert(c, B), alertTest(c, B));
    expect(r).toEqual({ kind: "label", text: "No alert: too few detections in this area to test it" });
  });
  const test = { ran: true, p: 0.9, counts: { hit: 1, late: 0, miss: 0, false_alarm: 0, quiet: 24, incomplete: 0 }, medianLead: 8 };
  it("states the alert with the counts", () => {
    const cur = { ran: true, year: 2026, state: "alert", alertWeek: 24, gaps: 0, armed: { start: 22, end: 33 } };
    const r = alertReadout(cur, test);
    expect(r.kind).toBe("alert");
    expect(r.text).toContain("Alert since week 24");
    expect(r.text).toContain("1 hits");
  });
  it("states incomplete with the gap weeks", () => {
    const cur = { ran: true, year: 2026, state: "incomplete", alertWeek: null, gaps: 8, armed: { start: 22, end: 33 } };
    const r = alertReadout(cur, test);
    expect(r.text).toContain("8 gap weeks");
    expect(r.text).not.toContain("No alert");
  });
  it("gives the current state alone, without the test counts, for the readout", () => {
    const states = [
      [{ ran: true, year: 2026, state: "alert", alertWeek: 24, gaps: 0, armed: { start: 22, end: 33 } },
        "Alert since week 24: 2026 to date is at or above the 90th percentile."],
      [{ ran: true, year: 2026, state: "no_alert", alertWeek: null, gaps: 0, armed: { start: 22, end: 33 } },
        "No alert at the 90th percentile so far."],
      [{ ran: true, year: 2026, state: "not_armed", alertWeek: null, gaps: 0, armed: { start: 22, end: 33 } },
        "Not armed yet: arms at week 22."],
    ];
    for (const [cur, head] of states) {
      const r = alertReadout(cur, test);
      expect(r.head).toBe(head);
      expect(r.head).not.toContain("hits");
      expect(r.text.startsWith(head)).toBe(true);
    }
  });
});
