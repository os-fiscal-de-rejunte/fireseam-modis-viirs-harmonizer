import json

import pandas as pd

from mvh.validate import is_accepted, ratio_quantiles, summarize, weekly_total_scores


def _by_year(model, baseline):
    return pd.DataFrame({"mae_model": model, "mae_baseline": baseline})


def test_is_accepted_false_when_model_worse():
    assert not is_accepted(_by_year([5, 5, 5], [1, 1, 1]), min_years_won=1)


def test_is_accepted_false_when_mean_better_but_few_years_won():
    # the mean is better only because of one large year; the model loses one of four years
    by_year = _by_year([1, 1, 5, 10], [2, 2, 2, 30])
    assert by_year["mae_model"].mean() < by_year["mae_baseline"].mean()
    assert not is_accepted(by_year, min_years_won=4)
    assert is_accepted(by_year, min_years_won=3)


def _cv(rows):
    cols = ["year", "week", "y", "modis", "pred_model", "pred_baseline", "valid"]
    return pd.DataFrame(rows, columns=cols)


def test_weekly_total_scores_ignores_non_valid_weeks():
    cv = _cv(
        [
            (2012, 1, 10, 2, 9.0, 5.0, True),
            (2012, 2, 20, 3, 21.0, 25.0, True),
            (2012, 3, 0, 1, 500.0, 500.0, False),
        ]
    )
    scores = weekly_total_scores(cv)
    assert len(scores) == 1
    row = scores.iloc[0]
    assert row["mae_model"] == 1.0
    assert row["mae_baseline"] == 5.0
    assert row["ratio_raw"] == 6.0


def test_summarize_contract_keys_and_json():
    rows = [
        (y, w, 10 + w, 3, 10 + w + 1.234, 10 + w + 3.0, True)
        for y in (2012, 2013)
        for w in range(1, 6)
    ]
    cv = _cv(rows)
    out = summarize(cv, cv)
    assert set(out) == {"method", "accepted", "weekly_total", "by_year", "terra_only"}
    assert set(out["weekly_total"]) == {"mae_model", "mae_baseline", "years_won", "years"}
    assert set(out["terra_only"]) == {"accepted", "mae_model", "mae_baseline", "years_won", "years"}
    assert set(out["by_year"][0]) == {"year", "mae_model", "mae_baseline", "ratio_raw"}
    assert out["weekly_total"]["years"] == 2
    json.dumps(out)
    assert out["accepted"] is False  # only 2 years, MIN_YEARS_WON is 8
    assert out["method"] == "baseline"


def test_ratio_quantiles_use_valid_weeks_only():
    cv = pd.DataFrame(
        {
            "y": [0, 9, 19, 39, 999],
            "pred_model": [0.0, 9.0, 9.0, 9.0, 0.0],
            "valid": [True, True, True, True, False],
        }
    )
    # ratios (y + 1) / (pred + 1) on valid rows: 1, 1, 2, 4
    assert ratio_quantiles(cv, "pred_model") == {"q10": 1.0, "q90": 3.4}


def _cv_years(first, last):
    rows = [
        (y, w, 10 + w, 3, 10 + w, 10 + w + 5.0, True)
        for y in range(first, last + 1)
        for w in (1, 2)
    ]
    return _cv(rows)


def test_fewer_than_14_years_is_not_accepted():
    short = _cv_years(2012, 2024)
    out = summarize(short, short)
    assert out["weekly_total"]["years"] == 13
    assert out["accepted"] is False
    assert out["terra_only"]["accepted"] is False
    full = _cv_years(2012, 2025)
    assert summarize(full, full)["accepted"] is True
