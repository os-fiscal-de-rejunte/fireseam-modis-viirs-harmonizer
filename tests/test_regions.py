import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from mvh import config, regions

CELLS = {
    "pantanal": (45, 70),
    "indonesia": (160, 70),
    "north_australia": (160, 70),
    "southern_africa": (160, 70),
    "iberia": (130, 70),
}


def test_registry_holds_the_five_regions():
    assert list(regions.REGIONS) == list(CELLS)
    for rid, size in CELLS.items():
        assert regions.grid_size(regions.REGIONS[rid]) == size
        assert size[0] * size[1] <= regions.BUDGET_CELLS
    assert regions.REGIONS["indonesia"].bbox == (100.0, -4.0, 116.0, 3.0)
    assert regions.REGIONS["north_australia"].bbox == (122.0, -18.0, 138.0, -11.0)
    assert regions.REGIONS["southern_africa"].bbox == (14.0, -17.0, 30.0, -10.0)
    assert regions.REGIONS["iberia"].bbox == (-10.0, 36.0, 3.0, 43.0)


def test_box_off_the_grid_is_rejected():
    bad = regions.Region("bad", "Bad", (10.0, 0.0, 12.05, 1.0), "regions/bad", True)
    with pytest.raises(ValueError, match=r"region 'bad': bbox edge lon_max=12.05"):
        regions.grid_size(bad)


def test_grid_above_the_cube_limit_is_rejected():
    big = regions.Region("big", "Big", (0.0, 0.0, 30.0, 30.0), "regions/big", True)
    with pytest.raises(ValueError, match="90000 cells is above the 65536 limit"):
        regions.grid_size(big)


def test_pantanal_is_the_default_and_unchanged():
    assert (config.REGION_ID, config.BBOX, config.NX, config.NY) == (
        "pantanal",
        (-58.5, -22.5, -54.0, -15.5),
        45,
        70,
    )
    nrt = {"modis": date(2026, 9, 1), "viirs": date(2026, 8, 1)}
    assert dict(config.NRT_START) == nrt
    assert regions.REGIONS["pantanal"].raw == ""
    assert not regions.REGIONS["pantanal"].light
    assert all(r.light for rid, r in regions.REGIONS.items() if rid != "pantanal")


def test_region_is_fixed_at_import(tmp_path):
    code = (
        "from mvh import config; print(config.REGION_ID, config.NX, config.NY, config.raw_root())"
    )
    src = str(Path(__file__).resolve().parents[1] / "src")
    env = {
        **os.environ,
        "MVH_REGION": "iberia",
        "FIRMS_OUT_DIR": str(tmp_path),
        "PYTHONPATH": src + os.pathsep + os.environ.get("PYTHONPATH", ""),
    }
    out = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    assert out.stdout.split()[:3] == ["iberia", "130", "70"]
    assert Path(out.stdout.split(maxsplit=3)[3].strip()) == tmp_path / "regions" / "iberia"


def test_region_from_argv():
    assert regions.region_from_argv(["--out", "x", "--region", "iberia"]) == "iberia"
    assert regions.region_from_argv(["--region=iberia"]) == "iberia"
    assert regions.region_from_argv([]) is None


def test_unknown_region():
    with pytest.raises(ValueError, match="pantanal"):
        regions.get("mars")
    assert regions.get("synthetic") is regions.SYNTHETIC


def test_read_coverage(tmp_path):
    (tmp_path / "coverage.json").write_text(
        json.dumps(
            {
                "modis": {
                    "intervals": [["2001-01-01", "2010-12-31"], ["2012-01-01", "2020-06-30"]],
                    "nrt_start": "2020-05-01",
                },
                "viirs": {"intervals": [["2012-01-20", "2020-06-30"]], "nrt_start": None},
            }
        )
    )
    cov, nrt = regions.read_coverage(tmp_path)
    assert cov["modis"] == [
        (date(2001, 1, 1), date(2010, 12, 31)),
        (date(2012, 1, 1), date(2020, 6, 30)),
    ]
    assert cov["viirs"] == [(date(2012, 1, 20), date(2020, 6, 30))]
    assert nrt == {"modis": date(2020, 5, 1), "viirs": date.max}
    cov, nrt = regions.read_coverage(tmp_path / "missing")
    assert cov == {"modis": [], "viirs": []}
    assert nrt == {"modis": date.max, "viirs": date.max}
