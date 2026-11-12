import copy
import json
import shutil
from pathlib import Path

import pytest

from mvh.forecast import build_forecast, main, validate_forecast

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "sample" / "pyro"


@pytest.fixture(scope="module")
def forecast():
    return build_forecast(SAMPLE)


def cell(fc, cid):
    return next(c for c in fc["cells"] if c["id"] == cid)


def test_seasonal_uses_region_month_then_month_fallback(forecast):
    p = cell(forecast, "c_a")["p"]
    assert p[0] == 0.25  # region_month [1, 3] -> 1 / 4
    assert p[1] == 0.25  # region_month [2, 6] -> 2 / 8
    assert p[2] == 0.4  # no region entry -> month[3] = [20, 30] -> 20 / 50


def test_regional_seasonal_uses_continent_month_then_month_fallback(forecast):
    p = cell(forecast, "c_b")["p"]
    assert p[0] == 0.25  # Africa month 1 [3, 9] -> 3 / 12
    assert p[5] == 0.5  # Africa month 6 [1, 1]
    assert p[1] == 0.5  # no continent entry -> month[2] = [20, 20]
    assert p[2] == 0.4  # month[3] = [20, 30]


def test_unreleased_cell_is_all_null(forecast):
    assert cell(forecast, "c_c")["released"] is False
    assert cell(forecast, "c_c")["p"] == [None] * 12


def test_month_outside_projection_months_is_null(forecast):
    p = cell(forecast, "c_a")["p"]
    assert p[3:] == [None] * 9
    assert all(v is not None for v in p[:3])


def test_released_cell_without_model_is_all_null(forecast):
    c = cell(forecast, "c_d")
    assert c["released"] is True
    assert c["p"] == [None] * 12


def test_meta_and_polygon(forecast):
    meta = forecast["meta"]
    assert meta["cells_total"] == 4
    assert meta["cells_released"] == 3
    assert meta["released_area_km2"] == 4320
    assert meta["horizon_days"] == 8
    assert meta["test"] == {
        "n": 100,
        "accuracy": 0.7886,
        "recall": 0.3955,
        "precision": 0.5786,
        "brier": 0.1508,
        "roc_auc": 0.7506,
    }
    assert [c["id"] for c in forecast["cells"]] == ["c_a", "c_b", "c_c", "c_d"]
    ring = cell(forecast, "c_a")["polygon"]
    assert ring[0] == ring[-1] == [10.1235, 45.0]
    validate_forecast(forecast)


def mutated(forecast, fn):
    obj = copy.deepcopy(forecast)
    fn(obj)
    return obj


@pytest.mark.parametrize(
    ("fn", "field"),
    [
        (lambda o: o["cells"][0]["p"].__setitem__(0, 1.2), "p"),
        (lambda o: o["cells"][0]["p"].pop(), "p"),
        (lambda o: o["cells"][0]["polygon"].pop(), "polygon"),
        (lambda o: o["cells"][1].__setitem__("id", o["cells"][0]["id"]), "id"),
        (lambda o: o["meta"].__setitem__("cells_released", 99), "cells_released"),
    ],
)
def test_validate_rejects(forecast, fn, field):
    with pytest.raises(ValueError, match=field):
        validate_forecast(mutated(forecast, fn))


def test_build_is_deterministic():
    a = json.dumps(build_forecast(SAMPLE))
    assert a == json.dumps(build_forecast(SAMPLE))


def test_missing_artifact_names_the_file(tmp_path):
    shutil.copytree(SAMPLE, tmp_path, dirs_exist_ok=True)
    (tmp_path / "baseline_model.json").unlink()
    with pytest.raises((FileNotFoundError, ValueError), match="baseline_model.json"):
        build_forecast(tmp_path)


def test_main_requires_artifacts_dir(monkeypatch):
    monkeypatch.delenv("PYRO_ARTIFACTS_DIR", raising=False)
    monkeypatch.setattr("sys.argv", ["forecast"])
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 2


def test_main_writes_compact_idempotent_file(tmp_path, monkeypatch):
    out = tmp_path / "forecast.json"
    monkeypatch.setattr("sys.argv", ["forecast", "--pyro", str(SAMPLE), "--out", str(out)])
    main()
    text = out.read_text(encoding="utf-8")
    assert text.endswith("}\n") and '","' in text and '": ' not in text
    first = out.read_bytes()
    main()
    assert out.read_bytes() == first
