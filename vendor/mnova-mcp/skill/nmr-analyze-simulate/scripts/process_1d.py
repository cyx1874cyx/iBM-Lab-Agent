#!/usr/bin/env python3
"""Process a 1D Varian/Agilent or Bruker NMR FID without modifying the input."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Vendor dataset directory or its fid file")
    parser.add_argument("--output", type=Path, required=True, help="New output directory")
    parser.add_argument("--vendor", choices=("auto", "varian", "bruker"), default="auto")
    parser.add_argument("--lb-hz", type=float, default=0.3, help="Exponential broadening in Hz")
    parser.add_argument("--zero-fill", type=int, help="Final complex points; default >=4x next power of two")
    parser.add_argument("--phase", choices=("auto", "none", "manual"), default="auto")
    parser.add_argument("--p0", type=float, default=0.0, help="Manual zero-order phase, degrees")
    parser.add_argument("--p1", type=float, default=0.0, help="Manual first-order phase, degrees")
    parser.add_argument("--reference-ppm", type=float, help="Chemical shift assigned to picked reference")
    parser.add_argument(
        "--reference-window", type=float, nargs=2, metavar=("LOW", "HIGH"),
        help="Search window on the initial ppm axis",
    )
    parser.add_argument("--peak-snr", type=float, default=8.0)
    parser.add_argument(
        "--noise-window", type=float, nargs=2, metavar=("LOW", "HIGH"),
        help="Known signal-free ppm range; otherwise use quiet distributed blocks",
    )
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args()


def numeric_procpar(procpar: dict[str, Any], name: str, default: float | None = None) -> float:
    try:
        return float(procpar[name]["values"][0])
    except (KeyError, IndexError, TypeError, ValueError):
        if default is None:
            raise ValueError(f"Missing numeric Varian procpar field: {name}")
        return default


def string_procpar(procpar: dict[str, Any], name: str, default: str = "unknown") -> str:
    try:
        return str(procpar[name]["values"][0])
    except (KeyError, IndexError, TypeError):
        return default


def bruker_value(dic: dict[str, Any], name: str, default: float | None = None) -> float:
    try:
        return float(dic["acqus"][name])
    except (KeyError, TypeError, ValueError):
        if default is None:
            raise ValueError(f"Missing Bruker acqus field: {name}")
        return default


def detect_vendor(path: Path, requested: str) -> tuple[str, Path]:
    root = path.resolve().parent if path.is_file() else path.resolve()
    if requested != "auto":
        return requested, root
    if (root / "procpar").exists() and (root / "fid").exists():
        return "varian", root
    if (root / "acqus").exists() and ((root / "fid").exists() or (root / "ser").exists()):
        return "bruker", root
    raise ValueError("Could not detect vendor: expected fid+procpar or fid/ser+acqus")


def prepare_output(path: Path, overwrite: bool) -> Path:
    import shutil

    target = path.expanduser().resolve()
    if target.exists():
        if not overwrite:
            raise FileExistsError(f"Output exists; choose a new path or pass --overwrite: {target}")
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    target.mkdir(parents=True)
    return target


def robust_baseline(y: np.ndarray, order: int = 1, iterations: int = 6) -> np.ndarray:
    x = np.linspace(-1.0, 1.0, len(y))
    keep = np.ones(len(y), dtype=bool)
    baseline = np.zeros_like(y, dtype=float)
    for _ in range(iterations):
        coeff = np.polyfit(x[keep], y[keep], order)
        baseline = np.polyval(coeff, x)
        residual = y - baseline
        center = np.median(residual[keep])
        sigma = 1.4826 * np.median(np.abs(residual[keep] - center))
        if not np.isfinite(sigma) or sigma <= 0:
            break
        keep = np.abs(residual - center) < 3.0 * sigma
        if keep.sum() < max(order + 2, len(y) // 20):
            break
    return baseline


def mad_noise(y: np.ndarray) -> float:
    center = float(np.median(y))
    return float(1.4826 * np.median(np.abs(y - center)))


def quiet_block_noise(y: np.ndarray, blocks: int = 64) -> tuple[float, dict[str, Any]]:
    edge = max(1, len(y) // 50)
    core = y[edge:-edge] if len(y) > 2 * edge else y
    chunks = [chunk for chunk in np.array_split(core, min(blocks, len(core))) if len(chunk) >= 16]
    estimates = np.asarray([mad_noise(chunk) for chunk in chunks], dtype=float)
    valid = estimates[np.isfinite(estimates) & (estimates > 0)]
    if len(valid) == 0:
        return float(np.std(core)), {"method": "global_standard_deviation_fallback"}
    selected_count = max(3, len(valid) // 4)
    selected = np.sort(valid)[:selected_count]
    return float(np.median(selected)), {
        "method": "median_of_quietest_block_MADs",
        "block_count": len(chunks),
        "selected_block_count": selected_count,
        "edge_points_excluded_each_side": edge,
    }


def main() -> int:
    args = parse_args()
    if args.lb_hz < 0 or args.peak_snr <= 0:
        raise ValueError("--lb-hz must be nonnegative and --peak-snr must be positive")
    try:
        import nmrglue as ng
    except ImportError as exc:
        raise RuntimeError("Processing requires the missing package 'nmrglue'") from exc
    try:
        from scipy.signal import find_peaks
    except ImportError as exc:
        raise RuntimeError("Processing requires the missing package 'scipy'") from exc

    vendor, dataset = detect_vendor(args.input, args.vendor)
    if vendor == "varian":
        dic, fid = ng.varian.read(str(dataset))
        procpar = dic["procpar"]
        sw_hz = numeric_procpar(procpar, "sw")
        obs_mhz = numeric_procpar(procpar, "sfrq")
        delays = np.ravel(dic.get("acqus", {}).get("D", [np.nan]))
        d1_s = float(delays[1] if len(delays) > 1 else delays[0])
        acquisition = {
            "nucleus": string_procpar(procpar, "tn"),
            "solvent": string_procpar(procpar, "solvent"),
            "scans": int(numeric_procpar(procpar, "nt", 1)),
            "acquisition_time_s": numeric_procpar(procpar, "at", len(fid) / sw_hz),
            "relaxation_delay_s": numeric_procpar(procpar, "d1", float("nan")),
        }
    else:
        dic, fid = ng.bruker.read(str(dataset))
        fid = ng.bruker.remove_digital_filter(dic, fid)
        sw_hz = bruker_value(dic, "SW_h")
        obs_mhz = bruker_value(dic, "SFO1")
        acquisition = {
            "nucleus": str(dic.get("acqus", {}).get("NUC1", "unknown")),
            "solvent": str(dic.get("acqus", {}).get("SOLVENT", "unknown")),
            "scans": int(bruker_value(dic, "NS", 1)),
            "acquisition_time_s": len(fid) / sw_hz,
            "relaxation_delay_s": d1_s,
        }
    fid = np.asarray(fid).squeeze()
    if fid.ndim != 1 or not np.iscomplexobj(fid):
        raise ValueError(f"Only a single 1D complex FID is supported; got shape {fid.shape}")
    if not np.all(np.isfinite(fid)):
        raise ValueError("Input FID contains non-finite values")

    final_points = args.zero_fill or 2 ** math.ceil(math.log2(len(fid) * 4))
    if final_points < len(fid):
        raise ValueError("--zero-fill must be at least the FID length")
    spectrum = ng.proc_base.em(fid, lb=args.lb_hz / sw_hz)
    spectrum = ng.proc_base.zf_size(spectrum, final_points)
    spectrum = ng.proc_base.fft(spectrum)
    if args.phase == "auto":
        spectrum = ng.proc_autophase.autops(spectrum, "acme", disp=False)
    elif args.phase == "manual":
        spectrum = ng.proc_base.ps(spectrum, p0=args.p0, p1=args.p1)

    if vendor == "varian":
        rfl_hz = numeric_procpar(procpar, "rfl", sw_hz / 2.0)
        rfp_hz = numeric_procpar(procpar, "rfp", 0.0)
        ppm = (
            sw_hz - np.arange(final_points, dtype=float) * sw_hz / final_points
            - rfl_hz + rfp_hz
        ) / obs_mhz
    else:
        udic = ng.bruker.guess_udic(dic, spectrum)
        ppm = np.asarray(ng.fileiobase.uc_from_udic(udic).ppm_scale(), dtype=float)
    real = np.real(spectrum).astype(float)
    imag = np.imag(spectrum).astype(float)
    reference = None
    if args.reference_ppm is not None:
        if args.reference_window is None:
            raise ValueError("--reference-ppm requires --reference-window")
        low, high = sorted(args.reference_window)
        mask = (ppm >= low) & (ppm <= high)
        if not np.any(mask):
            raise ValueError("Reference window does not overlap the initial ppm axis")
        candidates = np.flatnonzero(mask)
        picked = int(candidates[np.argmax(real[candidates])])
        original = float(ppm[picked])
        ppm = ppm + (args.reference_ppm - original)
        reference = {
            "assigned_ppm": args.reference_ppm,
            "initial_picked_ppm": original,
            "point_index": picked,
            "window_initial_ppm": [low, high],
        }

    baseline = robust_baseline(real, order=1)
    corrected = real - baseline
    if args.noise_window is not None:
        low, high = sorted(args.noise_window)
        noise_mask = (ppm >= low) & (ppm <= high)
        if np.count_nonzero(noise_mask) < 16:
            raise ValueError("--noise-window must contain at least 16 processed points")
        noise = mad_noise(corrected[noise_mask])
        noise_details = {"method": "user_supplied_ppm_window_MAD", "ppm_window": [low, high]}
    else:
        noise, noise_details = quiet_block_noise(corrected)
    if not np.isfinite(noise) or noise <= 0:
        noise = float(np.std(corrected))
        noise_details = {"method": "global_standard_deviation_fallback"}
    peaks, properties = find_peaks(
        corrected, prominence=noise * args.peak_snr, distance=max(2, final_points // 32768)
    )
    order = np.argsort(properties["prominences"])[::-1]

    out = prepare_output(args.output, args.overwrite)
    np.savetxt(
        out / "processed_spectrum.csv",
        np.column_stack([ppm, real, imag, baseline, corrected]), delimiter=",",
        header="ppm,real_intensity,imag_intensity,baseline,baseline_corrected", comments="",
    )
    with (out / "peak_list.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["rank", "ppm", "height", "prominence", "estimated_snr"])
        for rank, pos in enumerate(order, start=1):
            idx = int(peaks[pos])
            writer.writerow([
                rank, f"{ppm[idx]:.6f}", f"{corrected[idx]:.9g}",
                f"{properties['prominences'][pos]:.9g}", f"{corrected[idx] / noise:.4f}",
            ])

    for key, value in acquisition.items():
        if isinstance(value, float) and not math.isfinite(value):
            acquisition[key] = None
    metadata = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "input_dataset": str(dataset), "vendor": vendor, "input_points": len(fid),
        "processed_points": final_points, "spectral_width_hz": sw_hz,
        "observation_frequency_mhz": obs_mhz, "line_broadening_hz": args.lb_hz,
        "phase_mode": args.phase, "manual_p0_deg": args.p0 if args.phase == "manual" else None,
        "manual_p1_deg": args.p1 if args.phase == "manual" else None,
        "reference": reference, "baseline": "iterative first-order polynomial",
        "noise_mad": noise, "noise_estimation": noise_details,
        "peak_threshold_snr": args.peak_snr,
        "peak_count": len(peaks), "acquisition": acquisition,
        "warning": "Peak detection is not chemical assignment; inspect phase, baseline, overlap, and artifacts.",
    }
    (out / "processing_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )

    try:
        import matplotlib.pyplot as plt
    except ImportError:
        plt = None
    if plt is not None:
        fig, axes = plt.subplots(2, 1, figsize=(12, 7), constrained_layout=True)
        axes[0].plot(ppm, corrected, color="#111111", lw=0.7)
        axes[0].set_xlim(float(np.max(ppm)), float(np.min(ppm)))
        axes[0].set_title("Processed 1D NMR overview", loc="left")
        axes[0].set_ylabel("Intensity")
        axes[1].plot(np.arange(min(2048, len(fid))) / sw_hz, np.real(fid[:2048]), lw=0.7, label="real")
        axes[1].plot(np.arange(min(2048, len(fid))) / sw_hz, np.imag(fid[:2048]), lw=0.7, label="imag", alpha=0.75)
        axes[1].set_title("FID (first points)", loc="left")
        axes[1].set_xlabel("Time / s")
        axes[1].set_ylabel("Amplitude")
        axes[1].legend(frameon=False)
        for ax in axes:
            ax.spines[["right", "top"]].set_visible(False)
        axes[0].set_xlabel("Chemical shift / ppm")
        fig.savefig(out / "processing_quicklook.png", dpi=200)
        plt.close(fig)

    print(f"Processed: {dataset}")
    print(f"Vendor: {vendor}; points: {len(fid)} -> {final_points}; noise MAD: {noise:.6g}")
    print(f"Detected peaks above {args.peak_snr:g}x noise prominence: {len(peaks)}")
    print(f"Outputs: {out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
