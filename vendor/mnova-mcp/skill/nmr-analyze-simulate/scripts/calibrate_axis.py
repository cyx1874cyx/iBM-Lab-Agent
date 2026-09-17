#!/usr/bin/env python3
"""Fit a processed NMR point-index to reference-ppm linear calibration."""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pairs", type=Path, help="CSV containing point_index and reference_ppm")
    parser.add_argument("--output", type=Path, help="Write the JSON result to this path")
    parser.add_argument("--max-rms-ppm", type=float, help="Return failure when RMS residual exceeds this limit")
    return parser.parse_args()


def read_pairs(path: Path) -> list[tuple[float, float]]:
    aliases = {
        "point_index": ("point_index", "index", "point", "pixel_index"),
        "reference_ppm": ("reference_ppm", "ppm", "mnova_ppm", "observed_ppm"),
    }
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        names = set(reader.fieldnames or [])
        columns = {}
        for canonical, choices in aliases.items():
            columns[canonical] = next((name for name in choices if name in names), None)
            if columns[canonical] is None:
                raise ValueError(f"Missing {canonical} column; accepted names: {', '.join(choices)}")
        values = [(float(row[columns["point_index"]]), float(row[columns["reference_ppm"]])) for row in reader]
    if len(values) < 3:
        raise ValueError("At least three matched peaks are required for cross-calibration")
    if len({x for x, _ in values}) < 2:
        raise ValueError("Matched peaks must contain at least two distinct point indices")
    if not all(math.isfinite(x) and math.isfinite(y) for x, y in values):
        raise ValueError("Calibration pairs must be finite numbers")
    return values


def fit(values: list[tuple[float, float]]) -> dict:
    x_mean = sum(x for x, _ in values) / len(values)
    y_mean = sum(y for _, y in values) / len(values)
    denominator = sum((x - x_mean) ** 2 for x, _ in values)
    slope = sum((x - x_mean) * (y - y_mean) for x, y in values) / denominator
    intercept = y_mean - slope * x_mean
    rows = []
    squared = 0.0
    for point_index, reference_ppm in values:
        fitted = intercept + slope * point_index
        residual = reference_ppm - fitted
        squared += residual ** 2
        rows.append({"point_index": point_index, "reference_ppm": reference_ppm,
                     "fitted_ppm": fitted, "residual_ppm": residual})
    rms = math.sqrt(squared / len(values))
    return {
        "model": "ppm = intercept_ppm + slope_ppm_per_point * point_index",
        "pair_count": len(values),
        "slope_ppm_per_point": slope,
        "intercept_ppm": intercept,
        "rms_residual_ppm": rms,
        "max_abs_residual_ppm": max(abs(row["residual_ppm"]) for row in rows),
        "direction": "decreasing" if slope < 0 else "increasing",
        "pairs": rows,
        "scope": "dataset-and-processing-specific; do not reuse as a vendor-wide constant",
    }


def main() -> int:
    args = parse_args()
    result = fit(read_pairs(args.pairs))
    result["ok"] = args.max_rms_ppm is None or result["rms_residual_ppm"] <= args.max_rms_ppm
    if not result["ok"]:
        result["error"] = f"RMS residual exceeds {args.max_rms_ppm:g} ppm"
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        raise SystemExit(2)
