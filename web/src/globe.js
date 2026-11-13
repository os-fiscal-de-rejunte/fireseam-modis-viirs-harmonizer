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
} from "deck.gl";
import { forecastMonth } from "./data.js";

export const COLORS = {
  modis: [76, 195, 255],
  viirs: [255, 150, 50],
  ghost: [255, 79, 216],
};

const BBOX = [-58.5, -22.5, -54.0, -15.5];
const PANTANAL = { longitude: -56.2, latitude: -19.4, zoom: 4.6 };
const EARTH = { longitude: 20, latitude: 18, zoom: 1.7 };
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

const BOX_PATH = densify([
  [BBOX[0], BBOX[1]],
  [BBOX[2], BBOX[1]],
  [BBOX[2], BBOX[3]],
  [BBOX[0], BBOX[3]],
  [BBOX[0], BBOX[1]],
]);

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
// the others.
function buildColors(points, show, category) {
  const { n, flags } = points;
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
    colors[4 * i + 3] = 255;
  }
  return colors;
}

// Shrink and fade points as the visible slice grows, so ~45k points do not fill the screen.
export function densityScale(count) {
  return Math.min(1, Math.max(0.3, Math.sqrt(4000 / Math.max(1, count))));
}

export function createGlobe(container, { onHover, onClick, onAreaDrag, onAreaSelect } = {}) {
  const state = {
    mode: "past",
    view: { ...PANTANAL, pitch: 0, bearing: 0 },
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
  };
  let drag = null;
  const cache = { points: null, attrs: null, colors: null, colorKey: "" };

  const deck = new Deck({
    parent: container,
    views: new GlobeView({ id: "globe" }),
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
      if (!state.selecting || state.mode !== "past") return;
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
      if (!d || !d.a || !dragPoint(info)) return;
      if (onAreaSelect) onAreaSelect(d.a, d.b);
    },
    onHover: (info) => onHover && onHover(info),
    onClick: (info) => onClick && onClick(info),
    layers: [],
  });

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

  function pastLayers() {
    const layers = [
      new PathLayer({
        id: "bbox",
        data: [BOX_PATH],
        getPath: (d) => d,
        getColor: [255, 236, 200, 150],
        widthMinPixels: 1.25,
        parameters: FLAT,
      }),
    ];
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
        getLineColor: (c) => (c.id === selected ? [255, 255, 255, 255] : [255, 255, 255, 70]),
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

  function render() {
    deck.setProps({
      layers: [...baseLayers(), ...(state.mode === "past" ? pastLayers() : outlookLayers())],
    });
  }

  function spinLoop(now) {
    if (state.mode !== "outlook" || !state.spin) return;
    if (now > state.spinFrom) {
      state.view = {
        ...state.view,
        longitude: state.view.longitude + 0.07,
        transitionDuration: 0,
      };
      deck.setProps({ viewState: state.view });
    }
    requestAnimationFrame(spinLoop);
  }

  function fly(target, ms) {
    state.view = {
      ...state.view,
      ...target,
      pitch: 0,
      bearing: 0,
      transitionDuration: ms,
      transitionInterpolator: new LinearInterpolator(["longitude", "latitude", "zoom"]),
    };
    deck.setProps({ viewState: state.view });
  }

  const api = {
    setMode(mode) {
      if (mode === state.mode) return;
      state.mode = mode;
      if (mode === "outlook") {
        api.setSelecting(false);
        fly(EARTH, 1800);
        state.spin = true;
        state.spinFrom = performance.now() + 2000;
        requestAnimationFrame(spinLoop);
      } else {
        state.spin = false;
        fly(PANTANAL, 1800);
      }
      render();
    },
    setAoi(bounds) {
      state.aoi = bounds;
      render();
    },
    setSelecting(on) {
      state.selecting = on;
      if (!on) drag = null;
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
      if (points) {
        const key = `${show.modis}${show.viirs}${show.ghostOnly}`;
        if (key !== cache.colorKey) {
          cache.colors = Object.fromEntries(
            CATEGORIES.map((c) => [c, buildColors(points, show, c)]),
          );
          cache.colorKey = key;
        }
      }
      state.points = points;
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

// [lon, lat] of a drag event, or null when the pointer is off the globe.
function dragPoint(info) {
  const c = info.coordinate || (info.viewport && info.viewport.unproject([info.x, info.y]));
  return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [c[0], c[1]] : null;
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
