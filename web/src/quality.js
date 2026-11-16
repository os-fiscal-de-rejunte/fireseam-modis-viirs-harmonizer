import { WEEKS } from "./data.js";
import { asOfWeek, blindSpotCounts, weekCodes } from "./blindspots.js";

const LABEL_W = 34;
const AXIS_H = 14;
const FIRST_STRIP_YEAR = 2012;
const PLAIN = "#3a4152";
const AMBER = "#d9a441";
const GREY = "#8b8f9a";

export function createQuality(canvas) {
  const ctx = canvas.getContext("2d");
  let calendar = null;
  let analysis = null;
  let geom = { w: 1, h: 1 };

  function hatch(x, y, w, h, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -h; k < w; k += 3) {
      ctx.moveTo(x + k, y + h);
      ctx.lineTo(x + k + h, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function dots(x, y, w, h) {
    ctx.fillStyle = "#9fb4ff";
    for (let dy = 1.5; dy < h; dy += 3)
      for (let dx = 1.5; dx < w; dx += 3) ctx.fillRect(x + dx, y + dy, 1, 1);
  }

  function paint(code, x, y, w, h) {
    if (code === "gap") {
      ctx.fillStyle = "#262a33";
      ctx.fillRect(x, y, w, h);
      hatch(x, y, w, h, GREY);
    } else if (code === "estimated") {
      ctx.fillStyle = "#4a3a1c";
      ctx.fillRect(x, y, w, h);
      hatch(x, y, w, h, AMBER);
    } else if (code === "no_factor") {
      ctx.fillStyle = AMBER;
      ctx.fillRect(x, y, w, h);
    } else if (code === "nrt") {
      ctx.fillStyle = PLAIN;
      ctx.fillRect(x, y, w, h);
      dots(x, y, w, h);
    } else if (code === "no_percentile") {
      ctx.fillStyle = PLAIN;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    } else {
      ctx.fillStyle = PLAIN;
      ctx.fillRect(x, y, w, h);
    }
  }

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geom = { w: rect.width, h: rect.height };
  }

  function draw() {
    const { w, h } = geom;
    ctx.clearRect(0, 0, w, h);
    if (!calendar) return;
    const asOf = asOfWeek(calendar);
    const isArea = calendar.meta?.aoi != null;
    const sufficient = !!analysis?.sufficient;
    const years = [...new Set(calendar.weeks.map((x) => x.year))].sort((a, b) => a - b);
    const strips = years.filter((y) => y >= FIRST_STRIP_YEAR);
    const early = years.filter((y) => y < FIRST_STRIP_YEAR);
    const rows = strips.length + (early.length ? 1 : 0);
    const ch = (h - AXIS_H) / Math.max(1, rows);
    const cw = (w - LABEL_W) / WEEKS;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let r = 0;
    if (early.length) {
      const gaps = early.reduce((s, y) => s + blindSpotCounts(calendar, analysis, { year: y }).gap, 0);
      ctx.fillStyle = "#c9ccd6";
      ctx.fillText(
        `${early[0]}-${early[early.length - 1]}: every week is a model estimate (before S-NPP), ${gaps} gap weeks`,
        0,
        AXIS_H + ch / 2,
      );
      r = 1;
    }
    const byKey = new Map(calendar.weeks.map((x) => [`${x.year}:${x.week}`, x]));
    for (const year of strips) {
      const y = AXIS_H + r * ch;
      ctx.fillStyle = "#8b8f9a";
      ctx.fillText(String(year), 0, y + ch / 2);
      for (let week = 1; week <= WEEKS; week++) {
        const cell = byKey.get(`${year}:${week}`);
        if (!cell || !asOf || year > asOf.year || (year === asOf.year && week > asOf.week)) continue;
        const codes = weekCodes(cell, analysis?.stats?.get(`${year}:${week}`), { isArea, sufficient });
        paint(codes[0], LABEL_W + (week - 1) * cw, y, Math.ceil(cw) - 1, Math.max(1, ch - 1));
      }
      r++;
    }
  }

  new ResizeObserver(() => {
    layout();
    draw();
  }).observe(canvas);
  layout();

  return {
    setData(cal, an) {
      calendar = cal;
      analysis = an;
      layout();
      draw();
    },
  };
}
