const HEADER = "year,week,week_start,modis,viirs,harmonized,lo,hi,status,percentile,unusual";
const DAY_MS = 86400000;

const field = (v) => (v === null || v === undefined ? "" : String(v));

function weekStart(year, week) {
  const ms = Date.UTC(year, 0, 1) + 7 * (week - 1) * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function toCsv(calendar, stats) {
  const lines = [HEADER];
  for (const w of calendar.weeks) {
    const s = stats.get(`${w.year}:${w.week}`);
    const hasP = s && s.percentile !== null && s.percentile !== undefined;
    lines.push(
      [
        w.year,
        w.week,
        weekStart(w.year, w.week),
        field(w.modis),
        field(w.viirs),
        field(w.harmonized),
        field(w.lo),
        field(w.hi),
        w.status,
        hasP ? Number(s.percentile.toFixed(3)) : "",
        hasP ? String(Boolean(s.unusual)) : "",
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function csvFileName(bounds) {
  return `fire-calendar_${bounds.map((b) => b.toFixed(1)).join("_")}.csv`;
}

export function downloadCsv(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
