import numpy as np
import pandas as pd

from mvh.baseline import fit_baseline, predict_baseline


def _rows(months, n_terra, n_aqua, n_viirs):
    return pd.DataFrame({"month": months, "n_terra": n_terra, "n_aqua": n_aqua, "n_viirs": n_viirs})


def test_factor_equals_monthly_ratio():
    rows = _rows([1, 1, 2], [2, 2, 5], [0, 2, 5], [8, 8, 30])
    factors = fit_baseline(rows, "full")
    assert factors[1] == 16 / 6
    assert factors[2] == 3.0
    assert sorted(factors) == list(range(1, 13))


def test_month_without_modis_uses_global_ratio():
    rows = _rows([1, 2], [4, 0], [0, 0], [8, 5])
    factors = fit_baseline(rows, "full")
    assert factors[1] == 2.0
    assert factors[2] == 13 / 4
    assert factors[7] == 13 / 4


def test_no_overlap_gives_ones():
    factors = fit_baseline(_rows([], [], [], []).astype(float), "full")
    assert factors == {m: 1.0 for m in range(1, 13)}
    zero = fit_baseline(_rows([3], [0], [0], [5]), "terra")
    assert set(zero.values()) == {1.0}


def test_prediction_keeps_row_alignment():
    rows = _rows([2, 1, 1], [1, 2, 3], [1, 0, 0], [0, 0, 0])
    out = predict_baseline({m: float(m) for m in range(1, 13)}, rows, "full")
    assert out.dtype == np.float64
    assert out.tolist() == [4.0, 2.0, 3.0]


def test_terra_mode_ignores_aqua_columns():
    rows = _rows([1, 1], [2, 2], [100, 100], [6, 6])
    assert fit_baseline(rows, "terra")[1] == 3.0
    assert predict_baseline({m: 2.0 for m in range(1, 13)}, rows, "terra").tolist() == [4.0, 4.0]
