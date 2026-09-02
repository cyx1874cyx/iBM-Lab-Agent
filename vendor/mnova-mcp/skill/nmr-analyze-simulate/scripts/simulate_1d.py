#!/usr/bin/env python3
"""Generate provenance-marked synthetic 1D complex NMR FIDs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


PASCAL_WEIGHTS = {
    "s": [1],
    "singlet": [1],
    "d": [1, 1],
    "doublet": [1, 1],
    "t": [1, 2, 1],
    "triplet": [1, 2, 1],
    "q": [1, 3, 3, 1],
    "quartet": [1, 3, 3, 1],
    "quintet": [1, 4, 6, 4, 1],
    "sextet": [1, 5, 10, 10, 5, 1],
    "septet": [1, 6, 15, 20, 15, 6, 1],
    "octet": [1, 7, 21, 35, 35, 21, 7, 1],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path, help="UTF-8 JSON peak model")
    parser.add_argument("--output", type=Path, required=True, help="New output directory")
    parser.add_argument(
        "--format", choices=("generic", "varian"), default="varian",
        help="Also create a vendor-style dataset (default: varian)",
    )
    parser.add_argument(
        "--varian-template", type=Path,
        help="Optional authorized .fid directory whose procpar fields are preserved",
    )
    parser.add_argument("--processed-points", type=int, help="Preview FFT size")
    parser.add_argument("--overwrite", action="store_true", help="Replace only --output")
    return parser.parse_args()


def load_model(path: Path) -> tuple[dict[str, Any], bytes, str, str]:
    raw = path.read_bytes()
    model = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(model, dict) or not isinstance(model.get("experiment"), dict):
        raise ValueError("Model must contain an 'experiment' object")
    if not isinstance(model.get("peaks"), list) or not model["peaks"]:
        raise ValueError("Model must contain a non-empty 'peaks' array")
    canonical = json.dumps(model, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return (
        model,
        raw,
        hashlib.sha256(raw).hexdigest(),
        hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )


def require_float(data: dict[str, Any], key: str, *, positive: bool = False) -> float:
    if key not in data:
        raise ValueError(f"Missing required field: {key}")
    value = float(data[key])
    if not math.isfinite(value) or (positive and value <= 0):
        raise ValueError(f"Invalid {key}: {data[key]!r}")
    return value


def expand_peaks(peaks: list[dict[str, Any]], obs_mhz: float) -> list[dict[str, Any]]:
    components: list[dict[str, Any]] = []
    for group_index, peak in enumerate(peaks, start=1):
        if not isinstance(peak, dict):
            raise ValueError(f"Peak {group_index} must be an object")
        center = require_float(peak, "ppm")
        area = require_float(peak, "area")
        linewidth = require_float(peak, "linewidth_hz", positive=True)
        if area < 0:
            raise ValueError(f"Peak {group_index} area must be nonnegative")
        phase_deg = float(peak.get("phase_deg", 0.0))
        if "multiplet_weights" in peak:
            weights = np.asarray(peak["multiplet_weights"], dtype=float)
        else:
            multiplicity = str(peak.get("multiplicity", "s")).lower()
            if multiplicity not in PASCAL_WEIGHTS:
                raise ValueError(f"Unsupported multiplicity for peak {group_index}: {multiplicity}")
            weights = np.asarray(PASCAL_WEIGHTS[multiplicity], dtype=float)
        if weights.ndim != 1 or len(weights) == 0 or np.any(weights < 0) or weights.sum() <= 0:
            raise ValueError(f"Invalid multiplet weights for peak {group_index}")
        weights = weights / weights.sum()
        j_hz = float(peak.get("j_hz", 0.0))
        if len(weights) > 1 and j_hz <= 0:
            raise ValueError(f"Peak {group_index} needs positive j_hz for a multiplet")
        offsets = np.arange(len(weights), dtype=float) - (len(weights) - 1) / 2.0
        for component_index, (offset, weight) in enumerate(zip(offsets, weights), start=1):
            components.append({
                "group_index": group_index,
                "component_index": component_index,
                "label": str(peak.get("label", f"peak_{group_index}")),
                "group_center_ppm": center,
                "ppm": center + offset * j_hz / obs_mhz,
                "area": area * float(weight),
                "group_area": area,
                "linewidth_hz": linewidth,
                "phase_deg": phase_deg,
                "j_hz": j_hz,
                "weight": float(weight),
            })
    return components


def prepare_output(path: Path, overwrite: bool) -> Path:
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


def add_procpar_value(procpar: dict[str, Any], name: str, value: Any, string: bool = False) -> None:
    import nmrglue.fileio.varian as varian

    entry = varian.create_pdic_param(name, [str(value)])
    if string:
        entry["basictype"] = "2"
        entry["subtype"] = "2"
    procpar[name] = entry


def write_varian(
    out: Path, fid: np.ndarray, exp: dict[str, Any], template: Path | None
) -> tuple[Path, float]:
    try:
        import nmrglue as ng
    except ImportError as exc:
        raise RuntimeError("Varian output requires nmrglue; use --format generic or install nmrglue") from exc

    obs_mhz = float(exp["obs_mhz"])
    sw_hz = float(exp["spectral_width_hz"])
    carrier_ppm = float(exp["carrier_ppm"])
    udic = ng.fileiobase.create_blank_udic(1)
    udic[0].update({
        "size": len(fid), "complex": True, "sw": sw_hz, "obs": obs_mhz,
        "car": carrier_ppm * obs_mhz, "label": str(exp.get("nucleus", "1H")),
        "time": True, "freq": False,
    })
    dic = ng.varian.create_dic(udic)
    if template is not None:
        if not template.is_dir() or not (template / "procpar").exists():
            raise ValueError("--varian-template must be a Varian/Agilent .fid directory")
        template_dic, _ = ng.varian.read(str(template))
        dic["procpar"] = template_dic["procpar"]
    procpar = dic["procpar"]
    rfl_hz = sw_hz / 2.0 - carrier_ppm * obs_mhz
    numeric = {
        "np": len(fid) * 2, "sw": sw_hz, "sfrq": obs_mhz, "rfl": rfl_hz,
        "rfp": 0.0, "nt": int(exp.get("nt", 1)), "at": len(fid) / sw_hz,
        "d1": float(exp.get("d1_s", 1.0)), "rp": 0.0, "lp": 0.0, "lb": 0.0,
    }
    for name, value in numeric.items():
        add_procpar_value(procpar, name, value)
    for name, value in {
        "tn": exp.get("nucleus", "1H"), "solvent": exp.get("solvent", "unknown"),
        "samplename": "SYNTHETIC_NMR_DATA", "seqfil": "synthetic",
        "comment": "SYNTHETIC DATA - NOT ACQUIRED ON AN INSTRUMENT",
        "date": datetime.now(timezone.utc).date().isoformat(),
    }.items():
        add_procpar_value(procpar, name, value, string=True)

    fid_dir = out / "synthetic_1d.fid"
    ng.varian.write(str(fid_dir), dic, fid.astype(np.complex64), overwrite=False)
    (fid_dir / "text").write_text(
        "SYNTHETIC NMR DATA - NOT ACQUIRED ON AN INSTRUMENT\n", encoding="utf-8"
    )
    (fid_dir / "log").write_text(
        f"{datetime.now(timezone.utc).isoformat()}: synthetic FID generated\n", encoding="utf-8"
    )
    _, readback = ng.varian.read(str(fid_dir))
    if readback.shape != fid.shape or not np.all(np.isfinite(readback)):
        raise RuntimeError("Varian readback shape/finite-value validation failed")
    max_error = float(np.max(np.abs(readback.astype(np.complex128) - fid)))
    tolerance = max(1e-6, float(np.max(np.abs(fid))) * 2e-7)
    if max_error > tolerance:
        raise RuntimeError(f"Varian readback mismatch: {max_error:g} > {tolerance:g}")
    return fid_dir, max_error


def write_preview(
    out: Path, fid: np.ndarray, obs_mhz: float, carrier_ppm: float,
    sw_hz: float, points: int,
) -> tuple[np.ndarray, np.ndarray]:
    spectrum = np.fft.fftshift(np.fft.fft(fid, n=points))
    freq_hz = np.fft.fftshift(np.fft.fftfreq(points, d=1.0 / sw_hz))
    ppm = carrier_ppm - freq_hz / obs_mhz
    np.savetxt(
        out / "synthetic_processed_spectrum.csv",
        np.column_stack([ppm, spectrum.real, spectrum.imag]), delimiter=",",
        header="ppm,real_intensity,imag_intensity", comments="",
    )
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return ppm, spectrum
    fig, ax = plt.subplots(figsize=(12, 4.5), constrained_layout=True)
    ax.plot(ppm, spectrum.real, color="#111111", lw=0.8)
    ax.set_xlim(float(ppm.max()), float(ppm.min()))
    ax.set_xlabel("Chemical shift / ppm")
    ax.set_ylabel("Intensity")
    ax.set_title("SYNTHETIC 1D NMR preview", loc="left")
    ax.spines[["right", "top"]].set_visible(False)
    fig.savefig(out / "synthetic_preview.png", dpi=200)
    plt.close(fig)
    return ppm, spectrum


def main() -> int:
    args = parse_args()
    model, source_model_bytes, source_file_hash, canonical_model_hash = load_model(args.model)
    exp = dict(model["experiment"])
    obs_mhz = require_float(exp, "obs_mhz", positive=True)
    carrier_ppm = require_float(exp, "carrier_ppm")
    sw_hz = require_float(exp, "spectral_width_hz", positive=True)
    complex_points = int(exp.get("complex_points", 16384))
    if complex_points < 128:
        raise ValueError("complex_points must be at least 128")
    scale = float(exp.get("scale", 10000.0))
    noise_std = float(exp.get("noise_std", 0.0))
    if not math.isfinite(scale) or scale <= 0 or not math.isfinite(noise_std) or noise_std < 0:
        raise ValueError("scale must be positive and noise_std must be nonnegative")
    seed = int(exp.get("seed", np.random.SeedSequence().entropy))
    exp.update({
        "nucleus": str(exp.get("nucleus", "1H")), "obs_mhz": obs_mhz,
        "carrier_ppm": carrier_ppm, "spectral_width_hz": sw_hz,
        "complex_points": complex_points, "scale": scale, "noise_std": noise_std,
        "seed": seed,
    })
    components = expand_peaks(model["peaks"], obs_mhz)
    half_width_ppm = sw_hz / (2.0 * obs_mhz)
    ppm_low, ppm_high = carrier_ppm - half_width_ppm, carrier_ppm + half_width_ppm
    outside = [c for c in components if not (ppm_low <= c["ppm"] <= ppm_high)]
    if outside:
        details = ", ".join(f"{c['label']}@{c['ppm']:.4f}" for c in outside[:6])
        raise ValueError(f"Components outside spectral window [{ppm_low:.3f}, {ppm_high:.3f}] ppm: {details}")

    out = prepare_output(args.output, args.overwrite)
    (out / "source_peak_model.json").write_bytes(source_model_bytes)
    t = np.arange(complex_points, dtype=float) / sw_hz
    fid = np.zeros(complex_points, dtype=np.complex128)
    for component in components:
        frequency_hz = (carrier_ppm - component["ppm"]) * obs_mhz
        phase_rad = math.radians(component["phase_deg"])
        fid += component["area"] * np.exp(-math.pi * component["linewidth_hz"] * t) * np.exp(
            1j * (2.0 * math.pi * frequency_hz * t + phase_rad)
        )
        component["frequency_hz_from_carrier"] = frequency_hz
    if noise_std:
        rng = np.random.default_rng(seed)
        fid += noise_std * (rng.normal(size=complex_points) + 1j * rng.normal(size=complex_points))
    fid[0] *= 0.5
    fid = (fid * scale).astype(np.complex64)
    if not np.all(np.isfinite(fid)):
        raise RuntimeError("Generated FID contains non-finite values")

    np.save(out / "synthetic_fid_complex64.npy", fid)
    interleaved = np.empty(complex_points * 2, dtype="<f4")
    interleaved[0::2], interleaved[1::2] = fid.real, fid.imag
    interleaved.tofile(out / "synthetic_fid_interleaved_le_float32.bin")
    np.savetxt(
        out / "synthetic_fid.csv", np.column_stack([t, fid.real, fid.imag]), delimiter=",",
        header="time_s,real,imag", comments="",
    )
    with (out / "synthetic_components.csv").open("w", encoding="utf-8", newline="") as stream:
        fields = list(components[0].keys())
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(components)

    preview_points = args.processed_points or 2 ** math.ceil(math.log2(complex_points * 4))
    if preview_points < complex_points:
        raise ValueError("--processed-points must be at least complex_points")
    ppm, spectrum = write_preview(out, fid, obs_mhz, carrier_ppm, sw_hz, preview_points)
    grid_ppm = sw_hz / (preview_points * obs_mhz)
    peak_verification = []
    magnitude = np.abs(spectrum)
    for component in components:
        tolerance_ppm = max(3.0 * grid_ppm, 1.5 * component["linewidth_hz"] / obs_mhz)
        local = np.flatnonzero(np.abs(ppm - component["ppm"]) <= tolerance_ppm)
        if len(local) == 0:
            raise RuntimeError(f"No preview points near modeled component {component['label']}")
        picked = int(local[np.argmax(magnitude[local])])
        error_ppm = abs(float(ppm[picked]) - float(component["ppm"]))
        if error_ppm > tolerance_ppm:
            raise RuntimeError(f"Preview peak verification failed for {component['label']}")
        peak_verification.append({
            "label": component["label"],
            "modeled_ppm": component["ppm"],
            "picked_magnitude_ppm": float(ppm[picked]),
            "absolute_error_ppm": error_ppm,
            "tolerance_ppm": tolerance_ppm,
        })
    readback_error = None
    fid_dir = None
    if args.format == "varian":
        fid_dir, readback_error = write_varian(out, fid, exp, args.varian_template)

    canonical_model = {"experiment": exp, "peaks": model["peaks"]}
    (out / "synthetic_peak_model.json").write_text(
        json.dumps(canonical_model, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    metadata = {
        "synthetic": True,
        "warning": "SIMULATED DATA - NOT ACQUIRED ON AN INSTRUMENT",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "source_model": str(args.model.resolve()),
        "source_model_file_sha256": source_file_hash,
        "source_model_canonical_sha256": canonical_model_hash,
        "experiment": exp,
        "component_count": len(components),
        "spectral_window_ppm": [ppm_low, ppm_high],
        "preview_points": preview_points,
        "output_format": args.format,
        "varian_readback_max_abs_error": readback_error,
        "component_peak_verification": peak_verification,
        "limitations": [
            "Lorentzian first-order line model only",
            "No strong-coupling or spin-Hamiltonian effects",
            "No instrument pulse/receiver/digital-filter response",
            "Shifts and linewidths are exactly those declared by the model",
        ],
    }
    (out / "simulation_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    archive_path = out / "synthetic_1d_varian_fid.zip"
    if fid_dir is not None:
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(fid_dir.rglob("*")):
                if path.is_file():
                    archive.write(path, arcname=Path(fid_dir.name) / path.relative_to(fid_dir))

    print(f"Created synthetic dataset: {out}")
    print(f"Source model file SHA-256: {source_file_hash}")
    print(f"Canonical model SHA-256: {canonical_model_hash}")
    print(f"Components: {len(components)}; FID points: {complex_points}; preview points: {len(ppm)}")
    if readback_error is not None:
        print(f"Varian readback max abs error: {readback_error:.6g}")
    print("WARNING: SIMULATED DATA - NOT ACQUIRED ON AN INSTRUMENT")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
