"""Read-only audit of the raw FIRMS CSVs; writes a markdown data statement."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import pandas as pd

KEY = ["latitude", "longitude", "acq_date", "acq_time", "satellite"]
SENSOR_DIRS = {"modis": "modis", "viirs": "viirs_snpp"}
SAT_NAMES = {"N": "S-NPP"}


def parse_acq_time(acq_date: pd.Series, acq_time: pd.Series) -> pd.Series:
    """Combine `YYYY-MM-DD` and unpadded `HMM`/`HHMM` strings into naive UTC timestamps."""
    padded = acq_time.astype(str).str.strip().str.zfill(4)
    return pd.to_datetime(acq_date.astype(str) + " " + padded, format="%Y-%m-%d %H%M")


def load_raw(folder: Path) -> pd.DataFrame:
    """Read every CSV of a sensor folder as strings and add derived columns."""
    files = sorted(folder.glob("*.csv"))
    df = pd.concat([pd.read_csv(f, dtype=str, keep_default_na=False) for f in files])
    df = df.reset_index(drop=True)
    df["ts"] = parse_acq_time(df["acq_date"], df["acq_time"])
    df["year"] = df["ts"].dt.year
    df["month"] = df["ts"].dt.month
    df["sat"] = df["satellite"].replace(SAT_NAMES)
    df["night"] = df["daynight"] == "N"
    return df


def count_duplicates(df: pd.DataFrame) -> dict[str, int]:
    raw_cols = [c for c in df.columns if c not in {"ts", "year", "month", "sat", "night"}]
    return {
        "exact": int(df.duplicated(subset=raw_cols).sum()),
        "by_key": int(df.duplicated(subset=KEY).sum()),
    }


def rows_by_year(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return pd.DataFrame({s: df.groupby("year").size() for s, df in frames.items()}).fillna(0)


def rows_by_month(frames: dict[str, pd.DataFrame], year: int) -> pd.DataFrame:
    return pd.DataFrame(
        {s: df[df["year"] == year].groupby("month").size() for s, df in frames.items()}
    ).fillna(0)


def date_range_by_version(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("version")["ts"]
    out = pd.DataFrame({"first": g.min().dt.date, "last": g.max().dt.date, "rows": g.size()})
    return out.sort_values("first")


def type_table(df: pd.DataFrame) -> pd.DataFrame:
    num = pd.to_numeric(df["type"], errors="coerce")
    label = num.astype("Int64").astype(str).replace("<NA>", "nrt/empty")
    return pd.crosstab(df["year"], label)


def find_outages(df: pd.DataFrame, min_days: int = 5) -> pd.DataFrame:
    """Runs of >= `min_days` empty days in Jun 1..Oct 31, inside the satellite's own span."""
    rows = []
    days = df["ts"].dt.normalize()
    present = set(days.unique())
    first, last = days.min(), days.max()
    for year in range(first.year, last.year + 1):
        window = pd.date_range(
            max(pd.Timestamp(year, 6, 1), first), min(pd.Timestamp(year, 10, 31), last)
        )
        run: list[pd.Timestamp] = []
        for d in [*window, None]:
            if d is not None and d not in present:
                run.append(d)
                continue
            if len(run) >= min_days:
                rows.append({"start": run[0], "end": run[-1], "days": len(run)})
            run = []
    return pd.DataFrame(rows, columns=["start", "end", "days"])


def frp_stats(frp: pd.Series) -> dict[str, float | int]:
    num = pd.to_numeric(frp, errors="coerce")
    return {
        "empty": int(num.isna().sum()),
        "negative": int((num < 0).sum()),
        "min": float(num.min()),
        "max": float(num.max()),
    }


def bbox_observed(df: pd.DataFrame) -> dict[str, float]:
    lat = pd.to_numeric(df["latitude"])
    lon = pd.to_numeric(df["longitude"])
    return {
        "lat_min": float(lat.min()),
        "lat_max": float(lat.max()),
        "lon_min": float(lon.min()),
        "lon_max": float(lon.max()),
    }


def _median_minutes(df: pd.DataFrame) -> pd.Series:
    minutes = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    keys = [df["ts"].dt.normalize().rename("date"), df["night"]]
    return minutes.groupby(keys).median()


def overpass_lag(aqua: pd.DataFrame, snpp: pd.DataFrame) -> pd.DataFrame:
    """Per year p50/p90 of |median Aqua - median S-NPP| minutes per (UTC date, day/night)."""
    lag = (_median_minutes(aqua) - _median_minutes(snpp)).dropna().abs()
    years = lag.index.get_level_values("date").year
    g = lag.groupby(years)
    return pd.DataFrame({"p50": g.quantile(0.5), "p90": g.quantile(0.9), "dates": g.size()})


def ratio_by_year(frames: dict[str, pd.DataFrame], start: int = 2012) -> pd.Series:
    counts = rows_by_year(frames)
    counts = counts[counts.index >= start]
    return (counts["viirs"] / counts["modis"]).round(2)


def md_table(df: pd.DataFrame, index_name: str = "") -> str:
    head = [index_name or (df.index.name or ""), *map(str, df.columns)]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for idx, row in df.iterrows():
        cells = [str(idx), *(_fmt(v) for v in row)]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def _fmt(v: object) -> str:
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else f"{v:.2f}".rstrip("0").rstrip(".")
    return str(v)


def build_report(frames: dict[str, pd.DataFrame]) -> str:
    out = ["# Raw data audit", ""]

    def section(title: str, caption: str, body: str) -> None:
        out.extend([f"## {title}", "", caption, "", body, ""])

    section(
        "1. Rows per sensor and year",
        "Detections per file year.",
        md_table(rows_by_year(frames).astype(int), "year"),
    )
    for year in (2025, 2026):
        section(
            f"1b. Rows per month, {year}",
            f"Detections per month in {year}.",
            md_table(rows_by_month(frames, year).astype(int), "month"),
        )

    dups = pd.DataFrame({s: count_duplicates(df) for s, df in frames.items()}).T
    section(
        "2. Duplicates",
        "Exact duplicate rows and duplicates on (lat, lon, date, time, satellite).",
        md_table(dups, "sensor"),
    )

    for s, df in frames.items():
        section(
            f"3. Date range by version, {s}",
            "First and last acquisition date per product version.",
            md_table(date_range_by_version(df), "version"),
        )

    for s, df in frames.items():
        section(
            f"4. Year x type, {s}",
            "Rows per `type` value (empty shown as nrt/empty).",
            md_table(type_table(df), "year"),
        )

    outages = []
    for df in frames.values():
        for sat, sub in df.groupby("sat"):
            for _, r in find_outages(sub).iterrows():
                outages.append(
                    {
                        "satellite": sat,
                        "start": r["start"].date(),
                        "end": r["end"].date(),
                        "days": r["days"],
                    }
                )
    odf = pd.DataFrame(outages, columns=["satellite", "start", "end", "days"])
    section(
        "5. Outages",
        "Runs of >= 5 days with no detections between Jun 1 and Oct 31.",
        md_table(odf.set_index("satellite"), "satellite"),
    )

    frp = pd.DataFrame({s: frp_stats(df["frp"]) for s, df in frames.items()}).T
    section("6. FRP", "Empty and negative values, min and max.", md_table(frp, "sensor"))

    box = pd.DataFrame({s: bbox_observed(df) for s, df in frames.items()}).T
    section(
        "7. Observed bounding box", "Min and max coordinates per sensor.", md_table(box, "sensor")
    )

    modis, viirs = frames["modis"], frames["viirs"]
    lag = overpass_lag(modis[(modis["sat"] == "Aqua") & (modis["year"] >= 2012)], viirs)
    section(
        "8. Aqua x S-NPP overpass lag",
        "Minutes between median Aqua and median S-NPP times per UTC date and day/night flag.",
        md_table(lag, "year"),
    )

    section(
        "9. VIIRS / MODIS raw count ratio",
        "Annual ratio of raw detection counts.",
        md_table(ratio_by_year(frames).to_frame("ratio"), "year"),
    )
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit the raw FIRMS CSVs.")
    parser.add_argument("--raw", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=Path("docs/data-audit.md"))
    args = parser.parse_args()
    raw = args.raw or Path(os.environ["FIRMS_OUT_DIR"])
    frames = {s: load_raw(raw / d) for s, d in SENSOR_DIRS.items()}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(build_report(frames) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
