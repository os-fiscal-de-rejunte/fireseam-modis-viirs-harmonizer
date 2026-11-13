export const FIRST_YEAR = 2001;
export const WEEKS = 52;

export function weekIndex(year, week) {
  return (year - FIRST_YEAR) * WEEKS + week - 1;
}

export function decodePoints(buf) {
  if (buf.byteLength % 8 !== 0) {
    throw new Error(`Point file has ${buf.byteLength} bytes, not a multiple of 8`);
  }
  const n = buf.byteLength / 8;
  const u16 = (offset) => new Uint16Array(buf.slice(offset, offset + 2 * n));
  const lonCode = u16(0);
  const latCode = u16(2 * n);
  const doy = u16(4 * n);
  const lon = new Float32Array(n);
  const lat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = lonCode[i] / 1000 - 58.5;
    lat[i] = latCode[i] / 1000 - 22.5;
  }
  const flags = new Uint8Array(buf.slice(6 * n, 7 * n));
  const frp = new Uint8Array(buf.slice(7 * n, 8 * n));
  return { n, lon, lat, doy, flags, frp };
}

export function weekSlice(index, year, week) {
  const entry = index[String(year)];
  if (!entry) return [0, 0];
  const start = entry.week_start[week - 1];
  const end = week >= WEEKS ? entry.n : entry.week_start[week];
  return [start, end];
}

export function forecastMonth(cells, month) {
  const out = [];
  for (const cell of cells) {
    if (!cell.released) continue;
    const p = cell.p[month - 1];
    if (p !== null && p !== undefined) out.push({ cell, p });
  }
  return out;
}

async function fetchJson(url, name) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not load ${name}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
  return res.json();
}

export async function loadData(base = "./data") {
  const [calendar, metrics, index] = await Promise.all([
    fetchJson(`${base}/calendar.json`, "calendar.json"),
    fetchJson(`${base}/metrics.json`, "metrics.json"),
    fetchJson(`${base}/points/index.json`, "points/index.json"),
  ]);
  return { calendar, metrics, index };
}

export async function loadForecast(base = "./data") {
  let res;
  try {
    res = await fetch(`${base}/forecast.json`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const yearCache = new Map();

export function loadYear(year, base = "./data") {
  if (!yearCache.has(year)) {
    const p = fetch(`${base}/points/${year}.bin`)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load points/${year}.bin (HTTP ${res.status})`);
        return res.arrayBuffer();
      })
      .then(decodePoints);
    p.catch(() => yearCache.delete(year));
    yearCache.set(year, p);
  }
  return yearCache.get(year);
}

export function decodeCube(buf) {
  if (buf.byteLength % 7 !== 0) {
    throw new Error(`Cube file has ${buf.byteLength} bytes, not a multiple of 7`);
  }
  const n = buf.byteLength / 7;
  const u16 = (offset) => new Uint16Array(buf.slice(offset, offset + 2 * n));
  return {
    n,
    cell: u16(0),
    week: new Uint8Array(buf.slice(2 * n, 3 * n)),
    modis: u16(3 * n),
    viirs: u16(5 * n),
  };
}

const cubeCache = new Map();

async function fetchCubeYear(year, base) {
  const name = `cube/${year}.bin`;
  let res;
  try {
    res = await fetch(`${base}/${name}`);
  } catch (err) {
    throw new Error(`Could not load ${name}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
  try {
    return decodeCube(await res.arrayBuffer());
  } catch (err) {
    throw new Error(`Could not load ${name}: ${err.message}`);
  }
}

export function loadCube(base = "./data") {
  if (!cubeCache.has(base)) {
    const p = fetchJson(`${base}/cube/index.json`, "cube/index.json").then(async (index) => {
      const years = Object.keys(index.years).map(Number).sort((a, b) => a - b);
      const decoded = await Promise.all(years.map((y) => fetchCubeYear(y, base)));
      return { nx: index.nx, ny: index.ny, years: new Map(years.map((y, i) => [y, decoded[i]])) };
    });
    p.catch(() => cubeCache.delete(base));
    cubeCache.set(base, p);
  }
  return cubeCache.get(base);
}

// Share of `key` pooled over rows, weighted by `weightKey` (e.g. unmatched share by detections).
export function pooledShare(rows, key, weightKey) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    num += r[key] * r[weightKey];
    den += r[weightKey];
  }
  return den > 0 ? num / den : null;
}

const SERIES = ["modis", "viirs", "harmonized"];

// Yearly sums per series (and `raw` = modis + viirs), ignoring null weeks. A series is `partial` in a year when any of its
// 52 weeks is null (outage or not yet covered); its sum is null when every week is null.
export function yearlyTotals(calendar) {
  const byYear = new Map();
  for (const w of calendar.weeks) {
    let acc = byYear.get(w.year);
    if (!acc) {
      acc = { year: w.year };
      for (const s of SERIES) acc[s] = { sum: 0, seen: 0, missing: 0 };
      byYear.set(w.year, acc);
    }
    for (const s of SERIES) {
      const v = w[s];
      if (v == null || w.status === "gap") acc[s].missing += 1;
      else {
        acc[s].sum += v;
        acc[s].seen += 1;
      }
    }
  }
  return [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map((acc) => {
      const out = { year: acc.year, partial: {} };
      for (const s of SERIES) {
        out[s] = acc[s].seen ? acc[s].sum : null;
        out.partial[s] = acc[s].missing > 0;
      }
      // Naive combined record: MODIS plus VIIRS as published, with nulls ignored.
      out.raw = out.modis == null && out.viirs == null ? null : (out.modis ?? 0) + (out.viirs ?? 0);
      out.partial.raw = out.partial.modis || out.partial.viirs;
      return out;
    });
}
