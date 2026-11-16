// Blind-spot counts over a calendar. Pure.
const key = (y, w) => `${y}:${w}`;

export function asOfWeek(calendar) {
  const weeks = calendar.weeks;
  for (let i = weeks.length - 1; i >= 0; i--)
    if (weeks[i].status !== "gap") return { year: weeks[i].year, week: weeks[i].week };
  return null;
}

export function weekCodes(week, stat, { isArea = false, sufficient = false } = {}) {
  if (week.status === "gap") return ["gap"];
  const codes = [];
  if (week.status === "estimated") codes.push("estimated");
  const noFactor = isArea ? week.factor === false : week.status === "estimated" && !week.modis;
  if (noFactor) codes.push("no_factor");
  if (week.nrt) codes.push("nrt");
  if (sufficient && (!stat || stat.percentile == null)) codes.push("no_percentile");
  return codes;
}

export function blindSpotCounts(calendar, analysis, { year = null, from = 1, to = 52 } = {}) {
  const asOf = asOfWeek(calendar);
  const isArea = calendar.meta?.aoi != null;
  const sufficient = !!analysis?.sufficient;
  const n = {
    total: 0, standard: 0, gap: 0, estimated: 0, estimated_2012_on: 0,
    why: { pre_viirs: 0, viirs_outage: 0, modis_outage: 0, not_downloaded: 0 },
    no_factor: 0, nrt: 0, no_percentile: 0,
  };
  if (!asOf) return n;
  for (const w of calendar.weeks) {
    if (year != null && w.year !== year) continue;
    if (w.week < from || w.week > to) continue;
    if (w.year > asOf.year || (w.year === asOf.year && w.week > asOf.week)) continue;
    n.total++;
    const codes = weekCodes(w, analysis?.stats?.get(key(w.year, w.week)), { isArea, sufficient });
    if (!codes.length) n.standard++;
    if (codes.includes("gap")) n.gap++;
    if (codes.includes("estimated")) {
      n.estimated++;
      if (w.year >= 2012) n.estimated_2012_on++;
      if (w.why in n.why) n.why[w.why]++;
    }
    if (codes.includes("no_factor")) n.no_factor++;
    if (codes.includes("nrt")) n.nrt++;
    if (codes.includes("no_percentile")) n.no_percentile++;
  }
  return n;
}

export function qualitySentence(counts, year, cut) {
  return `In the ${year} critical period, ${counts.standard} of ${counts.total} weeks are observed with standard-quality data` +
    (cut ? " (weeks after the last published week are not counted)" : "");
}
