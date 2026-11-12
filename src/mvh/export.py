"""Pipeline entry point: raw FIRMS CSVs -> the static files the web demo reads."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from mvh import config, events, pairing
from mvh.grid import weekly_cube, weekly_totals
from mvh.harmonizer import harmonize
from mvh.ingest import load_firms
from mvh.schema import validate_export

_DEFAULT_OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
_STAGE_START = time.perf_counter()


def _stage(label: str) -> None:
    global _STAGE_START
    now = time.perf_counter()
    print(f"{label}: {now - _STAGE_START:.1f}s", flush=True)
    _STAGE_START = now


def _calendar(totals: pd.DataFrame, weekly: pd.DataFrame, method: str) -> dict:
    n_modis = (totals["n_terra"] + totals["n_aqua"]).to_numpy()
    cov_modis = (totals["cov_terra"] | totals["cov_aqua"]).to_numpy()
    n_viirs = totals["n_viirs"].to_numpy()
    cov_viirs = totals["cov_snpp"].to_numpy()
    pred = weekly["pred"].to_numpy()
    weeks = []
    for i, (year, week) in enumerate(zip(totals["year"], totals["week"], strict=True)):
        year, week = int(year), int(week)
        modis = int(n_modis[i]) if cov_modis[i] else None
        viirs = int(n_viirs[i]) if cov_viirs[i] else None
        p = None if np.isnan(pred[i]) else round(float(pred[i]), 1)
        weeks.append(
            {
                "year": year,
                "week": week,
                "modis": modis,
                "viirs": viirs,
                "pred": p,
                "harmonized": viirs if viirs is not None else p,
                "status": "observed"
                if viirs is not None
                else "estimated"
                if p is not None
                else "gap",
                "nrt": (viirs is not None and config.is_nrt("viirs", year, week))
                or (modis is not None and config.is_nrt("modis", year, week)),
            }
        )
    meta = {
        "bbox": list(config.BBOX),
        "cell_deg": config.CELL_DEG,
        "method": method,
        "coverage": config.coverage_meta(),
    }
    return {"meta": meta, "weeks": weeks}


def _points(modis, viirs, modis_ghost, viirs_ghost) -> dict[int, dict]:
    """Encode every year's detections as the columnar blocks the web reads."""
    both = pd.concat([modis, viirs], ignore_index=True)
    flags = (
        (both["sensor"] == "viirs").to_numpy().astype(np.uint8)
        | np.concatenate([modis_ghost, viirs_ghost]).astype(np.uint8) << 1
        | both["night"].to_numpy().astype(np.uint8) << 2
        | (both["sat"] == "Terra").to_numpy().astype(np.uint8) << 3
    )
    lon = np.clip(np.round((both["lon"].to_numpy() + 58.5) * 1000), 0, 65535).astype("<u2")
    lat = np.clip(np.round((both["lat"].to_numpy() + 22.5) * 1000), 0, 65535).astype("<u2")
    frp = np.minimum(255, np.round(16 * np.log2(1 + both["frp"].to_numpy(np.float64)))).astype("u1")
    doy = both["doy"].to_numpy().astype("<u2")
    year = both["year"].to_numpy()
    out = {}
    for y in range(config.YEAR_START, config.YEAR_END + 1):
        sel = np.flatnonzero(year == y)
        if len(sel) == 0:
            continue
        sel = sel[np.argsort(doy[sel], kind="stable")]
        week = np.minimum((doy[sel].astype(np.int32) - 1) // 7 + 1, config.WEEKS_PER_YEAR)
        starts = np.searchsorted(week, np.arange(1, config.WEEKS_PER_YEAR + 1))
        blob = b"".join(a[sel].tobytes() for a in (lon, lat, doy, flags.astype("u1"), frp))
        out[y] = {"n": len(sel), "week_start": [int(s) for s in starts], "blob": blob}
    return out


def _write_json(path: Path, obj) -> None:
    text = json.dumps(obj, separators=(",", ":")) + "\n"
    path.write_bytes(text.encode("utf-8"))


def _clean(out: Path) -> None:
    for name in ("calendar.json", "metrics.json"):
        (out / name).unlink(missing_ok=True)
    points = out / "points"
    if points.is_dir():
        for p in [*points.glob("*.bin"), points / "index.json"]:
            p.unlink(missing_ok=True)


def export_all(raw_root: Path | None, out: Path) -> None:
    global _STAGE_START
    _STAGE_START = time.perf_counter()
    out = Path(out)
    modis = load_firms("modis", raw_root)
    viirs = load_firms("viirs", raw_root)
    _stage("load")
    cube = weekly_cube(modis, viirs)
    totals = weekly_totals(cube)
    _stage("cube")
    weekly, metrics = harmonize(cube)
    _stage("harmonize")
    modis_ghost, viirs_ghost = pairing.find_ghosts(modis, viirs)
    pair_rows = pairing.pairing_stats(modis, viirs, modis_ghost, viirs_ghost)
    _stage("pairing")
    points = _points(modis, viirs, modis_ghost, viirs_ghost)
    evts = events.events_per_year(modis, viirs)
    _stage("points+events")

    # a year without any MODIS detection has no raw ratio; JSON cannot hold NaN
    by_year = [
        {**r, "ratio_raw": r["ratio_raw"] if np.isfinite(r["ratio_raw"]) else 0.0}
        for r in metrics["by_year"]
    ]
    metrics = {
        **metrics,
        "by_year": by_year,
        "events": evts,
        "pairing": {
            "radius_km": pairing.RADIUS_KM,
            "window_min": pairing.WINDOW_MIN,
            "headline_years": list(pairing.HEADLINE_YEARS),
            "by_year": [{**r, "dt_p50_min": int(round(r["dt_p50_min"]))} for r in pair_rows],
        },
        "filters": {
            "dropped_type": {
                "modis": int(modis.attrs.get("dropped_type", 0)),
                "viirs": int(viirs.attrs.get("dropped_type", 0)),
            }
        },
    }
    calendar = _calendar(totals, weekly, metrics["method"])

    out.mkdir(parents=True, exist_ok=True)
    _clean(out)
    (out / "points").mkdir(exist_ok=True)
    _write_json(out / "calendar.json", calendar)
    _write_json(out / "metrics.json", metrics)
    index = {}
    for y, p in points.items():
        (out / "points" / f"{y}.bin").write_bytes(p["blob"])
        index[str(y)] = {"n": p["n"], "week_start": p["week_start"]}
    _write_json(out / "points" / "index.json", index)
    validate_export(out)
    _stage("write+validate")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m mvh.export")
    parser.add_argument("--raw", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=_DEFAULT_OUT)
    args = parser.parse_args()
    started = time.perf_counter()
    export_all(args.raw, args.out)
    print(f"total: {time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main()
