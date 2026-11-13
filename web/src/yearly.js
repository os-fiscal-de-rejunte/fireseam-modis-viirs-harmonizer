import { FIRST_YEAR } from "./data.js";

const COLORS = {
  raw: "#c0705a",
  modis: "#4cc3ff",
  harmonized: "#fff3da",
};
const LABELS = {
  raw: "Raw detections (MODIS + VIIRS)",
  modis: "MODIS raw",
  harmonized: "Harmonized (VIIRS-equivalent)",
};
const ORDER = ["raw", "modis", "harmonized"];
const LEFT = 46;
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 16;
const VIIRS_START = 2012;

export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(v);
  return out;
}

const compact = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v));

export function createYearly(canvas, totals, { onSelect }) {
  const ctx = canvas.getContext("2d");
  let years;
  let ticks;
  let top;
  function load(next) {
    totals = next;
    years = totals.map((t) => t.year);
    ticks = niceTicks(
      Math.max(0, ...totals.flatMap((t) => ORDER.map((s) => t[s] ?? 0))),
    );
    top = ticks[ticks.length - 1] || 1;
  }
  load(totals);
  let selected = null;
  let geom = { w: 1, h: 1 };

  const x = (year) => {
    const i = year - FIRST_YEAR;
    return LEFT + ((i + 0.5) / years.length) * (geom.w - LEFT - RIGHT);
  };
  const y = (v) => TOP + (1 - v / top) * (geom.h - TOP - BOTTOM);

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geom = { w: rect.width, h: rect.height };
  }

  function area(key) {
    const pts = totals.filter((t) => t[key] != null);
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(x(pts[0].year), y(0));
    for (const t of pts) ctx.lineTo(x(t.year), y(t[key]));
    ctx.lineTo(x(pts[pts.length - 1].year), y(0));
    ctx.closePath();
    ctx.fillStyle = "rgba(192,112,90,0.28)";
    ctx.fill();
  }

  function series(key, width) {
    const color = COLORS[key];
    const pts = totals.filter((t) => t[key] != null);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((t, i) => (i ? ctx.lineTo(x(t.year), y(t[key])) : ctx.moveTo(x(t.year), y(t[key]))));
    ctx.stroke();
    for (const t of pts) {
      const partial = t.partial[key];
      ctx.beginPath();
      ctx.arc(x(t.year), y(t[key]), t.year === selected ? 4.2 : 3, 0, Math.PI * 2);
      if (partial) {
        ctx.fillStyle = "#0b0d13";
        ctx.fill();
        ctx.globalAlpha = 0.75;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }

  function draw() {
    const { w, h } = geom;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const v of ticks) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(LEFT, y(v));
      ctx.lineTo(w - RIGHT, y(v));
      ctx.stroke();
      ctx.fillStyle = "#8b8f9a";
      ctx.fillText(compact(v), LEFT - 6, y(v));
    }
    if (selected != null) {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      const cw = (w - LEFT - RIGHT) / years.length;
      ctx.fillRect(x(selected) - cw / 2, TOP, cw, h - TOP - BOTTOM);
    }
    if (years.includes(VIIRS_START)) {
      const vx = x(VIIRS_START);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(255,150,50,0.6)";
      ctx.beginPath();
      ctx.moveTo(vx, TOP);
      ctx.lineTo(vx, h - BOTTOM);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#ffb878";
      ctx.textAlign = "right";
      ctx.fillText("VIIRS starts", vx - 6, h - BOTTOM - 8);
      const step = totals.find((t) => t.year === VIIRS_START);
      if (step && step.raw != null) {
        ctx.fillStyle = "#e8a08c";
        ctx.textAlign = "left";
        ctx.fillText("artificial jump", vx + 8, Math.max(TOP + 24, y(step.raw) - 10));
      }
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#6c7080";
    for (const year of years) {
      if ((year - FIRST_YEAR) % 5 === 0 || year === years[years.length - 1]) {
        ctx.fillText(String(year), x(year), h - BOTTOM / 2);
      }
    }
    area("raw");
    series("raw", 1);
    series("modis", 1.6);
    series("harmonized", 2.4);
    // legend
    ctx.textAlign = "left";
    let lx = LEFT + 8;
    for (const key of ORDER) {
      ctx.fillStyle = COLORS[key];
      ctx.fillRect(lx, TOP + 2, 12, 3);
      ctx.fillStyle = "#b4b8c2";
      ctx.fillText(LABELS[key], lx + 17, TOP + 4);
      lx += 17 + ctx.measureText(LABELS[key]).width + 14;
    }
    ctx.strokeStyle = "#b4b8c2";
    ctx.beginPath();
    ctx.arc(lx + 3, TOP + 4, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#8b8f9a";
    ctx.fillText("partial year", lx + 11, TOP + 4);
  }

  canvas.addEventListener("click", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const i = Math.round(((px - LEFT) / (geom.w - LEFT - RIGHT)) * years.length - 0.5);
    if (i >= 0 && i < years.length) onSelect(years[i]);
  });

  const ro = new ResizeObserver(() => {
    layout();
    draw();
  });
  ro.observe(canvas);
  layout();
  draw();

  return {
    setTotals(next) {
      load(next);
      draw();
    },
    select(year) {
      selected = year;
      draw();
    },
  };
}
