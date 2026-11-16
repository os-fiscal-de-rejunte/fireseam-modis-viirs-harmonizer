import { parseAoiHash, formatAoiHash } from "./aoi.js";

// Region state from the model metrics, or from a regions.json row. Pure.
export const MIN_YEARS_SCORED = 14;

export function regionState(metrics, entry = null) {
  const src = entry ?? metrics ?? {};
  const wt = src.weekly_total ?? {};
  const yearsScored = entry ? entry.years_scored ?? wt.years ?? 0 : wt.years ?? 0;
  const state = yearsScored < MIN_YEARS_SCORED ? "not_validated" : src.accepted ? "accepted" : "baseline";
  return {
    state,
    method: src.method ?? null,
    yearsScored,
    yearsWon: wt.years_won ?? null,
    maeModel: wt.mae_model ?? null,
    maeBaseline: wt.mae_baseline ?? null,
  };
}

export const DEFAULT_REGION = "pantanal";

export function parseHash(hash, regions) {
  const params = new Map();
  for (const part of hash.replace(/^#/, "").split("&")) {
    const i = part.indexOf("=");
    if (i > 0) params.set(part.slice(0, i), part.slice(i + 1));
  }
  const wanted = params.has("region") ? params.get("region") : DEFAULT_REGION;
  const row = regions.find((r) => r.id === wanted && r.status === "ok");
  if (!row) return { regionId: DEFAULT_REGION, aoi: null };
  const aoi = params.has("aoi") ? parseAoiHash(`#aoi=${params.get("aoi")}`, row.nx, row.ny) : null;
  return { regionId: row.id, aoi };
}

// With an area the region is always named; without one the default region has an empty hash.
export function formatHash(regionId, aoi) {
  const area = aoi ? formatAoiHash(aoi).slice(1) : null;
  if (regionId === DEFAULT_REGION && !area) return "";
  return `#region=${regionId}${area ? `&${area}` : ""}`;
}

// Wraps `load(region)` so only the latest call answers: an earlier call that settles after a later
// one was made resolves to null, whether it succeeded or failed. A failure of the latest call is
// rethrown. `cancel()` makes every pending call resolve to null.
export function createRegionLoader(load) {
  let latest = 0;
  const loadRegion = async (region) => {
    const call = ++latest;
    try {
      const data = await load(region);
      return call === latest ? { region, data } : null;
    } catch (err) {
      if (call !== latest) return null;
      throw err;
    }
  };
  loadRegion.cancel = () => {
    latest += 1;
  };
  return loadRegion;
}

export function regionView(bbox) {
  const [w, s, e, n] = bbox;
  const zoom = Math.min(6, Math.max(1.5, Math.log2(360 / Math.max(e - w, n - s)) - 1.1));
  return { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom };
}

export const regionTitle = (name) => `${name} - FireSeam, MODIS and VIIRS harmonized`;
export const regionHeading = (name) => `FireSeam · ${name}`;
