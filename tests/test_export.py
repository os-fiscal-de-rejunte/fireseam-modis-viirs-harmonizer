import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from mvh import config
from mvh.export import export_all
from mvh.ingest import load_firms
from mvh.schema import validate_export

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "sample" / "raw"


def _hashes(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _read_bin(path: Path) -> dict[str, np.ndarray]:
    raw = path.read_bytes()
    n = len(raw) // 8
    return {
        "lon": np.frombuffer(raw, "<u2", n, 0),
        "lat": np.frombuffer(raw, "<u2", n, 2 * n),
        "doy": np.frombuffer(raw, "<u2", n, 4 * n),
        "flags": np.frombuffer(raw, "u1", n, 6 * n),
        "frp": np.frombuffer(raw, "u1", n, 7 * n),
    }


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    out = tmp_path_factory.mktemp("export")
    export_all(SAMPLE, out)
    return out


def test_sample_export_is_valid(exported):
    validate_export(exported)


def test_only_years_with_detections_get_a_bin(exported):
    index = json.loads((exported / "points" / "index.json").read_text(encoding="utf-8"))
    assert set(index) == {"2011", "2020"}
    assert not (exported / "points" / "2015.bin").exists()
    assert (exported / "points" / "2020.bin").is_file()


def test_2020_bin_decodes_to_the_detections(exported):
    modis = load_firms("modis", SAMPLE)
    viirs = load_firms("viirs", SAMPLE)
    m, v = modis[modis["year"] == 2020], viirs[viirs["year"] == 2020]
    pts = _read_bin(exported / "points" / "2020.bin")
    assert len(pts["doy"]) == len(m) + len(v)
    lon = np.sort(pts["lon"] / 1000.0 - 58.5)
    lat = np.sort(pts["lat"] / 1000.0 - 22.5)
    want_lon = np.sort(np.concatenate([m["lon"], v["lon"]]))
    want_lat = np.sort(np.concatenate([m["lat"], v["lat"]]))
    assert np.abs(lon - want_lon).max() < 0.001
    assert np.abs(lat - want_lat).max() < 0.001
    flags = pts["flags"]
    assert int((flags & 1).sum()) == len(v)
    assert int(((flags >> 2) & 1).sum()) == int(m["night"].sum() + v["night"].sum())
    assert int(((flags >> 3) & 1).sum()) == int((m["sat"] == "Terra").sum())
    assert int((((flags >> 1) & 1)[(flags & 1) == 1]).sum()) >= 1


def test_week_start_slices_hold_one_week_each(exported):
    index = json.loads((exported / "points" / "index.json").read_text(encoding="utf-8"))
    doy = _read_bin(exported / "points" / "2020.bin")["doy"].astype(int)
    week = np.minimum((doy - 1) // 7 + 1, config.WEEKS_PER_YEAR)
    ws = index["2020"]["week_start"] + [index["2020"]["n"]]
    assert len(ws) == 53
    for w in range(1, 53):
        assert np.all(week[ws[w - 1] : ws[w]] == w)


def test_second_run_is_byte_identical_and_removes_stale_files(exported, tmp_path):
    out = tmp_path / "again"
    export_all(SAMPLE, out)
    first = _hashes(out)
    (out / "points" / "1999.bin").write_bytes(b"x" * 8)
    keep = out / "forecast.json"
    keep.write_text("{}", encoding="utf-8")
    export_all(SAMPLE, out)
    second = _hashes(out)
    assert not (out / "points" / "1999.bin").exists()
    assert keep.is_file()
    assert {k: v for k, v in second.items() if k != "forecast.json"} == first
    assert first == {k: v for k, v in _hashes(exported).items()}


def test_week_status(exported):
    cal = json.loads((exported / "calendar.json").read_text(encoding="utf-8"))
    by = {(w["year"], w["week"]): w for w in cal["weeks"]}
    early = by[(2005, 10)]
    assert early["status"] == "estimated"
    assert early["pred"] is not None
    assert by[(2026, 28)]["status"] == "gap"
