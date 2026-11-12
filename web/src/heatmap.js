import { WEEKS } from "./data.js";

const FIRE = [
  [28, 14, 24],
  [110, 22, 38],
  [205, 62, 28],
  [255, 150, 44],
  [255, 238, 168],
];
const GAP = "#262a33";
const LABEL_W = 34;
const AXIS_H = 14;
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export function fireColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (FIRE.length - 1);
  const i = Math.min(FIRE.length - 2, Math.floor(x));
  const f = x - i;
  const c = FIRE[i].map((v, k) => Math.round(v + (FIRE[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function createHeatmap(canvas, calendar, { onSelect, onHover }) {
  const ctx = canvas.getContext("2d");
  const years = [];
  const grid = new Map();
  let max = 0;
  for (const w of calendar.weeks) {
    grid.set(`${w.year}:${w.week}`, w);
    if (w.harmonized != null && w.harmonized > max) max = w.harmonized;
    if (!years.includes(w.year)) years.push(w.year);
  }
  const nYears = years.length;
  let selected = { year: years[0], week: 1 };
  let hover = null;
  let geom = { cw: 1, ch: 1, w: 1, h: 1 };

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geom = {
      w: rect.width,
      h: rect.height,
      cw: (rect.width - LABEL_W) / WEEKS,
      ch: (rect.height - AXIS_H) / nYears,
    };
  }

  function hatch(x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = "rgba(8,10,16,0.62)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -h; k < w; k += 4) {
      ctx.moveTo(x + k, y + h);
      ctx.lineTo(x + k + h, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const { cw, ch, w, h } = geom;
    ctx.clearRect(0, 0, w, h);
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const root = Math.sqrt(max || 1);
    years.forEach((year, r) => {
      const y = AXIS_H + r * ch;
      if (year % 5 === 1 || r === nYears - 1) {
        ctx.fillStyle = "#8b8f9a";
        ctx.textAlign = "left";
        ctx.fillText(String(year), 0, y + ch / 2);
      }
      for (let week = 1; week <= WEEKS; week++) {
        const cell = grid.get(`${year}:${week}`);
        const x = LABEL_W + (week - 1) * cw;
        const gap = !cell || cell.status === "gap" || cell.harmonized == null;
        ctx.fillStyle = gap ? GAP : fireColor(Math.sqrt(cell.harmonized) / root);
        ctx.fillRect(x, y, Math.ceil(cw) - 1, Math.max(1, ch - 1));
        if (!gap && cell.status === "estimated") hatch(x, y, cw - 1, ch - 1);
      }
    });
    // month ticks, approximated on the 52-week grid
    ctx.fillStyle = "#6c7080";
    ctx.textAlign = "left";
    MONTHS.forEach((m, i) => {
      ctx.fillText(m, LABEL_W + ((i * 52) / 12) * cw + 1, AXIS_H / 2);
    });
    outline(hover, "rgba(255,255,255,0.45)", 1);
    outline(selected, "#ffffff", 1.75);
  }

  function outline(pos, color, width) {
    if (!pos) return;
    const r = years.indexOf(pos.year);
    if (r < 0) return;
    const { cw, ch } = geom;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(
      LABEL_W + (pos.week - 1) * cw - 0.5,
      AXIS_H + r * ch - 0.5,
      cw + 0.5,
      ch + 0.5,
    );
  }

  function hit(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left - LABEL_W;
    const y = ev.clientY - rect.top - AXIS_H;
    if (x < 0 || y < 0) return null;
    const week = Math.floor(x / geom.cw) + 1;
    const r = Math.floor(y / geom.ch);
    if (week < 1 || week > WEEKS || r < 0 || r >= nYears) return null;
    return { year: years[r], week };
  }

  canvas.addEventListener("pointermove", (ev) => {
    const pos = hit(ev);
    if (JSON.stringify(pos) !== JSON.stringify(hover)) {
      hover = pos;
      draw();
    }
    onHover(pos, ev, pos && grid.get(`${pos.year}:${pos.week}`));
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    draw();
    onHover(null);
  });
  canvas.addEventListener("click", (ev) => {
    const pos = hit(ev);
    if (pos) onSelect(pos.year, pos.week);
  });

  const ro = new ResizeObserver(() => {
    layout();
    draw();
  });
  ro.observe(canvas);
  layout();
  draw();

  return {
    max,
    select(year, week) {
      selected = { year, week };
      draw();
    },
    cell: (year, week) => grid.get(`${year}:${week}`),
  };
}
