#!/usr/bin/env python3
"""Confere que um ano baixado de novo não perdeu nenhuma data do backup.

Uso:
    python src/scripts/check_redownload.py --backup <pasta> [--raw <pasta>]

Só lê arquivos; não escreve e não chama o FIRMS. Saída: 0 nada faltando,
1 faltam datas (listadas em stderr), 2 falta um arquivo do backup ou do novo.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

PRODUCT_FILES = ("modis/2026.csv", "viirs_snpp/2026.csv")


def dates_in(path: Path) -> set[str]:
    """Valores distintos da coluna acq_date; arquivo vazio dá conjunto vazio."""
    with Path(path).open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            return set()
        if "acq_date" not in reader.fieldnames:
            raise ValueError(f"{path}: coluna acq_date ausente")
        return {row["acq_date"] for row in reader if row["acq_date"]}


def missing_dates(old: Path, new: Path) -> list[str]:
    return sorted(dates_in(old) - dates_in(new))


def _env_raw() -> str | None:
    if os.environ.get("FIRMS_OUT_DIR"):
        return os.environ["FIRMS_OUT_DIR"]
    env = Path(".env")
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            k, _, v = line.strip().partition("=")
            if k.strip() == "FIRMS_OUT_DIR":
                return v.strip().strip("'\"")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup", required=True, type=Path)
    ap.add_argument("--raw", type=Path, default=None)
    args = ap.parse_args()
    raw = args.raw or (Path(_env_raw()) if _env_raw() else None)
    if raw is None:
        print("Informe --raw ou defina FIRMS_OUT_DIR", file=sys.stderr)
        return 2
    pairs = [(args.backup / f, raw / f, f) for f in PRODUCT_FILES]
    absent = [str(p) for old, new, _ in pairs for p in (old, new) if not p.is_file()]
    if absent:
        print("Arquivo inexistente: " + ", ".join(absent), file=sys.stderr)
        return 2
    lost: dict[str, list[str]] = {}
    for old, new, name in pairs:
        gone = missing_dates(old, new)
        print(
            f"{name}: old {len(dates_in(old))} dates, new {len(dates_in(new))} dates, "
            f"missing {len(gone)}"
        )
        if gone:
            lost[name] = gone
    for name, gone in lost.items():
        print(f"{name}: datas perdidas: {', '.join(gone)}", file=sys.stderr)
    return 1 if lost else 0


if __name__ == "__main__":
    raise SystemExit(main())
