"""Aqua x S-NPP pairing: detections one sensor made that the other did not confirm."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from mvh import config

RADIUS_KM = 2.0
WINDOW_MIN = 180
HEADLINE_YEARS = (2012, 2021)  # Aqua's orbit drifts from 2022 on

_KM_LON = 111.32 * np.cos(np.radians(-19.0))
_KM_LAT = 110.57
_DAY = np.timedelta64(1, "D")


def _xy(df: pd.DataFrame) -> np.ndarray:
    return np.column_stack([df["lon"].to_numpy() * _KM_LON, df["lat"].to_numpy() * _KM_LAT])


def _intervals(spans: list[tuple[date, date]], days: np.ndarray) -> np.ndarray:
    ok = np.zeros(len(days), dtype=bool)
    for lo, hi in spans:
        ok |= (days >= np.datetime64(lo)) & (days <= np.datetime64(hi))
    return ok


def _eligible_days(days: np.ndarray) -> np.ndarray:
    """UTC dates on which both Aqua and S-NPP were operating (for the given row dates)."""
    ok = days >= np.datetime64(config.TRAIN_START)
    ok &= _intervals(config.COVERAGE["modis"], days) & _intervals(config.COVERAGE["viirs"], days)
    for gap_sat in ("Aqua", "SNPP"):
        ok &= ~_intervals(config.KNOWN_GAPS[gap_sat], days)
    return ok


def _eligibility(modis: pd.DataFrame, viirs: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    m_days = modis["ts"].to_numpy().astype("datetime64[D]")
    v_days = viirs["ts"].to_numpy().astype("datetime64[D]")
    m_ok = (modis["sat"].to_numpy() == "Aqua") & _eligible_days(m_days)
    v_ok = _eligible_days(v_days)
    return m_ok, v_ok


def _match(modis, viirs, radius_km, window_min):
    """Return (m_ok, v_ok, m_hit, v_hit, m_dt) where *_hit mean "has a match" and m_dt is the
    absolute lag in minutes to the spatially nearest match of each Aqua row (NaN if none)."""
    m_ok, v_ok = _eligibility(modis, viirs)
    m_hit = np.zeros(len(modis), dtype=bool)
    v_hit = np.zeros(len(viirs), dtype=bool)
    m_dt = np.full(len(modis), np.nan)
    m_idx = np.flatnonzero(m_ok)
    v_idx = np.flatnonzero(v_ok)
    if len(m_idx) == 0 or len(v_idx) == 0:
        return m_ok, v_ok, m_hit, v_hit, m_dt

    m_ts = modis["ts"].to_numpy()[m_idx]
    v_ts = viirs["ts"].to_numpy()[v_idx]
    m_xy = _xy(modis)[m_idx]
    v_xy = _xy(viirs)[v_idx]
    v_order = np.argsort(v_ts, kind="stable")
    v_ts, v_xy, v_idx = v_ts[v_order], v_xy[v_order], v_idx[v_order]
    window = np.timedelta64(int(round(window_min * 60)), "s")

    m_day = m_ts.astype("datetime64[D]")
    m_order = np.argsort(m_day, kind="stable")
    days, starts = np.unique(m_day[m_order], return_index=True)
    ends = np.append(starts[1:], len(m_order))
    for day, a, b in zip(days, starts, ends, strict=True):
        rows = m_order[a:b]
        lo = np.searchsorted(v_ts, day.astype("datetime64[ns]") - window)
        hi = np.searchsorted(v_ts, (day + _DAY).astype("datetime64[ns]") + window, side="right")
        if lo == hi:
            continue
        pairs = cKDTree(m_xy[rows]).sparse_distance_matrix(
            cKDTree(v_xy[lo:hi]), radius_km, output_type="ndarray"
        )
        i = rows[pairs["i"]]
        j = pairs["j"] + lo
        lag = np.abs(m_ts[i] - v_ts[j])
        keep = lag <= window
        i, j, lag, dist = i[keep], j[keep], lag[keep], pairs["v"][keep]
        if len(i) == 0:
            continue
        m_hit[m_idx[i]] = True
        v_hit[v_idx[j]] = True
        nearest = np.lexsort((dist, i))
        i, lag = i[nearest], lag[nearest]
        first = np.unique(i, return_index=True)[1]
        m_dt[m_idx[i[first]]] = lag[first] / np.timedelta64(1, "m")
    return m_ok, v_ok, m_hit, v_hit, m_dt


def find_ghosts(
    modis: pd.DataFrame,
    viirs: pd.DataFrame,
    radius_km: float = RADIUS_KM,
    window_min: float = WINDOW_MIN,
) -> tuple[np.ndarray, np.ndarray]:
    m_ok, v_ok, m_hit, v_hit, _ = _match(modis, viirs, radius_km, window_min)
    return m_ok & ~m_hit, v_ok & ~v_hit


def pairing_stats(
    modis: pd.DataFrame,
    viirs: pd.DataFrame,
    modis_ghost: np.ndarray,
    viirs_ghost: np.ndarray,
) -> list[dict]:
    m_ok, v_ok, _, _, m_dt = _match(modis, viirs, RADIUS_KM, WINDOW_MIN)
    m_year = modis["year"].to_numpy()
    v_year = viirs["year"].to_numpy()
    out = []
    for year in sorted(set(m_year[m_ok]) & set(v_year[v_ok])):
        m_sel = m_ok & (m_year == year)
        v_sel = v_ok & (v_year == year)
        lags = m_dt[m_sel]
        lags = lags[~np.isnan(lags)]
        out.append(
            {
                "year": int(year),
                "aqua_n": int(m_sel.sum()),
                "aqua_unmatched": round(float(np.mean(modis_ghost[m_sel])), 4),
                "viirs_n": int(v_sel.sum()),
                "viirs_unmatched": round(float(np.mean(viirs_ghost[v_sel])), 4),
                "dt_p50_min": round(float(np.median(lags)), 1) if len(lags) else 0.0,
            }
        )
    return out
