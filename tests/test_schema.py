import json
import shutil
from pathlib import Path

import pytest

from mvh.schema import validate_export

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "sample" / "export"


@pytest.fixture
def export(tmp_path):
    dst = tmp_path / "export"
    shutil.copytree(SAMPLE, dst)
    return dst


def _edit(path, fn):
    data = json.loads(path.read_text(encoding="utf-8"))
    fn(data)
    path.write_text(json.dumps(data), encoding="utf-8")


def _edit_cal(export, fn):
    _edit(export / "calendar.json", lambda d: fn(d["weeks"]))


def test_sample_is_valid():
    validate_export(SAMPLE)


def test_gap_week_is_accepted(export):
    # 2026 week 46: no sensor covers it
    def check(weeks):
        wk = weeks[25 * 52 + 45]
        assert (wk["viirs"], wk["pred"], wk["harmonized"], wk["status"]) == (
            None,
            None,
            None,
            "gap",
        )

    _edit_cal(export, check)
    validate_export(export)


def _obs(w, **kw):
    # 2020 week 13: all sensors cover it
    w[1000].update(kw)


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda w: w.pop(5), r"weeks must be a list"),
        (lambda w: w.__setitem__(slice(3, 5), [w[4], w[3]]), r"weeks\[3\] must be year"),
        (lambda w: _obs(w, week=True), r"weeks\[1000\] must be year"),
        (lambda w: _obs(w, year=2020.0), r"weeks\[1000\] must be year"),
        (lambda w: w[1000].pop("modis"), r"weeks\[1000\] is missing"),
        (lambda w: w[1000].pop("pred"), r"weeks\[1000\] is missing"),
        (lambda w: _obs(w, viirs=-1, harmonized=-1), r"weeks\[1000\]\.viirs must be int"),
        (lambda w: _obs(w, viirs=True, harmonized=True), r"weeks\[1000\]\.viirs must be int"),
        (lambda w: _obs(w, status="gap"), r"weeks\[1000\]\.status"),
        (lambda w: _obs(w, harmonized=w[1000]["viirs"] + 1), r"weeks\[1000\]\.harmonized"),
        (lambda w: _obs(w, nrt=1), r"weeks\[1000\]\.nrt"),
        (lambda w: _obs(w, modis=None), r"weeks\[1000\]\.modis must be null iff"),
        (
            lambda w: _obs(w, viirs=None, harmonized=None, status="estimated"),
            r"\.viirs must be null iff",
        ),
        (lambda w: _obs(w, pred=None), r"weeks\[1000\]\.pred must be null iff"),
        # zero-filled week before VIIRS existed
        (
            lambda w: w[0].update(viirs=0, harmonized=0, status="observed"),
            r"weeks\[0\]\.viirs must be null",
        ),
        (lambda w: w[0].update(modis=None), r"weeks\[0\]\.modis must be null iff"),
        (
            lambda w: _obs(w, lo=1.0),
            r"lo and hi must be null unless status is 'estimated'",
        ),
        (lambda w: w[0].update(lo=w[0]["hi"] + 1), r"lo must be <= hi"),
        (
            lambda w: w[0].update(lo=None),
            r"lo and hi must be numbers >= 0 when status is 'estimated'",
        ),
        (lambda w: _obs(w, why="pre_viirs"), r"why must be null iff status is 'observed'"),
        (lambda w: w[0].update(why="cloud"), r"why must be one of"),
    ],
)
def test_bad_calendar_rejected(export, mutate, match):
    _edit_cal(export, mutate)
    with pytest.raises(ValueError, match=match):
        validate_export(export)


def test_missing_uncertainty_rejected(export):
    _edit(export / "metrics.json", lambda d: d.pop("uncertainty"))
    with pytest.raises(ValueError, match="uncertainty is missing"):
        validate_export(export)


def test_non_finite_number_rejected(export):
    path = export / "metrics.json"
    path.write_text(path.read_text().replace('"mae_model":640.5', '"mae_model":NaN'))
    with pytest.raises(ValueError, match="non-finite"):
        validate_export(export)


def test_week_start_must_match_doy(export):
    _edit(export / "points" / "index.json", lambda d: d["2020"].update(week_start=[0] * 52))
    with pytest.raises(ValueError, match="does not match the doy block"):
        validate_export(export)


def test_truncated_bin_rejected(export):
    path = export / "points" / "2020.bin"
    path.write_bytes(path.read_bytes()[:-1])
    with pytest.raises(ValueError, match="2020.bin"):
        validate_export(export)


def test_decreasing_week_start_rejected(export):
    def mutate(d):
        d["2020"]["week_start"][10] = d["2020"]["week_start"][11] + 1

    _edit(export / "points" / "index.json", mutate)
    with pytest.raises(ValueError, match="week_start"):
        validate_export(export)


def test_orphan_bin_rejected(export):
    shutil.copy(export / "points" / "2020.bin", export / "points" / "2019.bin")
    with pytest.raises(ValueError, match="2019.bin"):
        validate_export(export)


def test_metrics_method_mismatch_rejected(export):
    _edit(export / "metrics.json", lambda d: d.update(method="baseline", accepted=False))
    with pytest.raises(ValueError, match="method"):
        validate_export(export)


def test_missing_calendar_rejected(export):
    (export / "calendar.json").unlink()
    with pytest.raises(ValueError, match="calendar.json"):
        validate_export(export)


def _cube_n(export, year="2020"):
    index = json.loads((export / "cube" / "index.json").read_text(encoding="utf-8"))
    return index["years"][year]["n"]


def test_truncated_cube_rejected(export):
    path = export / "cube" / "2020.bin"
    path.write_bytes(path.read_bytes()[:-1])
    with pytest.raises(ValueError, match=r"cube/2020.bin: size must be"):
        validate_export(export)


def test_cube_sum_must_match_calendar(export):
    path = export / "cube" / "2020.bin"
    raw = bytearray(path.read_bytes())
    n = _cube_n(export)
    raw[5 * n + 1] ^= 1  # high byte of the first viirs count: off by 256, never zero
    path.write_bytes(bytes(raw))
    with pytest.raises(ValueError, match="calendar has"):
        validate_export(export)


def test_orphan_cube_rejected(export):
    (export / "cube" / "1999.bin").write_bytes(b"")
    with pytest.raises(ValueError, match="not listed in cube/index.json"):
        validate_export(export)


def test_cube_grid_must_match_config(export):
    _edit(export / "cube" / "index.json", lambda d: d.update(nx=44))
    with pytest.raises(ValueError, match="nx, ny must equal 45, 70"):
        validate_export(export)


def test_bad_as_of_rejected(export):
    _edit(export / "calendar.json", lambda d: d["meta"].update(as_of="2026-11-05"))
    with pytest.raises(ValueError, match=r"meta\.as_of must be the end of the last non-gap week"):
        validate_export(export)


def test_meta_grid_must_match_config(export):
    _edit(export / "calendar.json", lambda d: d["meta"].update(nx=44))
    with pytest.raises(ValueError, match=r"meta\.nx, meta\.ny must equal 45, 70"):
        validate_export(export)


def test_light_export_is_valid(export):
    shutil.rmtree(export / "points")
    _edit(export / "metrics.json", lambda m: (m.pop("events"), m.pop("pairing")))
    validate_export(export, light=True)
    with pytest.raises(ValueError):
        validate_export(export)
