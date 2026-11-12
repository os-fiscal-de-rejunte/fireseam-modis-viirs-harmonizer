"""Dense cell x week cube built from the standard detections frames."""

from __future__ import annotations

import numpy as np
import pandas as pd

from mvh import config

_N_YEARS = config.YEAR_END - config.YEAR_START + 1
_N_CELLS = config.NX * config.NY
_N_WEEKS = _N_YEARS * config.WEEKS_PER_YEAR
_SATS = {"terra": "Terra", "aqua": "Aqua"}


def cell_index(lon, lat) -> tuple[np.ndarray, np.ndarray]:
    """Grid column and row of each point; the east/north edge falls in the last cell."""
    # rounding first keeps points that sit on a cell boundary in the upper cell
    fx = np.floor(np.round((np.asarray(lon) - config.BBOX[0]) / config.CELL_DEG, 9))
    fy = np.floor(np.round((np.asarray(lat) - config.BBOX[1]) / config.CELL_DEG, 9))
    cx = np.clip(fx, 0, config.NX - 1).astype(np.int16)
    cy = np.clip(fy, 0, config.NY - 1).astype(np.int16)
    return cx, cy


def _week_table() -> pd.DataFrame:
    years = np.repeat(np.arange(config.YEAR_START, config.YEAR_END + 1), config.WEEKS_PER_YEAR)
    weeks = np.tile(np.arange(1, config.WEEKS_PER_YEAR + 1), _N_YEARS)
    pairs = list(zip(years.tolist(), weeks.tolist(), strict=True))
    return pd.DataFrame(
        {
            "year": years.astype(np.int16),
            "week": weeks.astype(np.int8),
            "month": np.array([config.week_bounds(y, w)[0].month for y, w in pairs], np.int8),
            "cov_terra": [config.sat_covers("Terra", y, w) for y, w in pairs],
            "cov_aqua": [config.sat_covers("Aqua", y, w) for y, w in pairs],
            "cov_snpp": [config.sat_covers("SNPP", y, w) for y, w in pairs],
        }
    )


def _flat(df: pd.DataFrame) -> np.ndarray:
    """Flat (year, week, cy, cx) index of each detection; -1 when outside the cube."""
    cx, cy = cell_index(df["lon"].to_numpy(), df["lat"].to_numpy())
    yi = df["year"].to_numpy().astype(np.int64) - config.YEAR_START
    wi = df["week"].to_numpy().astype(np.int64) - 1
    flat = ((yi * config.WEEKS_PER_YEAR + wi) * config.NY + cy) * config.NX + cx
    ok = (yi >= 0) & (yi < _N_YEARS)
    return np.where(ok, flat, -1)


def _scatter(flat: np.ndarray, size: int, weights=None) -> np.ndarray:
    keep = flat >= 0
    w = None if weights is None else np.asarray(weights, dtype=np.float64)[keep]
    return np.bincount(flat[keep], weights=w, minlength=size)


def weekly_cube(modis: pd.DataFrame, viirs: pd.DataFrame) -> pd.DataFrame:
    """Dense frame with one row per (year, week, cy, cx); see the column list in the docs."""
    size = _N_WEEKS * _N_CELLS
    weeks = _week_table()
    idx = np.arange(size)
    cube = {
        "year": np.repeat(weeks["year"].to_numpy(), _N_CELLS),
        "week": np.repeat(weeks["week"].to_numpy(), _N_CELLS),
        "month": np.repeat(weeks["month"].to_numpy(), _N_CELLS),
        "cx": (idx % config.NX).astype(np.int16),
        "cy": ((idx // config.NX) % config.NY).astype(np.int16),
    }
    flat_m = _flat(modis)
    sat = modis["sat"].to_numpy()
    for key, name in _SATS.items():
        mask = sat == name
        flat = flat_m[mask]
        n = _scatter(flat, size)
        conf = _scatter(flat, size, modis["conf"].to_numpy()[mask])
        cube[f"n_{key}"] = n.astype(np.int32)
        cube[f"frp_{key}"] = _scatter(flat, size, modis["frp"].to_numpy()[mask]).astype(np.float32)
        cube[f"night_{key}"] = _scatter(flat, size, modis["night"].to_numpy()[mask]).astype(
            np.int32
        )
        cube[f"conf_{key}"] = np.divide(conf, n, out=np.zeros(size), where=n > 0).astype(np.float32)
    cube["n_viirs"] = _scatter(_flat(viirs), size).astype(np.int32)
    for flag in ("cov_terra", "cov_aqua", "cov_snpp"):
        cube[flag] = np.repeat(weeks[flag].to_numpy(), _N_CELLS)
    order = [
        "year", "week", "month", "cx", "cy",
        "n_terra", "n_aqua", "frp_terra", "frp_aqua", "night_terra", "night_aqua",
        "conf_terra", "conf_aqua", "n_viirs", "cov_terra", "cov_aqua", "cov_snpp",
    ]  # fmt: skip
    return pd.DataFrame({c: cube[c] for c in order})


def weekly_totals(cube: pd.DataFrame) -> pd.DataFrame:
    """One row per (year, week): sums over cells, active-cell counts, month and coverage flags."""
    work = cube.assign(cells_terra=cube["n_terra"] > 0, cells_aqua=cube["n_aqua"] > 0)
    grouped = work.groupby(["year", "week"], sort=True)
    sums = [
        "n_terra", "n_aqua", "n_viirs", "frp_terra", "frp_aqua",
        "night_terra", "night_aqua", "cells_terra", "cells_aqua",
    ]  # fmt: skip
    out = grouped[sums].sum()
    flags = grouped[["month", "cov_terra", "cov_aqua", "cov_snpp"]].first()
    return pd.concat([out, flags], axis=1).reset_index()
