// Area of interest: a rectangle of grid cells, {cx0, cy0, cx1, cy1}, inclusive.

const round1 = (x) => Math.round(x * 10) / 10;

function areaSums(cube, year, aoi) {
  const M = new Array(52).fill(0);
  const V = new Array(52).fill(0);
  const y = cube.years.get(year);
  if (!y) return { M, V };
  for (let i = 0; i < y.n; i++) {
    const cx = y.cell[i] % cube.nx;
    const cy = Math.floor(y.cell[i] / cube.nx);
    if (cx < aoi.cx0 || cx > aoi.cx1 || cy < aoi.cy0 || cy > aoi.cy1) continue;
    M[y.week[i] - 1] += y.modis[i];
    V[y.week[i] - 1] += y.viirs[i];
  }
  return { M, V };
}

export function areaCalendar(cube, calendar, aoi) {
  const sums = new Map();
  const weeks = calendar.weeks.map((w) => {
    if (!sums.has(w.year)) sums.set(w.year, areaSums(cube, w.year, aoi));
    const { M: Ms, V: Vs } = sums.get(w.year);
    const M = Ms[w.week - 1] ?? 0;
    const V = Vs[w.week - 1] ?? 0;
    const out = {
      ...w,
      modis: w.modis === null ? null : M,
      viirs: w.viirs === null ? null : V,
      pred: null,
      harmonized: null,
      lo: null,
      hi: null,
    };
    if (w.status === "observed") {
      out.harmonized = V;
    } else if (w.status === "estimated") {
      if (w.modis > 0) {
        out.harmonized = round1((M * w.pred) / w.modis);
        out.lo = round1((M * w.lo) / w.modis);
        out.hi = round1((M * w.hi) / w.modis);
      } else {
        out.harmonized = 0;
        out.factor = false;
      }
      out.pred = out.harmonized;
    }
    return out;
  });
  return { meta: { ...calendar.meta, aoi }, weeks };
}

const clamp = (v, n) => Math.min(Math.max(v, 0), n - 1);

export function cellsFromLonLat(a, b, bbox, cellDeg, nx, ny) {
  const cx = (lon) => clamp(Math.floor((lon - bbox[0]) / cellDeg), nx);
  const cy = (lat) => clamp(Math.floor((lat - bbox[1]) / cellDeg), ny);
  const xa = cx(a[0]), xb = cx(b[0]), ya = cy(a[1]), yb = cy(b[1]);
  return { cx0: Math.min(xa, xb), cy0: Math.min(ya, yb), cx1: Math.max(xa, xb), cy1: Math.max(ya, yb) };
}

export function aoiBounds(aoi, bbox, cellDeg) {
  return [
    bbox[0] + aoi.cx0 * cellDeg,
    bbox[1] + aoi.cy0 * cellDeg,
    bbox[0] + (aoi.cx1 + 1) * cellDeg,
    bbox[1] + (aoi.cy1 + 1) * cellDeg,
  ];
}

export function formatAoiHash(aoi) {
  return `#aoi=${aoi.cx0},${aoi.cy0},${aoi.cx1},${aoi.cy1}`;
}

export function parseAoiHash(hash, nx, ny) {
  const m = /^#aoi=(\d+),(\d+),(\d+),(\d+)$/.exec(hash);
  if (!m) return null;
  const [cx0, cy0, cx1, cy1] = m.slice(1).map(Number);
  if (cx0 > cx1 || cy0 > cy1 || cx1 >= nx || cy1 >= ny) return null;
  return { cx0, cy0, cx1, cy1 };
}
