import { describe, it, expect } from "vitest";
import { weeksToNotes } from "./sound.js";

function makeCalendar() {
  const weeks = [];
  for (const year of [2019, 2020]) {
    for (let week = 1; week <= 52; week++) {
      let harmonized = year === 2020 ? week * 100 : 50;
      if (year === 2019 && week === 1) harmonized = null;
      if (year === 2019 && week === 2) harmonized = 0;
      weeks.push({ year, week, harmonized });
    }
  }
  weeks.find((w) => w.year === 2020 && w.week === 52).harmonized = 10000;
  return { weeks };
}

describe("weeksToNotes", () => {
  const cal = makeCalendar();
  it("silences null and zero weeks", () => {
    const notes = weeksToNotes(cal, 2019);
    expect(notes[0].velocity).toBe(0);
    expect(notes[0].midi).toBe(48);
    expect(notes[1].velocity).toBe(0);
    expect(notes[2].velocity).toBeGreaterThan(0);
  });
  it("maps the calendar maximum to midi 84 and velocity 1", () => {
    const notes = weeksToNotes(cal, 2020);
    expect(notes[51].midi).toBe(84);
    expect(notes[51].velocity).toBeCloseTo(1, 10);
  });
  it("returns [] for an absent year", () => {
    expect(weeksToNotes(cal, 1999)).toEqual([]);
  });
  it("keeps times in range and strictly increasing", () => {
    const notes = weeksToNotes(cal, 2020, 10);
    expect(notes).toHaveLength(52);
    for (let i = 0; i < notes.length; i++) {
      expect(notes[i].time).toBeGreaterThanOrEqual(0);
      expect(notes[i].time).toBeLessThan(10);
      if (i) expect(notes[i].time).toBeGreaterThan(notes[i - 1].time);
    }
  });
});
