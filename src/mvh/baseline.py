"""Naive monthly-ratio baseline: VIIRS count = MODIS count x a factor per calendar month."""

from __future__ import annotations

import numpy as np
import pandas as pd


def modis_count(rows: pd.DataFrame, mode: str) -> np.ndarray:
    """MODIS detections seen in `mode`: Terra + Aqua (full) or Terra only (terra)."""
    n = rows["n_terra"].to_numpy(dtype=np.float64)
    if mode == "full":
        n = n + rows["n_aqua"].to_numpy(dtype=np.float64)
    return n


def fit_baseline(rows: pd.DataFrame, mode: str) -> dict[int, float]:
    modis = modis_count(rows, mode)
    viirs = rows["n_viirs"].to_numpy(dtype=np.float64)
    month = rows["month"].to_numpy()
    total = modis.sum()
    overall = viirs.sum() / total if total > 0 else 1.0
    factors = {}
    for m in range(1, 13):
        sel = month == m
        denom = modis[sel].sum()
        factors[m] = float(viirs[sel].sum() / denom) if denom > 0 else float(overall)
    return factors


def predict_baseline(factors: dict[int, float], rows: pd.DataFrame, mode: str) -> np.ndarray:
    per_month = np.array([factors[m] for m in range(1, 13)], dtype=np.float64)
    return modis_count(rows, mode) * per_month[rows["month"].to_numpy().astype(int) - 1]
