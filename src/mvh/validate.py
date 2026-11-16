"""Acceptance metrics comparing the model against the monthly-ratio baseline."""

from __future__ import annotations

import numpy as np
import pandas as pd

MIN_YEARS_WON = 8
MIN_YEARS_SCORED = 14


def weekly_total_scores(cv: pd.DataFrame) -> pd.DataFrame:
    """Per-year MAE of the weekly regional totals, on valid weeks only."""
    weekly = cv[cv["valid"]].copy()
    weekly["err_model"] = (weekly["pred_model"] - weekly["y"]).abs()
    weekly["err_baseline"] = (weekly["pred_baseline"] - weekly["y"]).abs()
    by_year = weekly.groupby("year").agg(
        mae_model=("err_model", "mean"),
        mae_baseline=("err_baseline", "mean"),
        y=("y", "sum"),
        modis=("modis", "sum"),
    )
    by_year["ratio_raw"] = np.where(by_year["modis"] > 0, by_year["y"] / by_year["modis"], np.nan)
    return by_year.drop(columns=["y", "modis"]).reset_index()


def ratio_quantiles(cv: pd.DataFrame, pred_col: str) -> dict[str, float]:
    """10th and 90th percentile of (y + 1) / (pred + 1) on valid held-out weeks."""
    valid = cv[cv["valid"]]
    ratio = (valid["y"] + 1) / (valid[pred_col] + 1)
    q10, q90 = np.quantile(ratio, [0.1, 0.9])
    return {"q10": round(float(q10), 4), "q90": round(float(q90), 4)}


def is_accepted(by_year: pd.DataFrame, min_years_won: int = MIN_YEARS_WON) -> bool:
    mae_model, mae_base = by_year["mae_model"], by_year["mae_baseline"]
    won = int((mae_model < mae_base).sum())
    return bool(mae_model.mean() < mae_base.mean() and won >= min_years_won)


def _headline(by_year: pd.DataFrame) -> dict:
    return {
        "mae_model": round(float(by_year["mae_model"].mean()), 2),
        "mae_baseline": round(float(by_year["mae_baseline"].mean()), 2),
        "years_won": int((by_year["mae_model"] < by_year["mae_baseline"]).sum()),
        "years": int(len(by_year)),
    }


def _accepted(by_year: pd.DataFrame) -> bool:
    return len(by_year) >= MIN_YEARS_SCORED and is_accepted(by_year)


def summarize(cv_full: pd.DataFrame, cv_terra: pd.DataFrame) -> dict:
    full = weekly_total_scores(cv_full)
    terra = weekly_total_scores(cv_terra)
    accepted = _accepted(full)
    return {
        "method": "model" if accepted else "baseline",
        "accepted": accepted,
        "weekly_total": _headline(full),
        "by_year": [
            {
                "year": int(r.year),
                "mae_model": round(float(r.mae_model), 2),
                "mae_baseline": round(float(r.mae_baseline), 2),
                "ratio_raw": round(float(r.ratio_raw), 3),
            }
            for r in full.itertuples()
        ],
        "terra_only": {"accepted": _accepted(terra), **_headline(terra)},
    }
