// Unusual weeks, critical period and year-to-date comparison for a calendar.
// Pure statistics: no imports, no DOM, no fetch.

export const REF_FIRST = 2001;
export const REF_LAST = 2025;
export const MIN_REF = 10;
export const UNUSUAL_P = 0.9;
export const CRITICAL_SHARE = 0.8;
export const MIN_YEARLY_MEAN = 100;

const WEEKS = 52;

// year -> array indexed by week (1..52) of harmonized values (null when absent)
function index(calendar) {
  const byYear = new Map();
  for (const w of calendar.weeks) {
    if (!byYear.has(w.year)) byYear.set(w.year, new Array(WEEKS + 1).fill(null));
    byYear.get(w.year)[w.week] = w.harmonized ?? null;
  }
  return byYear;
}

function referenceYears(byYear, except) {
  const years = [];
  for (let y = REF_FIRST; y <= REF_LAST; y++) if (y !== except && byYear.has(y)) years.push(y);
  return years;
}

function percentileOf(value, refs) {
  if (refs.length < MIN_REF) return null;
  let below = 0;
  for (const r of refs) if (r < value) below++;
  return below / refs.length;
}

export function weekStats(calendar) {
  const byYear = index(calendar);
  const out = new Map();
  for (const [year, row] of byYear) {
    for (let week = 1; week <= WEEKS; week++) {
      const value = row[week];
      if (value === null) continue;
      const refs = [];
      for (const y of referenceYears(byYear, year)) {
        const r = byYear.get(y)[week];
        if (r !== null) refs.push(r);
      }
      const percentile = percentileOf(value, refs);
      const unusual = percentile !== null && percentile >= UNUSUAL_P && value > 0;
      const record = percentile !== null && value > 0 && refs.every((r) => value > r);
      out.set(`${year}:${week}`, { percentile, unusual, record });
    }
  }
  return out;
}

export function criticalPeriod(calendar) {
  const byYear = index(calendar);
  const years = referenceYears(byYear, null);
  const mean = new Array(WEEKS + 1).fill(0);
  let total = 0;
  for (let week = 1; week <= WEEKS; week++) {
    let sum = 0;
    let n = 0;
    for (const y of years) {
      const v = byYear.get(y)[week];
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    mean[week] = n ? sum / n : 0;
    total += mean[week];
  }
  if (!(total > 0)) return null;
  const target = CRITICAL_SHARE * total - 1e-9;
  let best = null;
  for (let start = 1; start <= WEEKS; start++) {
    let sum = 0;
    for (let end = start; end <= WEEKS; end++) {
      sum += mean[end];
      if (sum >= target) {
        if (!best || end - start < best.end - best.start) best = { start, end, share: sum / total };
        break;
      }
    }
  }
  return best;
}

function cumulative(row, week) {
  let sum = 0;
  for (let k = 1; k <= week; k++) if (row[k] !== null) sum += row[k];
  return sum;
}

export function yearToDate(calendar, year, week) {
  const byYear = index(calendar);
  const value = cumulative(byYear.get(year), week);
  const refs = referenceYears(byYear, year).map((y) => cumulative(byYear.get(y), week));
  return { value, percentile: percentileOf(value, refs) };
}

export function isSufficient(calendar) {
  const byYear = index(calendar);
  const years = referenceYears(byYear, null);
  if (!years.length) return false;
  let total = 0;
  for (const y of years) total += cumulative(byYear.get(y), WEEKS);
  return total / years.length >= MIN_YEARLY_MEAN;
}

export function analyze(calendar) {
  if (!isSufficient(calendar)) return { sufficient: false, stats: new Map(), critical: null };
  return { sufficient: true, stats: weekStats(calendar), critical: criticalPeriod(calendar) };
}
