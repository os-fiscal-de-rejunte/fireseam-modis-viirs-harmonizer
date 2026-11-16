"""Pipeline entry point: raw FIRMS CSVs -> the static files the web demo reads."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

if __name__ == "__main__":
    from mvh.regions import region_from_argv

    _region = region_from_argv(sys.argv[1:])
    if _region:
        os.environ["MVH_REGION"] = _region

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from mvh import config, events, pairing, regions_index  # noqa: E402
from mvh.grid import weekly_cube, weekly_totals  # noqa: E402
from mvh.harmonizer import harmonize  # noqa: E402
from mvh.ingest import load_firms  # noqa: E402
from mvh.schema import validate_export  # noqa: E402

_DEFAULT_OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
_STAGE_START = time.perf_counter()


def _stage(label: str) -> None:
    global _STAGE_START
    now = time.perf_counter()
    print(f"{label}: {now - _STAGE_START:.1f}s", flush=True)
    _STAGE_START = now


def _why(status: str, year: int, week: int) -> str | None:
    return config.why_code(status, year, week)


def _calendar(totals: pd.DataFrame, weekly: pd.DataFrame, method: str, uncertainty: dict) -> dict:
    n_modis = (totals["n_terra"] + totals["n_aqua"]).to_numpy()
    cov_modis = (totals["cov_terra"] | totals["cov_aqua"]).to_numpy()
    n_viirs = totals["n_viirs"].to_numpy()
    cov_viirs = totals["cov_snpp"].to_numpy()
    cov_aqua = totals["cov_aqua"].to_numpy()
    pred = weekly["pred"].to_numpy()
    weeks = []
    for i, (year, week) in enumerate(zip(totals["year"], totals["week"], strict=True)):
        year, week = int(year), int(week)
        modis = int(n_modis[i]) if cov_modis[i] else None
        viirs = int(n_viirs[i]) if cov_viirs[i] else None
        p = None if np.isnan(pred[i]) else round(float(pred[i]), 1)
        lo = hi = None
        if viirs is None and p is not None:
            band = uncertainty["full" if cov_aqua[i] else "terra"]
            lo, hi = round(p * band["q10"], 1), round(p * band["q90"], 1)
        status = "observed" if viirs is not None else "estimated" if p is not None else "gap"
        weeks.append(
            {
                "year": year,
                "week": week,
                "modis": modis,
                "viirs": viirs,
                "pred": p,
                "lo": lo,
                "hi": hi,
                "harmonized": viirs if viirs is not None else p,
                "status": status,
                "nrt": (viirs is not None and config.is_nrt("viirs", year, week))
                or (modis is not None and config.is_nrt("modis", year, week)),
                "why": _why(status, year, week),
            }
        )
    meta = {
        "bbox": list(config.BBOX),
        "cell_deg": config.CELL_DEG,
        "method": method,
        "coverage": config.coverage_meta(),
        "region": config.REGION_ID,
        "nx": config.NX,
        "ny": config.NY,
        "as_of": config.as_of_date([(w["year"], w["week"], w["status"]) for w in weeks]),
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
    lon = np.clip(np.round((both["lon"].to_numpy() - config.BBOX[0]) * 1000), 0, 65535).astype(
        "<u2"
    )
    lat = np.clip(np.round((both["lat"].to_numpy() - config.BBOX[1]) * 1000), 0, 65535).astype(
        "<u2"
    )
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


def _cube_blocks(cube: pd.DataFrame) -> dict[int, dict]:
    """Encode the non-empty (cell, week) entries of every year as columnar blocks."""
    cell = cube["cy"].to_numpy(np.int64) * config.NX + cube["cx"].to_numpy(np.int64)
    modis = cube["n_terra"].to_numpy(np.int64) + cube["n_aqua"].to_numpy(np.int64)
    viirs = cube["n_viirs"].to_numpy(np.int64)
    year = cube["year"].to_numpy(np.int64)
    week = cube["week"].to_numpy(np.int64)
    keep = np.flatnonzero(modis + viirs > 0)
    over = keep[(modis[keep] > 65535) | (viirs[keep] > 65535)]
    if len(over):
        i = over[0]
        raise ValueError(
            f"cube count exceeds 65535 in year {year[i]} week {week[i]} cell {cell[i]}"
        )
    out = {}
    for y in range(config.YEAR_START, config.YEAR_END + 1):
        sel = keep[year[keep] == y]
        if len(sel) == 0:
            continue
        sel = sel[np.lexsort((cell[sel], week[sel]))]
        blob = b"".join(
            [
                cell[sel].astype("<u2").tobytes(),
                week[sel].astype("u1").tobytes(),
                modis[sel].astype("<u2").tobytes(),
                viirs[sel].astype("<u2").tobytes(),
            ]
        )
        out[y] = {"n": len(sel), "blob": blob}
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
    cube = out / "cube"
    if cube.is_dir():
        for p in [*cube.glob("*.bin"), cube / "index.json"]:
            p.unlink(missing_ok=True)


def _by_year(metrics: dict) -> list[dict]:
    # a year without any MODIS detection has no raw ratio; JSON cannot hold NaN
    return [
        {**r, "ratio_raw": r["ratio_raw"] if np.isfinite(r["ratio_raw"]) else 0.0}
        for r in metrics["by_year"]
    ]


def _filters(modis: pd.DataFrame, viirs: pd.DataFrame) -> dict:
    return {
        "dropped_type": {
            "modis": int(modis.attrs.get("dropped_type", 0)),
            "viirs": int(viirs.attrs.get("dropped_type", 0)),
        }
    }


def _write_cube(out: Path, cube_blocks: dict[int, dict]) -> None:
    (out / "cube").mkdir(exist_ok=True)
    for y, c in cube_blocks.items():
        (out / "cube" / f"{y}.bin").write_bytes(c["blob"])
    cube_index = {"nx": config.NX, "ny": config.NY}
    cube_index["years"] = {str(y): {"n": c["n"]} for y, c in cube_blocks.items()}
    _write_json(out / "cube" / "index.json", cube_index)


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
    cube_blocks = _cube_blocks(cube)
    evts = events.events_per_year(modis, viirs)
    _stage("points+events")

    metrics = {
        **metrics,
        "by_year": _by_year(metrics),
        "events": evts,
        "pairing": {
            "radius_km": pairing.RADIUS_KM,
            "window_min": pairing.WINDOW_MIN,
            "headline_years": list(pairing.HEADLINE_YEARS),
            "by_year": [{**r, "dt_p50_min": int(round(r["dt_p50_min"]))} for r in pair_rows],
        },
        "filters": _filters(modis, viirs),
    }
    calendar = _calendar(totals, weekly, metrics["method"], metrics["uncertainty"])

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
    _write_cube(out, cube_blocks)
    validate_export(out)
    _stage("write+validate")


def export_light(raw_root: Path | None, out: Path) -> None:
    """Calendar, cube and metrics only: no pairing, events or points."""
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
    cube_blocks = _cube_blocks(cube)
    keep = ("method", "accepted", "weekly_total", "terra_only", "uncertainty")
    metrics = {
        **{k: metrics[k] for k in keep},
        "by_year": _by_year(metrics),
        "filters": _filters(modis, viirs),
    }
    calendar = _calendar(totals, weekly, metrics["method"], metrics["uncertainty"])

    out.mkdir(parents=True, exist_ok=True)
    _clean(out)
    _write_json(out / "calendar.json", calendar)
    _write_json(out / "metrics.json", metrics)
    _write_cube(out, cube_blocks)
    validate_export(out, light=True)
    _stage("write+validate")


def _publish(stage: Path, target: Path) -> None:
    """Replace the exported files of `target` with those of `stage`, then remove `stage`."""
    target.mkdir(parents=True, exist_ok=True)
    for name in ("calendar.json", "metrics.json", "cube", "points"):
        old = target / name
        if old.is_dir():
            shutil.rmtree(old)
        else:
            old.unlink(missing_ok=True)
        if (stage / name).exists():
            shutil.move(stage / name, old)
    shutil.rmtree(stage)


def _check_raw(raw: Path, region_id: str) -> None:
    for path in (raw, raw / "modis", raw / "viirs_snpp"):
        if not path.is_dir():
            raise SystemExit(
                f"raw folder is missing: {path}; run fetch_firms.py --region {region_id}"
            )
    if region_id != "pantanal" and not (raw / "coverage.json").is_file():
        raise SystemExit(
            f"coverage.json is missing in {raw}; run fetch_firms.py --region {region_id}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m mvh.export")
    parser.add_argument("--region", default="pantanal")
    parser.add_argument("--raw", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=_DEFAULT_OUT)
    args = parser.parse_args()
    if args.region != config.REGION_ID:
        raise SystemExit(f"config was loaded for {config.REGION_ID!r}, not {args.region!r}")
    if args.raw is not None and config.REGION_ID != "pantanal":
        raise SystemExit("use FIRMS_OUT_DIR for a region other than the Pantanal")
    raw = args.raw or config.raw_root()
    _check_raw(raw, config.REGION_ID)
    started = time.perf_counter()
    target = args.out if config.REGION_ID == "pantanal" else args.out / "regions" / config.REGION_ID
    stage = args.out / f".stage-{config.REGION_ID}"
    shutil.rmtree(stage, ignore_errors=True)
    try:
        (export_light if config.REGION.light else export_all)(raw, stage)
        _publish(stage, target)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    regions_index.write(args.out)
    regions_index.validate(args.out)
    print(f"total: {time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main()
