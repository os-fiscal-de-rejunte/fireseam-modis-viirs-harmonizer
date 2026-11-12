import numpy as np
import pandas as pd
import pytest

from mvh import config, harmonizer
from mvh.grid import weekly_totals
from mvh.harmonizer import CV_YEARS, cross_validate, fit, harmonize, predict, train_mask


def make_cube(seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for year in range(config.YEAR_START, config.YEAR_END + 1):
        for week in range(1, config.WEEKS_PER_YEAR + 1):
            rows.append(
                {
                    "year": year,
                    "week": week,
                    "month": config.week_bounds(year, week)[0].month,
                    "cov_terra": config.sat_covers("Terra", year, week),
                    "cov_aqua": config.sat_covers("Aqua", year, week),
                    "cov_snpp": config.sat_covers("SNPP", year, week),
                }
            )
    t = pd.DataFrame(rows)
    n = len(t)
    for k in ("terra", "aqua"):
        t[f"n_{k}"] = rng.poisson(40, n)
        t[f"frp_{k}"] = t[f"n_{k}"] * rng.uniform(5, 15, n)
        t[f"night_{k}"] = (t[f"n_{k}"] * 0.3).astype(int)
    t["n_viirs"] = np.where(t["year"] >= 2012, rng.poisson(3.5 * (t.n_terra + t.n_aqua) / 2), 0)
    t["cx"] = 0
    t["cy"] = 0
    return t  # one cell per week: enough for weekly_totals


@pytest.fixture(scope="module")
def cube():
    return make_cube()


@pytest.fixture(scope="module")
def totals(cube):
    return weekly_totals(cube)


@pytest.fixture(scope="module")
def cvs(totals):
    return {mode: cross_validate(totals, mode) for mode in ("full", "terra")}


def test_train_mask_rules(totals):
    totals = totals.copy()
    aqua_out = (totals["year"] == 2015) & (totals["week"] == 10)
    totals.loc[aqua_out, "cov_aqua"] = False
    year = totals["year"].to_numpy()
    full = train_mask(totals, "full")
    terra = train_mask(totals, "terra")
    for mask in (full, terra):
        assert not mask[year == 2026].any()
        assert not mask[year < 2012].any()
        assert not mask[~totals["cov_snpp"].to_numpy()].any()
        assert not mask[~totals["cov_terra"].to_numpy()].any()
    assert not full[aqua_out.to_numpy()].any()
    assert terra[aqua_out.to_numpy()].all()


def test_predictions_finite_nonnegative_and_small_for_zero_modis(totals):
    model = fit(totals[train_mask(totals, "full")], "full")
    out = predict(model, totals, "full")
    assert np.isfinite(out).all()
    assert (out >= 0).all()
    zero = totals.iloc[:5].copy()
    for k in ("terra", "aqua"):
        for col in ("n", "frp", "night", "cells"):
            zero[f"{col}_{k}"] = 0
    small = predict(model, zero, "full")
    assert np.isfinite(small).all()
    assert small.max() < totals["n_viirs"][train_mask(totals, "full")].mean()


@pytest.mark.parametrize("mode", ["full", "terra"])
def test_leakage_held_out_year_absent_from_fit_and_baseline(totals, monkeypatch, mode):
    seen = {"fit": [], "baseline": []}
    real_fit, real_base = harmonizer.fit, harmonizer.fit_baseline

    def spy_fit(rows, mode):
        seen["fit"].append(set(rows["year"].unique()))
        return real_fit(rows, mode)

    def spy_base(rows, mode):
        seen["baseline"].append(set(rows["year"].unique()))
        return real_base(rows, mode)

    monkeypatch.setattr(harmonizer, "fit", spy_fit)
    monkeypatch.setattr(harmonizer, "fit_baseline", spy_base)
    cross_validate(totals, mode)
    for key in seen:
        assert len(seen[key]) == len(CV_YEARS)
        for year, years in zip(CV_YEARS, seen[key], strict=True):
            assert year not in years
            assert years


@pytest.mark.parametrize("mode", ["full", "terra"])
def test_leakage_corrupted_held_out_target_leaves_its_predictions_unchanged(totals, mode):
    held = 2018
    before = cross_validate(totals, mode)
    corrupted = totals.copy()
    is_held = (corrupted["year"] == held).to_numpy()
    corrupted.loc[is_held, "n_viirs"] = corrupted.loc[is_held, "n_viirs"] * 50 + 999
    after = cross_validate(corrupted, mode)
    rows = (before["year"] == held).to_numpy()
    assert rows.any()
    assert not np.array_equal(before["y"].to_numpy()[rows], after["y"].to_numpy()[rows])
    for col in ("pred_model", "pred_baseline"):
        assert np.array_equal(before[col].to_numpy()[rows], after[col].to_numpy()[rows])


def test_cross_validate_rows_and_order(totals, cvs):
    cv = cvs["full"]
    sub = totals[(totals["year"] >= 2012) & (totals["year"] <= 2025)]
    assert len(cv) == len(sub) == 14 * 52
    assert (cv["year"].to_numpy() == sub["year"].to_numpy()).all()
    assert (cv["week"].to_numpy() == sub["week"].to_numpy()).all()
    assert cv["year"].max() == 2025
    assert not cv["valid"].all()
    assert (cv["y"].to_numpy() == sub["n_viirs"].to_numpy()).all()
    assert (cv["modis"].to_numpy() == (sub["n_terra"] + sub["n_aqua"]).to_numpy()).all()
    assert cv[["pred_model", "pred_baseline"]].notna().all().all()
    assert list(cv.columns) == [
        "year",
        "week",
        "y",
        "modis",
        "pred_model",
        "pred_baseline",
        "valid",
    ]


def test_harmonize_weekly_series(cube, totals, cvs):
    weekly, metrics = harmonize(cube)
    assert len(weekly) == 26 * 52
    assert list(weekly.columns) == ["year", "week", "pred"]
    assert (weekly["pred"].isna().to_numpy() == ~totals["cov_terra"].to_numpy()).all()
    early = weekly[(weekly["year"] < 2002) & totals["cov_terra"]]
    assert len(early) > 0 and early["pred"].notna().all()

    col_full = "pred_model" if metrics["accepted"] else "pred_baseline"
    col_terra = "pred_model" if metrics["terra_only"]["accepted"] else "pred_baseline"
    full = cvs["full"].set_index(["year", "week"])[col_full]
    terra = cvs["terra"].set_index(["year", "week"])[col_terra]
    checked = 0
    for w, fl in zip(weekly.itertuples(), totals.itertuples(), strict=True):
        if 2012 <= w.year <= 2025 and fl.cov_terra:
            expected = full[(w.year, w.week)] if fl.cov_aqua else terra[(w.year, w.week)]
            assert w.pred == pytest.approx(expected)
            checked += 1
    assert checked > 600


def test_deterministic(totals, cvs):
    pd.testing.assert_frame_equal(cvs["terra"], cross_validate(totals, "terra"))
