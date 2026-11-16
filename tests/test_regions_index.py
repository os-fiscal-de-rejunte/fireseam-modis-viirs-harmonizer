import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from mvh import regions, regions_index

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "data" / "sample"
FIXTURE = ROOT / "tests" / "fixtures" / "season_cases.json"


@pytest.fixture
def data_root(tmp_path):
    root = tmp_path / "export"
    shutil.copytree(SAMPLE / "export", root)
    return root


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _weeks(profile: dict, first=2001, last=2025):
    return [
        {"year": y, "week": w, "harmonized": profile.get(w, 0), "status": "observed"}
        for y in range(first, last + 1)
        for w in range(1, 53)
    ]


def test_rows_equal_the_metrics(data_root):
    rows = regions_index.build(data_root)
    ok = [r for r in rows if r["status"] == "ok"]
    assert [r["id"] for r in ok] == ["pantanal", "synthetic"]
    for r in ok:
        base = data_root if r["path"] == "." else data_root / r["path"]
        metrics = _load(base / "metrics.json")
        assert r["accepted"] == metrics["accepted"]
        assert r["method"] == metrics["method"]
        assert r["weekly_total"] == metrics["weekly_total"]
        assert r["terra_accepted"] == metrics["terra_only"]["accepted"]
        assert r["years_scored"] == metrics["weekly_total"]["years"]
        assert r["as_of"] == _load(base / "calendar.json")["meta"]["as_of"]


def test_unexported_region_is_no_data(data_root):
    rows = regions_index.build(data_root)
    assert [r["id"] for r in rows] == [*regions.REGIONS, "synthetic"]
    by_id = {r["id"]: r for r in rows}
    for rid in ("indonesia", "north_australia", "southern_africa", "iberia"):
        assert by_id[rid]["status"] == "no_data"
        assert by_id[rid]["has"] == []
        assert by_id[rid]["accepted"] is None
        assert by_id[rid]["path"] == f"regions/{rid}"


def test_has_lists_what_exists(data_root):
    by_id = {r["id"]: r for r in regions_index.build(data_root)}
    assert by_id["pantanal"]["path"] == "."
    assert by_id["pantanal"]["has"] == ["points", "events", "pairing", "forecast"]
    assert by_id["synthetic"]["has"] == []


def test_lying_has_is_rejected(data_root):
    regions_index.write(data_root)
    regions_index.validate(data_root)
    path = data_root / "regions.json"
    rows = _load(path)
    next(r for r in rows if r["id"] == "synthetic")["has"].append("points")
    path.write_text(json.dumps(rows), encoding="utf-8")
    with pytest.raises(ValueError, match="has lists 'points'"):
        regions_index.validate(data_root)


def test_three_acceptance_states():
    assert regions_index.acceptance_state(True, 14) == "accepted"
    assert regions_index.acceptance_state(False, 14) == "baseline"
    assert regions_index.acceptance_state(True, 13) == "not_validated"


def test_season_wraps():
    late = _weeks({49: 10, 50: 10, 51: 10, 52: 10})
    assert regions_index.critical_period(late) == (49, 52)
    assert regions_index.season_wraps(late) is True
    assert regions_index.season_wraps(_weeks({30: 10, 31: 10, 32: 10, 33: 10})) is False
    assert regions_index.season_wraps(_weeks({})) is False


_CASES = _load(FIXTURE)


@pytest.mark.parametrize("case", _CASES["cases"], ids=lambda c: c["name"])
def test_season_cases_fixture(case):
    first, last = _CASES["years"]
    weeks = _weeks({int(k): v for k, v in case["profile"].items()}, first, last)
    expected = tuple(case["critical"]) if case["critical"] else None
    assert regions_index.critical_period(weeks) == expected
    assert regions_index.season_wraps(weeks) is case["season_wraps"]


def test_fixture_has_both_outcomes():
    flags = {c["season_wraps"] for c in _CASES["cases"]}
    assert flags == {True, False}


def test_region_without_raw_folder_is_no_data(tmp_path):
    raw_base = tmp_path / "raw_base"
    raw_base.mkdir()
    out = tmp_path / "data"
    env = {k: v for k, v in os.environ.items() if k not in ("FIRMS_OUT_DIR", "MVH_REGION")} | {
        "FIRMS_OUT_DIR": str(raw_base),
        "PYTHONPATH": str(ROOT / "src"),
    }

    def run(*args):
        return subprocess.run(
            [sys.executable, "-m", "mvh.export", *args],
            env=env,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )

    first = run("--raw", str(SAMPLE / "raw"), "--out", str(out))
    assert first.returncode == 0, first.stderr
    assert (out / "regions.json").is_file()
    second = run("--region", "iberia", "--out", str(out))
    assert second.returncode != 0
    assert "raw folder is missing" in second.stderr
    by_id = {r["id"]: r for r in _load(out / "regions.json")}
    for rid in ("iberia", "indonesia", "north_australia", "southern_africa"):
        assert by_id[rid]["status"] == "no_data"
        assert by_id[rid]["has"] == []
    assert not (out / "regions" / "iberia").exists()
