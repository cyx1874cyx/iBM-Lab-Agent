#!/usr/bin/env python3
"""Validate an Mnova assignment plan against one preparation analysis JSON."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any


CONFIDENCE_LEVELS = {"high", "medium", "low"}
ASSIGNMENT_LABEL_RE = re.compile(r"^[a-z]+$")


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read valid UTF-8 JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"top-level JSON value must be an object: {path}")
    return value


def finite_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
    )


def normalize_h(value: Any) -> str:
    return "" if value is None else str(value)


def validate(
    analysis: dict[str, Any],
    plan: dict[str, Any],
    *,
    ppm_tolerance: float,
    allow_low_confidence: bool,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    if analysis.get("status") != "ok":
        errors.append("preparation analysis status is not 'ok'")
    if analysis.get("operation") != "prepare_structure_1d":
        warnings.append("analysis was not produced by prepare_structure_1d")
    source_job = plan.get("source_job_id")
    if source_job and source_job != analysis.get("job_id"):
        errors.append(
            f"source_job_id {source_job!r} does not match analysis job_id "
            f"{analysis.get('job_id')!r}"
        )

    atoms = {
        atom.get("index"): atom
        for atom in analysis.get("atoms", [])
        if isinstance(atom, dict) and isinstance(atom.get("index"), int)
    }
    multiplets = {
        item.get("uuid"): item
        for item in analysis.get("multiplets", [])
        if isinstance(item, dict)
        and isinstance(item.get("uuid"), str)
        and item.get("uuid")
    }
    if not atoms:
        errors.append("analysis contains no indexed atoms")
    if not multiplets:
        errors.append("analysis contains no multiplet UUIDs")

    assignments = plan.get("assignments")
    if not isinstance(assignments, list) or not assignments:
        errors.append("plan must contain a non-empty assignments array")
        assignments = []

    nucleus = str(analysis.get("spectrum", {}).get("nucleus", ""))
    seen_targets: set[tuple[int, str]] = set()
    label_to_multiplet: dict[str, str] = {}
    multiplet_targets: dict[str, list[int]] = {}

    for index, assignment in enumerate(assignments):
        prefix = f"assignments[{index}]"
        if not isinstance(assignment, dict):
            errors.append(f"{prefix} must be an object")
            continue
        atom_index = assignment.get("atom_index")
        atom = atoms.get(atom_index)
        if atom is None:
            errors.append(f"{prefix}.atom_index is absent from analysis atoms")

        h_index = assignment.get("h_index")
        if "1H" in nucleus:
            valid_h = [normalize_h(value) for value in (atom or {}).get(
                "non_equivalent_h_indices", []
            )]
            if h_index is None:
                errors.append(f"{prefix}.h_index is required for a 1H spectrum")
            elif normalize_h(h_index) not in valid_h:
                errors.append(
                    f"{prefix}.h_index {h_index!r} is not valid for atom {atom_index}; "
                    f"expected one of {valid_h}"
                )

        uuid = assignment.get("multiplet_uuid")
        multiplet = multiplets.get(uuid)
        if multiplet is None:
            errors.append(f"{prefix}.multiplet_uuid is absent from analysis")
        elif isinstance(atom_index, int):
            multiplet_targets.setdefault(uuid, []).append(atom_index)

        label = assignment.get("label")
        if not isinstance(label, str) or not ASSIGNMENT_LABEL_RE.fullmatch(label):
            errors.append(
                f"{prefix}.label must contain lowercase letters only (a-z, aa, ab, ...)"
            )
        elif isinstance(uuid, str):
            prior_uuid = label_to_multiplet.get(label)
            if prior_uuid is not None and prior_uuid != uuid:
                errors.append(
                    f"{prefix}.label {label!r} is already linked to another multiplet"
                )
            label_to_multiplet[label] = uuid

        confidence = assignment.get("confidence")
        if confidence not in CONFIDENCE_LEVELS:
            errors.append(f"{prefix}.confidence must be high, medium, or low")
        elif confidence == "low" and not allow_low_confidence:
            errors.append(
                f"{prefix} is low confidence; move it to unresolved or pass "
                "--allow-low-confidence"
            )
        evidence = assignment.get("evidence")
        if not isinstance(evidence, str) or not evidence.strip():
            errors.append(f"{prefix}.evidence must be a non-empty string")

        numeric_fields = ("ppm", "range_min_ppm", "range_max_ppm")
        if any(not finite_number(assignment.get(field)) for field in numeric_fields):
            errors.append(f"{prefix} must contain finite ppm and range values")
        else:
            ppm = float(assignment["ppm"])
            low, high = sorted(
                (
                    float(assignment["range_min_ppm"]),
                    float(assignment["range_max_ppm"]),
                )
            )
            if not low <= ppm <= high:
                errors.append(f"{prefix}.ppm is outside its declared range")
            if multiplet is not None:
                comparisons = (
                    ("ppm", ppm, float(multiplet.get("ppm"))),
                    ("range_min_ppm", low, min(
                        float(multiplet.get("range_min_ppm")),
                        float(multiplet.get("range_max_ppm")),
                    )),
                    ("range_max_ppm", high, max(
                        float(multiplet.get("range_min_ppm")),
                        float(multiplet.get("range_max_ppm")),
                    )),
                )
                for field, planned, observed in comparisons:
                    if abs(planned - observed) > ppm_tolerance:
                        errors.append(
                            f"{prefix}.{field} differs from multiplet {uuid} by "
                            f"more than {ppm_tolerance:g} ppm"
                        )

        if isinstance(atom_index, int):
            target = (atom_index, normalize_h(h_index))
            if target in seen_targets:
                errors.append(f"{prefix} duplicates atom/h target {target}")
            seen_targets.add(target)

    unresolved = plan.get("unresolved", [])
    if not isinstance(unresolved, list):
        errors.append("unresolved must be an array when present")

    for uuid, target_atoms in multiplet_targets.items():
        if len(target_atoms) > 1:
            warnings.append(
                f"multiplet {uuid} is linked to multiple atoms {target_atoms}; "
                "confirm equivalence/symmetry is intentional"
            )

    return {
        "status": "ok" if not errors else "error",
        "analysis_job_id": analysis.get("job_id"),
        "assignment_count": len(assignments),
        "labels": [
            item.get("label") for item in assignments if isinstance(item, dict)
        ],
        "unresolved_count": len(unresolved) if isinstance(unresolved, list) else 0,
        "errors": errors,
        "warnings": warnings,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate an assignment-plan JSON against Mnova preparation analysis."
    )
    parser.add_argument("analysis", type=Path, help="prepare_structure_1d analysis.json")
    parser.add_argument("plan", type=Path, help="assignment-plan JSON")
    parser.add_argument(
        "--ppm-tolerance",
        type=float,
        default=0.002,
        help="maximum difference from the selected multiplet values (default: 0.002 ppm)",
    )
    parser.add_argument(
        "--allow-low-confidence",
        action="store_true",
        help="permit low-confidence assignments instead of requiring unresolved",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.ppm_tolerance < 0 or not math.isfinite(args.ppm_tolerance):
        print("ERROR: --ppm-tolerance must be a finite nonnegative number", file=sys.stderr)
        return 2
    try:
        analysis = load_json(args.analysis)
        plan = load_json(args.plan)
        result = validate(
            analysis,
            plan,
            ppm_tolerance=args.ppm_tolerance,
            allow_low_confidence=args.allow_low_confidence,
        )
    except ValueError as exc:
        result = {"status": "error", "errors": [str(exc)], "warnings": []}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "ok" else 2


if __name__ == "__main__":
    raise SystemExit(main())
