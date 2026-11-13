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
    (out / "cube" / "1999.bin").write_bytes(b"x" * 7)
    keep = out / "forecast.json"
    keep.write_text("{}", encoding="utf-8")
    export_all(SAMPLE, out)
    second = _hashes(out)
    assert not (out / "points" / "1999.bin").exists()
    assert not (out / "cube" / "1999.bin").exists()
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


def _read_cube(path: Path) -> dict[str, np.ndarray]:
    raw = path.read_bytes()
    n = len(raw) // 7
    return {
        "cell": np.frombuffer(raw, "<u2", n, 0),
        "week": np.frombuffer(raw, "u1", n, 2 * n),
        "modis": np.frombuffer(raw, "<u2", n, 3 * n),
        "viirs": np.frombuffer(raw, "<u2", n, 5 * n),
    }


def test_cube_2020_matches_the_detections(exported):
    from mvh.grid import cell_index

    index = json.loads((exported / "cube" / "index.json").read_text(encoding="utf-8"))
    assert (index["nx"], index["ny"]) == (config.NX, config.NY)
    assert sorted(index["years"]) == ["2011", "2020"]
    cube = _read_cube(exported / "cube" / "2020.bin")
    assert len(cube["cell"]) == index["years"]["2020"]["n"]
    for sensor, col in (("modis", "modis"), ("viirs", "viirs")):
        df = load_firms(sensor, SAMPLE)
        df = df[df["year"] == 2020]
        cx, cy = cell_index(df["lon"].to_numpy(), df["lat"].to_numpy())
        want: dict[tuple[int, int], int] = {}
        cells = (cy.astype(int) * config.NX + cx).tolist()
        for c, w in zip(cells, df["week"].tolist(), strict=True):
            want[(c, int(w))] = want.get((c, int(w)), 0) + 1
        got = {
            (int(c), int(w)): int(v)
            for c, w, v in zip(cube["cell"], cube["week"], cube[col], strict=True)
            if v
        }
        assert got == want
    order = cube["week"].astype(np.int64) * 65536 + cube["cell"]
    assert np.all(np.diff(order) > 0)
    assert np.all(cube["modis"].astype(int) + cube["viirs"] > 0)


def test_cube_count_above_uint16_fails():
    import pandas as pd

    from mvh.export import _cube_blocks

    cube = pd.DataFrame(
        {"year": [2020], "week": [1], "cx": [0], "cy": [0],
         "n_terra": [40000], "n_aqua": [30000], "n_viirs": [0]}
    )  # fmt: skip
    with pytest.raises(ValueError, match="65535"):
        _cube_blocks(cube)


def test_band_only_on_estimated_weeks(exported):
    cal = json.loads((exported / "calendar.json").read_text(encoding="utf-8"))
    unc = json.loads((exported / "metrics.json").read_text(encoding="utf-8"))["uncertainty"]
    seen = set()
    for w in cal["weeks"]:
        if w["status"] != "estimated":
            assert w["lo"] is None and w["hi"] is None
            continue
        mode = "full" if config.sat_covers("Aqua", w["year"], w["week"]) else "terra"
        seen.add(mode)
        assert w["lo"] == round(w["pred"] * unc[mode]["q10"], 1)
        assert w["hi"] == round(w["pred"] * unc[mode]["q90"], 1)
    assert seen == {"full", "terra"}
