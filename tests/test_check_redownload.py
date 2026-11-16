import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "check_redownload", ROOT / "src/scripts/check_redownload.py"
)
cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cr)

OLD = ["2026-06-01", "2026-06-01", "2026-06-02", "2026-09-01"]


def write(path, dates):
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = ["latitude,longitude,acq_date"] + [f"-1,-2,{d}" for d in dates]
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return path


def test_missing_date_is_reported(tmp_path):
    old = write(tmp_path / "old.csv", OLD)
    new = write(tmp_path / "new.csv", ["2026-06-01", "2026-06-02", "2026-07-15"])
    assert cr.dates_in(old) == {"2026-06-01", "2026-06-02", "2026-09-01"}
    assert cr.missing_dates(old, new) == ["2026-09-01"]


def test_superset_passes(tmp_path):
    old = write(tmp_path / "old.csv", OLD)
    new = write(tmp_path / "new.csv", [*OLD, "2026-07-15"])
    assert cr.missing_dates(old, new) == []


def test_empty_file_gives_empty_set(tmp_path):
    p = tmp_path / "e.csv"
    p.write_text("")
    assert cr.dates_in(p) == set()


def test_file_without_acq_date_is_rejected(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_text("latitude,longitude\n1,2\n")
    with pytest.raises(ValueError, match="bad.csv"):
        cr.dates_in(p)


def _setup(tmp_path, new_modis):
    bak, raw = tmp_path / "backup", tmp_path / "raw"
    for name in ("modis", "viirs_snpp"):
        write(bak / name / "2026.csv", OLD)
        write(raw / name / "2026.csv", OLD)
    write(raw / "modis" / "2026.csv", new_modis)
    return bak, raw


def _run(monkeypatch, bak, raw):
    monkeypatch.setattr(sys, "argv", ["x", "--backup", str(bak), "--raw", str(raw)])
    return cr.main()


def test_main_exit_codes(tmp_path, monkeypatch, capsys):
    bak, raw = _setup(tmp_path, OLD)
    assert _run(monkeypatch, bak, raw) == 0
    out = capsys.readouterr().out
    assert "modis/2026.csv: old 3 dates, new 3 dates, missing 0" in out

    write(raw / "modis" / "2026.csv", ["2026-06-01", "2026-06-02"])
    assert _run(monkeypatch, bak, raw) == 1
    assert "2026-09-01" in capsys.readouterr().err

    (bak / "viirs_snpp" / "2026.csv").unlink()
    assert _run(monkeypatch, bak, raw) == 2
