import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from mvh import config, export

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "data" / "sample" / "raw"
_spec = importlib.util.spec_from_file_location(
    "make_synthetic_region", ROOT / "src/scripts/make_synthetic_region.py"
)
msr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(msr)


def _run(args: list[str], raw_base: Path):
    env = {k: v for k, v in os.environ.items() if k not in ("FIRMS_OUT_DIR", "MVH_REGION")} | {
        "FIRMS_OUT_DIR": str(raw_base),
        "PYTHONPATH": str(ROOT / "src"),
    }
    return subprocess.run(
        [sys.executable, "-m", "mvh.export", *args],
        env=env,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("synthetic")
    msr.make(SAMPLE, tmp / "raw" / "regions" / "synthetic")
    done = _run(["--region", "synthetic", "--out", str(tmp / "data")], tmp / "raw")
    return tmp / "data" / "regions" / "synthetic", done


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_region_flag_reaches_config(synthetic):
    out, done = synthetic
    assert done.returncode == 0, done.stderr
    meta = _load(out / "calendar.json")["meta"]
    assert meta["region"] == "synthetic"
    assert meta["bbox"] == [20.0, -10.0, 23.0, -3.0]
    assert (meta["nx"], meta["ny"]) == (30, 70)
    index = _load(out / "cube" / "index.json")
    assert (index["nx"], index["ny"]) == (30, 70)


def test_light_export_has_no_points(synthetic):
    out, _ = synthetic
    assert not (out / "points").exists()
    metrics = _load(out / "metrics.json")
    assert "events" not in metrics
    assert "pairing" not in metrics
    assert "uncertainty" in metrics


def test_cells_stay_inside_the_grid(synthetic):
    out, _ = synthetic
    index = _load(out / "cube" / "index.json")
    total = 0
    for year, entry in index["years"].items():
        n = entry["n"]
        cell = np.fromfile(out / "cube" / f"{year}.bin", dtype="<u2", count=n)
        assert (cell < 2100).all()
        total += n
    assert total > 0


def test_pantanal_run_in_the_same_tree_is_untouched(synthetic):
    assert config.REGION_ID == "pantanal"


def test_missing_raw_folder_fails_and_writes_nothing(tmp_path):
    empty = tmp_path / "raw"
    empty.mkdir()
    done = _run(["--region", "iberia", "--out", str(tmp_path / "data")], empty)
    assert done.returncode != 0
    assert "raw folder is missing" in done.stderr
    assert not (tmp_path / "data" / "regions" / "iberia").exists()


def _hashes(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_failed_export_leaves_the_previous_files(tmp_path, monkeypatch):
    argv = ["export", "--raw", str(SAMPLE), "--out", str(tmp_path)]
    monkeypatch.setattr(sys, "argv", argv)
    export.main()
    before = _hashes(tmp_path)
    assert before

    def boom(*_a, **_k):
        raise ValueError("boom")

    monkeypatch.setattr(export, "validate_export", boom)
    with pytest.raises(ValueError, match="boom"):
        export.main()
    assert _hashes(tmp_path) == before
    assert not (tmp_path / ".stage-pantanal").exists()


def test_raw_with_another_region_is_refused(tmp_path):
    done = _run(["--region", "synthetic", "--raw", "x"], tmp_path)
    assert done.returncode != 0
    assert "use FIRMS_OUT_DIR" in done.stderr
