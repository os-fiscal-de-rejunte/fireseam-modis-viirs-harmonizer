"""Poisson GLM converting weekly regional MODIS activity into VIIRS-equivalent counts."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from mvh.baseline import fit_baseline, modis_count, predict_baseline
from mvh.grid import weekly_totals
from mvh.validate import ratio_quantiles, summarize

CV_YEARS = range(2012, 2026)
_SATS = {"full": ["terra", "aqua"], "terra": ["terra"]}
_MODES = ("full", "terra")


def features(totals: pd.DataFrame, mode: str) -> pd.DataFrame:
    """Log-scaled activity, intensity and concentration features of one week per row."""
    sats = _SATS[mode]
    out = pd.DataFrame(index=totals.index)
    out["logm"] = np.log1p(sum(totals[f"n_{s}"].astype(float) for s in sats))
    for s in sats:
        n = totals[f"n_{s}"].astype(float)
        n1 = n.clip(lower=1)
        out[f"log_{s}"] = np.log1p(n)
        out[f"night_{s}"] = totals[f"night_{s}"] / n1
        out[f"logfrp_{s}"] = np.log1p(totals[f"frp_{s}"] / n1)
        out[f"conc_{s}"] = np.log1p(n / totals[f"cells_{s}"].clip(lower=1))
    angle = 2 * np.pi * (totals["week"].astype(float) - 1) / 52
    out["sin"] = np.sin(angle)
    out["cos"] = np.cos(angle)
    return out


def train_mask(totals: pd.DataFrame, mode: str) -> np.ndarray:
    """Weeks usable for training: 2012-2025, fully covered by every sensor the mode needs."""
    year = totals["year"].to_numpy()
    mask = (year >= CV_YEARS.start) & (year < CV_YEARS.stop)
    mask &= totals["cov_snpp"].to_numpy() & totals["cov_terra"].to_numpy()
    if mode == "full":
        mask &= totals["cov_aqua"].to_numpy()
    return mask


def fit(rows: pd.DataFrame, mode: str):
    model = make_pipeline(StandardScaler(), PoissonRegressor(alpha=1e-3, max_iter=2000))
    return model.fit(features(rows, mode), rows["n_viirs"])


def predict(model, rows: pd.DataFrame, mode: str) -> np.ndarray:
    return np.clip(model.predict(features(rows, mode)), 0.0, None)


def cross_validate(totals: pd.DataFrame, mode: str) -> pd.DataFrame:
    """Leave-one-year-out: the held-out year is absent from both the model and the baseline."""
    year = totals["year"].to_numpy()
    valid = train_mask(totals, mode)
    scored = (year >= CV_YEARS.start) & (year < CV_YEARS.stop)
    test_all = totals[scored]
    out = test_all[["year", "week"]].copy()
    out["y"] = test_all["n_viirs"].to_numpy()
    out["modis"] = modis_count(test_all, mode).astype(np.int64)
    pred_model = np.zeros(len(out))
    pred_base = np.zeros(len(out))
    out_year = out["year"].to_numpy()
    for held in CV_YEARS:
        train = totals[valid & (year != held)]
        pos = np.flatnonzero(out_year == held)
        test = test_all.iloc[pos]
        pred_model[pos] = predict(fit(train, mode), test, mode)
        pred_base[pos] = predict_baseline(fit_baseline(train, mode), test, mode)
    out["pred_model"] = pred_model
    out["pred_baseline"] = pred_base
    out["valid"] = valid[scored]
    return out.reset_index(drop=True)


def harmonize(cube: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Weekly VIIRS-equivalent series for every year plus the validation metrics."""
    totals = weekly_totals(cube)
    cvs = {mode: cross_validate(totals, mode) for mode in _MODES}
    metrics = summarize(cvs["full"], cvs["terra"])
    use_model = {"full": metrics["accepted"], "terra": metrics["terra_only"]["accepted"]}
    metrics["uncertainty"] = {
        mode: ratio_quantiles(cvs[mode], "pred_model" if use_model[mode] else "pred_baseline")
        for mode in _MODES
    }

    year = totals["year"].to_numpy()
    in_cv = (year >= CV_YEARS.start) & (year < CV_YEARS.stop)
    series = {}
    for mode in _MODES:
        train = totals[train_mask(totals, mode)]
        if use_model[mode]:
            values = predict(fit(train, mode), totals, mode)
            cv_pred = cvs[mode]["pred_model"].to_numpy()
        else:
            values = predict_baseline(fit_baseline(train, mode), totals, mode)
            cv_pred = cvs[mode]["pred_baseline"].to_numpy()
        # inside 2012-2025 only the fold that never saw the year may speak
        values[in_cv] = cv_pred
        series[mode] = values
    pred = np.where(totals["cov_aqua"], series["full"], series["terra"])
    pred = np.where(totals["cov_terra"], pred, np.nan)
    return pd.DataFrame({"year": totals["year"], "week": totals["week"], "pred": pred}), metrics
