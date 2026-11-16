// Per-cell values from the weekly cube, and the squares that draw them. Pure: no DOM, no deck.gl.

export const CELL_DEG = 0.1;

// One cell in one week, on the same area rule as areaCalendar. A gap week is null, never 0.
export function cellValue(modis, viirs, week) {
  if (week.status === "observed") return viirs;
  if (week.status === "estimated") return week.modis > 0 ? (modis * week.pred) / week.modis : 0;
  return null;
}

export function cellTotals(cube, calendar, { year, from = 1, to = 52, aoi = null }) {
  const totals = new Map();
  const y = cube.years.get(year);
  if (!y) return totals;
  const weeks = new Map();
  for (const w of calendar.weeks) if (w.year === year) weeks.set(w.week, w);
  for (let i = 0; i < y.n; i++) {
    const week = y.week[i];
    if (week < from || week > to) continue;
    const cell = y.cell[i];
    if (aoi) {
      const cx = cell % cube.nx;
      const cy = Math.floor(cell / cube.nx);
      if (cx < aoi.cx0 || cx > aoi.cx1 || cy < aoi.cy0 || cy > aoi.cy1) continue;
    }
    const w = weeks.get(week);
    if (!w) continue;
    const v = cellValue(y.modis[i], y.viirs[i], w);
    if (v !== null) totals.set(cell, (totals.get(cell) ?? 0) + v);
  }
  for (const [cell, v] of totals) if (!(v > 0)) totals.delete(cell);
  return totals;
}

export function cellPolygons(totals, bbox, cellDeg, nx) {
  const out = [];
  for (const [cell, value] of totals) {
    const x0 = bbox[0] + (cell % nx) * cellDeg;
    const y0 = bbox[1] + Math.floor(cell / nx) * cellDeg;
    const x1 = x0 + cellDeg;
    const y1 = y0 + cellDeg;
    out.push({ cell, value, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]] });
  }
  return out;
}

export function cellLayerLabel(year) {
  return `detections per ${CELL_DEG} degree cell in ${year}; not burned area and not risk`;
}
