// The readout's sentence for one week, from the calendar cell and its week statistics.
// A gap reads as no data; a week without a percentile has no sentence (null).
// `fire` marks the unusual and record weeks.

const isGap = (cell) => !cell || cell.status === "gap" || cell.harmonized == null;
const hasPercentile = (stat) => stat?.percentile !== null && stat?.percentile !== undefined;

export function weekSentence(cell, stat) {
  if (isGap(cell)) return { text: "No data this week", fire: false };
  if (!hasPercentile(stat)) return null;
  const compared = ytdComparison(stat.percentile);
  let text;
  if (stat.record) text = "Record for this week of the year";
  else if (stat.unusual) text = `Unusual week: ${compared}`;
  else text = `Within the usual range: ${compared}`;
  if (cell.status === "estimated") text += ", estimated from MODIS";
  return { text, fire: !!(stat.record || stat.unusual) };
}

// How a week or a year to date compares with the other years, from its percentile (0 to 1).
// The two ends are said in words, so a share of 0% or 100% is never shown.
export function ytdComparison(percentile) {
  const pct = Math.round(percentile * 100);
  if (pct <= 0) return "at or below every other year";
  if (pct >= 100) return "at or above every other year";
  return `above ${pct}% of other years`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-11" as "11 Nov 2026" (the date is a UTC calendar day); anything else unchanged.
export function asOfDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
