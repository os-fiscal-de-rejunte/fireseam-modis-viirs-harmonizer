import {
  Deck,
  _GlobeView as GlobeView,
  LinearInterpolator,
  ScatterplotLayer,
  PathLayer,
  PolygonLayer,
  SolidPolygonLayer,
  BitmapLayer,
  TileLayer,
  TextLayer,
} from "deck.gl";
import { forecastMonth } from "./data.js";
import { fireColor } from "./heatmap.js";
import { overviewZoom, ZERO } from "./framing.js";

export const COLORS = {
  modis: [76, 195, 255],
  viirs: [255, 150, 50],
  ghost: [255, 79, 216],
};

const EARTH = { longitude: 20, latitude: 18, zoom: 1.7 };
// Planet scale of the region overview, and the per-frame turns (degrees of camera longitude).
// The overview turns eastward like the Earth itself; the outlook keeps its own turn.
const OVERVIEW_ZOOM = 0.9;
const OVERVIEW_TURN = -0.05;
const OUTLOOK_TURN = 0.07;
// Alpha of the outline of a released forecast cell that is not selected.
const RELEASED_LINE_ALPHA = 70;
// Flight that brings a region's box toward the centre when its row is hovered or focused.
const FOLLOW_MS = 700;
const GIBS =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";

// Sequential scale for the forecast: deep indigo -> teal -> pale mint. Deliberately not a fire hue.
const FORECAST_STOPS = [
  [38, 28, 110],
  [34, 110, 190],
  [40, 180, 175],
  [150, 235, 190],
  [235, 255, 225],
];

function lerpStops(stops, t) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
}

export function forecastColor(p, pMax) {
  return lerpStops(FORECAST_STOPS, Math.sqrt(p / pMax));
}

export const FORECAST_GRADIENT = FORECAST_STOPS.map((c) => `rgb(${c.join(",")})`);

function densify(ring, step = 0.25) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function boxPath(b) {
  return densify([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]);
}

const GRATICULE = (() => {
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) {
    lines.push(densify([[lon, -80], [lon, 80]], 5));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    lines.push(densify([[-180, lat], [180, lat]], 5));
  }
  return lines;
})();

const SPHERE = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]];

// Plain alpha blending: overlapping points keep the colour of the layer drawn last instead of
// summing to white, so a megafire week stays readable.
const OVER = {
  depthCompare: "always",
  depthWriteEnabled: false,
  blend: true,
  blendColorOperation: "add",
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one-minus-src-alpha",
  blendAlphaOperation: "add",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one-minus-src-alpha",
};
const FLAT = { depthCompare: "always", depthWriteEnabled: false };

// Per-year typed arrays that deck.gl can consume without any per-point JS work.
function buildAttributes(points) {
  const { n, lon, lat, frp } = points;
  const positions = new Float32Array(2 * n);
  const radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions[2 * i] = lon[i];
    positions[2 * i + 1] = lat[i];
    radius[i] = 650 + (frp[i] / 255) * 2600;
  }
  return { positions, radius };
}

// Layer categories, bottom to top. MODIS has a ~1 km pixel and is drawn as a large soft disc;
// VIIRS (375 m) as a small dot on it. Ghosts keep the size of the sensor that saw them.
const CATEGORIES = ["modis", "ghostModis", "viirs", "ghostViirs"];
const CATEGORY_COLOR = { modis: "modis", viirs: "viirs", ghostModis: "ghost", ghostViirs: "ghost" };

// One colour array per layer: a point is opaque in the layer of its category and transparent in
// the others. Outside `bounds` ([lonMin, latMin, lonMax, latMax], edges inside) alpha drops to 25%.
export function buildColors(points, show, category, bounds = null) {
  const { n, flags, lon, lat } = points;
  const dim = Math.round(255 * 0.25);
  const color = COLORS[CATEGORY_COLOR[category]];
  const colors = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) {
    const f = flags[i];
    const viirs = f & 1;
    const ghost = (f & 2) !== 0;
    const own = ghost ? (viirs ? "ghostViirs" : "ghostModis") : viirs ? "viirs" : "modis";
    const visible = show.ghostOnly ? ghost : viirs ? show.viirs : show.modis;
    if (own !== category || !visible) continue;
    colors[4 * i] = color[0];
    colors[4 * i + 1] = color[1];
    colors[4 * i + 2] = color[2];
    const outside =
      bounds !== null &&
      (lon[i] < bounds[0] || lon[i] > bounds[2] || lat[i] < bounds[1] || lat[i] > bounds[3]);
    colors[4 * i + 3] = outside ? dim : 255;
  }
  return colors;
}

// Shrink and fade points as the visible slice grows, so tens of thousands of points do not fill
// the screen.
export function densityScale(count) {
  return Math.min(1, Math.max(0.3, Math.sqrt(4000 / Math.max(1, count))));
}

// Where the cell glows start on the fire ramp: the ramp's dark low end would darken the map.
export const CELL_RAMP_FROM = 0.2;

// The glow of one cell, from s = square root of value / max: t, its place on the fire ramp
// (CELL_RAMP_FROM to 1), the radius as a share of the cell's half-diagonal (0.75 for the
// faintest, 1.3 at the maximum, so neighbours overlap into a field) and the alpha, rising with
// the value so sparse cells stay faint.
export function cellGlow(value, max) {
  const s = max > 0 ? Math.sqrt(Math.min(1, Math.max(0, value / max))) : 0;
  return {
    t: CELL_RAMP_FROM + (1 - CELL_RAMP_FROM) * s,
    scale: 0.75 + 0.55 * s,
    alpha: Math.round(40 + 200 * s),
  };
}

// Half the diagonal, in metres, of a cell polygon [[x0, y0], [x1, y0], [x1, y1], ...].
export function halfDiagonalMeters(polygon) {
  const [x0, y0] = polygon[0];
  const [x1, y1] = polygon[2];
  const lat = ((y0 + y1) / 2) * (Math.PI / 180);
  return 0.5 * Math.hypot((x1 - x0) * 111320 * Math.cos(lat), (y1 - y0) * 110574);
}

// Binary attributes of the cell glows: centre, radius and colour (alpha dims outside `bounds`).
function buildCellAttributes(cells, max, bounds) {
  const n = cells.length;
  const positions = new Float32Array(2 * n);
  const radius = new Float32Array(n);
  const colors = new Uint8Array(4 * n);
  cells.forEach((d, i) => {
    const ring = d.polygon;
    const x = (ring[0][0] + ring[2][0]) / 2;
    const y = (ring[0][1] + ring[2][1]) / 2;
    const g = cellGlow(d.value, max);
    positions[2 * i] = x;
    positions[2 * i + 1] = y;
    radius[i] = halfDiagonalMeters(ring) * g.scale;
    const [r, gr, b] = fireColor(g.t).match(/\d+/g).map(Number);
    const outside = bounds !== null && (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]);
    colors[4 * i] = r;
    colors[4 * i + 1] = gr;
    colors[4 * i + 2] = b;
    colors[4 * i + 3] = outside ? Math.round(g.alpha * 0.25) : g.alpha;
  });
  return { length: n, positions, radius, colors };
}

// Three stacked discs per cell, wide and faint to small and bright, stand in for a soft falloff.
const GLOW_RINGS = [
  { id: "cells", scale: 1, opacity: 0.32 },
  { id: "cells-mid", scale: 0.62, opacity: 0.4 },
  { id: "cells-core", scale: 0.32, opacity: 0.55 },
];

// Largest `value` of the cells (0 for none). A loop, not a spread: a region can have many cells.
export function maxCellValue(cells) {
  let max = 0;
  for (const d of cells) if (d.value > max) max = d.value;
  return max;
}

// ---- overview geometry (pure) ----
// At the overview's zoom the visible side of the globe reaches about 72-75 degrees from the
// centre of the view (camera altitude 1.5 screen heights); 70 keeps a margin from the limb.
export const FACING_DEG = 70;
// A row whose box is farther than this from the centre turns the globe toward it, until the box
// sits KEEP_DEG from the centre.
const NEAR_LIMB_DEG = 55;
const KEEP_DEG = 30;
// The resting centre is searched between these latitudes (north and south).
const CENTRE_LAT_LIMIT = 40;
const RAD = Math.PI / 180;

const toVec = ([lon, lat]) => [
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
  Math.cos(lat * RAD) * Math.sin(lon * RAD),
  Math.sin(lat * RAD),
];
const toLonLat = ([x, y, z]) => [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z))) / RAD];
const boxCentre = (bbox) => [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

// Angle in degrees between two [lon, lat] points, along the sphere.
export function greatCircleDeg(a, b) {
  const u = toVec(a);
  const v = toVec(b);
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / RAD;
}

// Whether `point` lies on the side of the globe that faces a camera looking at `centre`.
export function facesCentre(centre, point, capDeg = FACING_DEG) {
  return greatCircleDeg(centre, point) <= capDeg;
}

// The view centre (1-degree grid) where the most box centres face the camera; among equals, the
// one whose farthest facing box is nearest the centre.
export function bestOverviewCenter(rows, capDeg = FACING_DEG) {
  const centres = rows.map((r) => boxCentre(r.bbox));
  let best = { longitude: EARTH.longitude, latitude: 0, count: -1, far: Infinity };
  for (let lat = -CENTRE_LAT_LIMIT; lat <= CENTRE_LAT_LIMIT; lat++) {
    for (let lon = -180; lon < 180; lon++) {
      let count = 0;
      let far = 0;
      for (const c of centres) {
        const d = greatCircleDeg([lon, lat], c);
        if (d > capDeg) continue;
        count += 1;
        if (d > far) far = d;
      }
      if (count > best.count || (count === best.count && far < best.far)) {
        best = { longitude: lon, latitude: lat, count, far };
      }
    }
  }
  return { longitude: best.longitude, latitude: best.latitude };
}

// Camera of the overview: planet scale, at the centre where the most boxes face the camera.
// With `fit` ({width, height, radius}) the zoom gives the planet that radius on screen.
export function overviewView(rows, fit = null) {
  const centre = bestOverviewCenter(rows);
  const zoom = fit ? overviewZoom({ ...fit, latitude: centre.latitude }) : OVERVIEW_ZOOM;
  return { ...centre, zoom };
}

// The view centre moved along the great circle toward `point` until the point is `keepDeg` from
// it; unchanged when the point is already that close.
export function turnToward(centre, point, keepDeg = KEEP_DEG) {
  const from = [centre.longitude, centre.latitude];
  const d = greatCircleDeg(from, point);
  if (d <= keepDeg) return { longitude: centre.longitude, latitude: centre.latitude };
  if (d > 179.9) return { longitude: point[0] - keepDeg, latitude: point[1] };
  const t = (d - keepDeg) / d;
  const a = toVec(from);
  const b = toVec(point);
  const s = Math.sin(d * RAD);
  const wa = Math.sin((1 - t) * d * RAD) / s;
  const wb = Math.sin(t * d * RAD) / s;
  const [longitude, latitude] = toLonLat([0, 1, 2].map((k) => wa * a[k] + wb * b[k]));
  return { longitude, latitude };
}

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function createGlobe(container, { onHover, onClick, onAreaDrag, onAreaSelect, onAreaCancel } = {}) {
  const state = {
    mode: "past",
    view: { ...EARTH, zoom: OVERVIEW_ZOOM, pitch: 0, bearing: 0 },
    // {bbox, boxPath, view} of the open region; null until one is set.
    region: null,
    // Overview rows [{id, name, bbox, selectable, ring}] while the planet cover shows, else null.
    overview: null,
    // Ids of the overview rows whose centre faces the camera; the far side is not drawn.
    facing: new Set(),
    hot: null,
    // Id of the cover row that drives the globe (hovered or focused); the turn pauses meanwhile.
    following: null,
    cells: null,
    cellMax: 0,
    points: null,
    range: [0, 0],
    show: { modis: true, viirs: true, ghostOnly: false },
    forecast: null,
    month: 1,
    pMax: 0.5,
    selectedId: null,
    spin: false,
    spinFrom: 0,
    aoi: null,
    selecting: false,
    // Screen offset of the camera's centre ({left, top, right, bottom} in pixels).
    padding: { ...ZERO },
    // Radius in pixels of the planet on the cover; null keeps the fixed overview zoom.
    planetRadius: null,
    cellAttrs: null,
  };
  let drag = null;
  let padFrame = 0;
  let spinFrame = 0;
  let overviewHandlers = {};
  let hoveredId = null;
  const cache = { points: null, attrs: null, colors: null, colorKey: "" };

  const overviewId = (info) => (info.layer?.id === "overview-pick" ? info.object?.id ?? null : null);

  function overviewHover(info) {
    const id = overviewId(info);
    if (id === hoveredId) return;
    hoveredId = id;
    if (overviewHandlers.onHover) overviewHandlers.onHover(id);
  }

  const deck = new Deck({
    parent: container,
    views: new GlobeView({ id: "globe", padding: ZERO }),
    viewState: state.view,
    controller: { inertia: true },
    onViewStateChange: ({ viewState }) => {
      state.view = viewState;
      deck.setProps({ viewState });
    },
    onInteractionStateChange: (s) => {
      if (s.isDragging || s.isZooming || s.isPanning) state.spin = false;
    },
    getCursor: ({ isHovering }) =>
      state.selecting ? "crosshair" : isHovering ? "pointer" : "grab",
    onDragStart: (info) => {
      if (!state.selecting || state.mode !== "past" || state.overview) return;
      const a = dragPoint(info);
      drag = { a, b: a };
    },
    onDrag: (info) => {
      if (!drag || !drag.a) return;
      const b = dragPoint(info);
      if (!b) return;
      drag.b = b;
      if (onAreaDrag) onAreaDrag(drag.a, b);
    },
    onDragEnd: (info) => {
      const d = drag;
      drag = null;
      if (!d || !d.a) return;
      if (!dragPoint(info)) {
        if (onAreaCancel) onAreaCancel();
        return;
      }
      if (onAreaSelect) onAreaSelect(d.a, d.b);
    },
    onHover: (info) => {
      if (state.overview) overviewHover(info);
      else if (onHover) onHover(info);
    },
    onClick: (info) => {
      if (!state.overview) {
        if (onClick) onClick(info);
        return;
      }
      const id = overviewId(info);
      if (id && overviewHandlers.onPick) overviewHandlers.onPick(id);
    },
    onAfterRender: () => {
      if (state.overview) updateFacing();
    },
    layers: [],
  });

  // The first pointer or key interaction stops the overview's turn.
  const stopOverviewTurn = () => {
    if (state.overview) state.spin = false;
  };
  container.addEventListener("pointerdown", stopOverviewTurn);
  container.addEventListener("wheel", stopOverviewTurn, { passive: true });
  window.addEventListener("keydown", stopOverviewTurn);

  // A row faces the camera when its centre, projected to the screen and back, lands on itself:
  // a point on the far side unprojects to the near-side point in front of it.
  function updateFacing() {
    let viewport;
    try {
      viewport = deck.getViewports()[0];
    } catch {
      return;
    }
    if (!viewport) return;
    const facing = new Set();
    for (const r of state.overview) {
      const c = [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2];
      const p = viewport.project(c);
      const back = viewport.unproject([p[0], p[1]]);
      if (Number.isFinite(back[0]) && Math.abs(wrap180(back[0] - c[0])) < 0.5 && Math.abs(back[1] - c[1]) < 0.5) {
        facing.add(r.id);
      }
    }
    const same = facing.size === state.facing.size && [...facing].every((id) => state.facing.has(id));
    if (same) return;
    state.facing = facing;
    render();
  }

  function baseLayers() {
    return [
      new SolidPolygonLayer({
        id: "sphere",
        data: SPHERE,
        getPolygon: (d) => d,
        getFillColor: [12, 18, 30],
        parameters: FLAT,
      }),
      new TileLayer({
        id: "blue-marble",
        data: GIBS,
        minZoom: 0,
        maxZoom: 8,
        tileSize: 256,
        extent: [-180, -85.05, 180, 85.05],
        refinementStrategy: "best-available",
        onTileError: () => {},
        renderSubLayers: (props) => {
          const { west, south, east, north } = props.tile.bbox;
          return new BitmapLayer(props, {
            data: null,
            image: props.data,
            bounds: [west, south, east, north],
            tintColor: [130, 135, 150],
            parameters: FLAT,
          });
        },
      }),
      new PathLayer({
        id: "graticule",
        data: GRATICULE,
        getPath: (d) => d,
        getColor: [255, 255, 255, 22],
        widthMinPixels: 1,
        parameters: FLAT,
      }),
    ];
  }

  // The region boxes of the planet cover: outline, faint fill and name. Only boxes facing the
  // camera are drawn; only selectable ones are pickable. A box that cannot be opened stays, dim.
  function overviewLayers() {
    const rows = state.overview.filter((r) => state.facing.has(r.id));
    const hot = state.hot;
    // A lit box that can be opened takes the fire accent; one that cannot only gets less dim.
    const pick = (r, lit, on, litOff, off) =>
      r.selectable ? (r.id === hot ? lit : on) : r.id === hot ? litOff : off;
    const fill = (r) => pick(r, [255, 179, 71, 64], [255, 236, 200, 28], [255, 255, 255, 20], [255, 255, 255, 8]);
    const line = (r) =>
      pick(r, [255, 217, 168, 255], [255, 236, 200, 170], [200, 205, 215, 150], [200, 205, 215, 64]);
    const text = (r) =>
      pick(r, [255, 217, 168, 255], [235, 232, 226, 235], [200, 203, 210, 235], [141, 145, 156, 190]);
    const triggers = [hot];
    return [
      new SolidPolygonLayer({
        id: "overview-dim",
        data: rows.filter((r) => !r.selectable),
        getPolygon: (r) => r.ring,
        getFillColor: fill,
        updateTriggers: { getFillColor: triggers },
        parameters: FLAT,
      }),
      new SolidPolygonLayer({
        id: "overview-pick",
        data: rows.filter((r) => r.selectable),
        getPolygon: (r) => r.ring,
        getFillColor: fill,
        pickable: true,
        updateTriggers: { getFillColor: triggers },
        parameters: FLAT,
      }),
      new PathLayer({
        id: "overview-outline",
        data: rows,
        getPath: (r) => r.ring,
        getColor: line,
        getWidth: (r) => (r.id === hot ? 2 : 1.25),
        widthUnits: "pixels",
        updateTriggers: { getColor: triggers, getWidth: triggers },
        parameters: FLAT,
      }),
      new TextLayer({
        id: "overview-names",
        data: rows,
        getPosition: (r) => [r.bbox[2], (r.bbox[1] + r.bbox[3]) / 2],
        getText: (r) => r.name,
        getColor: text,
        getSize: 12,
        sizeUnits: "pixels",
        getTextAnchor: "start",
        getAlignmentBaseline: "center",
        getPixelOffset: [8, 0],
        fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontWeight: 600,
        fontSettings: { sdf: true },
        outlineWidth: 2,
        outlineColor: [6, 7, 11, 220],
        updateTriggers: { getColor: triggers },
        parameters: FLAT,
      }),
    ];
  }

  function pastLayers() {
    const layers = [];
    if (state.region) {
      layers.push(
        new PathLayer({
          id: "bbox",
          data: [state.region.boxPath],
          getPath: (d) => d,
          getColor: [255, 236, 200, 150],
          widthMinPixels: 1.25,
          parameters: FLAT,
        }),
      );
    }
    if (state.cells && state.cellAttrs) {
      const a = state.cellAttrs;
      for (const ring of GLOW_RINGS) {
        layers.push(
          new ScatterplotLayer({
            id: ring.id,
            data: {
              length: a.length,
              attributes: {
                getPosition: { value: a.positions, size: 2 },
                getRadius: { value: a.radius, size: 1 },
                getFillColor: { value: a.colors, size: 4, normalized: true },
              },
            },
            radiusUnits: "meters",
            radiusScale: ring.scale,
            opacity: ring.opacity,
            stroked: false,
            pickable: false,
            parameters: OVER,
          }),
        );
      }
    }
    const pts = state.points;
    if (pts && cache.points === pts) {
      const [start, end] = state.range;
      const len = Math.max(0, end - start);
      const k = densityScale(len);
      for (const category of CATEGORIES) {
        const big = category === "modis" || category === "ghostModis";
        const soft = category === "modis";
        layers.push(
          new ScatterplotLayer({
            id: `fires-${category}`,
            data: {
              length: len,
              attributes: {
                getPosition: { value: cache.attrs.positions.subarray(2 * start, 2 * end), size: 2 },
                getRadius: { value: cache.attrs.radius.subarray(start, end), size: 1 },
                getFillColor: {
                  value: cache.colors[category].subarray(4 * start, 4 * end),
                  size: 4,
                  normalized: true,
                },
              },
            },
            radiusUnits: "meters",
            radiusScale: big ? k : 0.35 * k,
            radiusMinPixels: big ? 3 : 1.5,
            radiusMaxPixels: big ? Math.max(6, 9 * k) : Math.max(3, 4 * k),
            opacity: soft ? 0.3 + 0.15 * k : 0.7 + 0.2 * k,
            pickable: false,
            parameters: OVER,
          }),
        );
      }
    }
    if (state.aoi) {
      const [x0, y0, x1, y1] = state.aoi;
      layers.push(
        new PathLayer({
          id: "aoi",
          data: [densify([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]])],
          getPath: (d) => d,
          getColor: [255, 255, 255, 230],
          widthMinPixels: 2,
          parameters: FLAT,
        }),
      );
    }
    return layers;
  }

  function outlookLayers() {
    const fc = state.forecast;
    if (!fc) return [];
    const rows = forecastMonth(fc.cells, state.month);
    const released = new Map(rows.map((r) => [r.cell.id, r.p]));
    const faint = fc.cells.filter((c) => !c.released);
    const selected = state.selectedId;
    const color = (c) => forecastColor(released.get(c.id), state.pMax);
    return [
      new PolygonLayer({
        id: "cells-unreleased",
        data: faint,
        getPolygon: (c) => c.polygon,
        filled: false,
        stroked: true,
        getLineColor: [200, 210, 230, 55],
        lineWidthMinPixels: 0.6,
        parameters: FLAT,
      }),
      new PolygonLayer({
        id: "cells-released",
        data: rows.map((r) => r.cell),
        getPolygon: (c) => c.polygon,
        getFillColor: (c) => [...color(c), 215],
        getLineColor: (c) => (c.id === selected ? [255, 255, 255, 255] : [255, 255, 255, RELEASED_LINE_ALPHA]),
        lineWidthMinPixels: 0.8,
        stroked: true,
        pickable: true,
        updateTriggers: { getFillColor: [state.month, state.pMax], getLineColor: [selected] },
        parameters: FLAT,
      }),
      // Cells are far smaller than a pixel on a whole-Earth view, so each gets a marker.
      new ScatterplotLayer({
        id: "cells-marker",
        data: rows,
        getPosition: (r) => centroid(r.cell.polygon),
        getFillColor: (r) => [...forecastColor(r.p, state.pMax), 255],
        getLineColor: (r) =>
          r.cell.id === selected ? [255, 255, 255, 255] : [255, 255, 255, 90],
        stroked: true,
        lineWidthMinPixels: 1,
        radiusUnits: "pixels",
        getRadius: (r) => (r.cell.id === selected ? 6 : 3.4),
        pickable: true,
        updateTriggers: {
          getFillColor: [state.month, state.pMax],
          getLineColor: [selected],
          getRadius: [selected],
        },
        parameters: FLAT,
      }),
    ];
  }

  // The overview's size on this screen, or null for the fixed zoom.
  function planetFit() {
    if (!state.planetRadius) return null;
    const width = container.clientWidth;
    const height = container.clientHeight;
    return width && height ? { width, height, radius: state.planetRadius } : null;
  }

  function planetZoom(latitude) {
    const fit = planetFit();
    return fit ? overviewZoom({ ...fit, latitude }) : OVERVIEW_ZOOM;
  }

  function applyPadding(p) {
    state.padding = p;
    deck.setProps({ views: new GlobeView({ id: "globe", padding: p }) });
  }

  function render() {
    const top = state.overview ? overviewLayers() : state.mode === "past" ? pastLayers() : outlookLayers();
    deck.setProps({ layers: [...baseLayers(), ...top] });
  }

  // One turn loop at a time, for the overview or for the outlook.
  function spinLoop(now) {
    spinFrame = 0;
    if (!state.spin || !(state.overview || state.mode === "outlook")) return;
    const paused = state.overview && state.following;
    if (now > state.spinFrom && !paused) {
      state.view = {
        ...state.view,
        longitude: state.view.longitude + (state.overview ? OVERVIEW_TURN : OUTLOOK_TURN),
        transitionDuration: 0,
      };
      deck.setProps({ viewState: state.view });
    }
    spinFrame = requestAnimationFrame(spinLoop);
  }

  function startSpin(delay) {
    state.spin = true;
    state.spinFrom = performance.now() + delay;
    if (!spinFrame) spinFrame = requestAnimationFrame(spinLoop);
  }

  // Camera of the mode underneath the overview, used when the overview goes away.
  // Under reduced motion every flight is a cut and nothing turns by itself.
  function flyToMode() {
    const still = prefersReducedMotion();
    if (state.mode === "outlook") {
      fly(EARTH, still ? 0 : 1800);
      if (still) state.spin = false;
      else startSpin(2000);
    } else {
      state.spin = false;
      if (state.region) fly(state.region.view, still ? 0 : 1800);
    }
  }

  // The camera's longitude keeps growing while the globe turns, so a target is reached the short
  // way round.
  function fly(target, ms) {
    const longitude = state.view.longitude + wrap180(target.longitude - state.view.longitude);
    state.view = {
      ...state.view,
      ...target,
      longitude,
      pitch: 0,
      bearing: 0,
      transitionDuration: ms,
      transitionInterpolator: new LinearInterpolator(["longitude", "latitude", "zoom"]),
    };
    deck.setProps({ viewState: state.view });
  }

  function updateColors() {
    const { points, show, aoi } = state;
    if (!points || cache.points !== points) return;
    const key = `${show.modis}${show.viirs}${show.ghostOnly}${aoi ? aoi.join(",") : ""}`;
    if (key === cache.colorKey) return;
    cache.colors = Object.fromEntries(
      CATEGORIES.map((c) => [c, buildColors(points, show, c, aoi)]),
    );
    cache.colorKey = key;
  }

  const api = {
    setMode(mode) {
      if (mode === state.mode) return;
      state.mode = mode;
      if (mode === "outlook") api.setSelecting(false);
      // Under the overview the camera stays at planet scale; it moves when the overview goes.
      if (!state.overview) flyToMode();
      render();
    },
    // Outline and home camera of the current region; knows nothing about data. The camera moves
    // only while the past view is showing; otherwise the region's view is used when it shows.
    // With `stay` the home view is only stored: the camera keeps where the user put it.
    setRegion({ bbox, view }, { stay = false } = {}) {
      state.region = { bbox, boxPath: boxPath(bbox), view };
      if (!stay && state.mode === "past" && !state.overview) fly(view, 0);
      render();
    },
    // rows: [{id, name, bbox, selectable}] draws the planet cover's boxes at planet scale; null
    // removes them and returns the camera to the mode underneath. onPick(id) on a click and
    // onHover(id | null) on hover, for selectable boxes only.
    setOverview(rows, { onPick, onHover: onBoxHover } = {}) {
      const was = state.overview;
      overviewHandlers = { onPick, onHover: onBoxHover };
      state.overview = rows ? rows.map((r) => ({ ...r, ring: boxPath(r.bbox) })) : null;
      if (rows && !was) {
        state.hot = null;
        state.following = null;
        hoveredId = null;
        state.facing = new Set();
        const still = prefersReducedMotion();
        fly(overviewView(rows, planetFit()), still ? 0 : 1800);
        if (still) state.spin = false;
        else startSpin(1900);
      } else if (!rows && was) {
        state.hot = null;
        state.following = null;
        hoveredId = null;
        flyToMode();
      }
      render();
    },
    // Moves the camera's centre on the screen: padding {left, top, right, bottom} in pixels,
    // eased over `ms` (at once under reduced motion). Picking follows, since deck.gl projects
    // through the same padding.
    setPadding(target, ms = 0) {
      cancelAnimationFrame(padFrame);
      const from = { ...state.padding };
      const keys = ["left", "top", "right", "bottom"];
      const to = Object.fromEntries(keys.map((k) => [k, Math.round(target?.[k] ?? 0)]));
      if (keys.every((k) => from[k] === to[k])) return;
      if (!ms || prefersReducedMotion()) {
        applyPadding(to);
        return;
      }
      const t0 = performance.now();
      const step = (now) => {
        const u = Math.min(1, (now - t0) / ms);
        // exponential ease-out, the page's own curve
        const e = u === 1 ? 1 : 1 - Math.pow(2, -10 * u);
        applyPadding(Object.fromEntries(keys.map((k) => [k, from[k] + (to[k] - from[k]) * e])));
        if (u < 1) padFrame = requestAnimationFrame(step);
      };
      padFrame = requestAnimationFrame(step);
    },
    // Radius in pixels of the planet on the cover. While the cover shows, the zoom follows at
    // once (a window resize); the next overview flies to it.
    setPlanetRadius(px) {
      if (px === state.planetRadius) return;
      state.planetRadius = px || null;
      if (!state.overview) return;
      state.view = { ...state.view, zoom: planetZoom(state.view.latitude), transitionDuration: 0 };
      deck.setProps({ viewState: state.view });
    },
    // Brightens one overview box (null for none).
    highlight(id) {
      if (id === state.hot) return;
      state.hot = id;
      if (state.overview) render();
    },
    // A cover row drives the globe: while `id` is set the turn pauses, and a box that is behind
    // the planet or near its limb is brought toward the centre (a jump under reduced motion).
    // null lets the turn resume (unless an interaction already stopped it).
    follow(id) {
      if (id === state.following || !state.overview) return;
      state.following = id;
      if (!id) {
        state.spinFrom = Math.max(state.spinFrom, performance.now() + FOLLOW_MS + 100);
        return;
      }
      const row = state.overview.find((r) => r.id === id);
      if (!row) return;
      const centre = { longitude: state.view.longitude, latitude: state.view.latitude };
      const box = boxCentre(row.bbox);
      if (greatCircleDeg([centre.longitude, centre.latitude], box) <= NEAR_LIMB_DEG) return;
      const to = turnToward(centre, box);
      fly({ ...to, zoom: planetZoom(to.latitude) }, prefersReducedMotion() ? 0 : FOLLOW_MS);
    },
    // cells: [{cell, value, polygon}] or null, drawn as soft glows at the polygons' centres.
    setCells(cells) {
      state.cells = cells && cells.length ? cells : null;
      state.cellMax = state.cells ? maxCellValue(state.cells) : 0;
      state.cellAttrs = state.cells ? buildCellAttributes(state.cells, state.cellMax, state.aoi) : null;
      render();
    },
    setAoi(bounds) {
      // Called on every pointer move of a drag: recolour only when the bounds really change.
      const same =
        bounds === state.aoi ||
        (bounds && state.aoi && bounds.every((v, i) => v === state.aoi[i]));
      state.aoi = bounds;
      if (!same) {
        updateColors();
        if (state.cells) state.cellAttrs = buildCellAttributes(state.cells, state.cellMax, bounds);
      }
      render();
    },
    setSelecting(on) {
      state.selecting = on;
      if (!on) {
        const dropped = drag && drag.a;
        drag = null;
        if (dropped && onAreaCancel) onAreaCancel();
      }
      deck.setProps({ controller: on ? false : { inertia: true } });
    },
    setPoints(points, range, show) {
      state.range = range;
      state.show = show;
      if (points && cache.points !== points) {
        cache.points = points;
        cache.attrs = buildAttributes(points);
        cache.colorKey = "";
      }
      state.points = points;
      updateColors();
      render();
    },
    setForecast(forecast) {
      state.forecast = forecast;
      let max = 0;
      for (const c of forecast.cells) {
        if (!c.released) continue;
        for (const p of c.p) if (p !== null && p > max) max = p;
      }
      state.pMax = Math.max(max, 0.05);
      render();
    },
    setMonth(month) {
      state.month = month;
      render();
    },
    setSelectedCell(id) {
      state.selectedId = id;
      render();
    },
    get pMax() {
      return state.pMax;
    },
    destroy() {
      deck.finalize();
    },
  };
  render();
  return api;
}

// [lon, lat] of a drag event, or null when the pointer is off the globe. Off the globe,
// GlobeViewport.unproject returns a finite point on the limb, so a hit is told from a miss by
// projecting the point back: it lands under the cursor only when the ray really met the sphere.
function dragPoint(info) {
  const c = info.coordinate;
  const v = info.viewport;
  if (!c || !v || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const p = v.project([c[0], c[1]]);
  if (Math.hypot(p[0] - (info.x - v.x), p[1] - (info.y - v.y)) > 1) return null;
  return [c[0], c[1]];
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}
