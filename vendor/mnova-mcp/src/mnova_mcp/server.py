from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .runner import (
    MnovaError,
    apply_assignments_1d,
    prepare_structure_1d,
    process_1d,
    status,
)


mcp = FastMCP(
    "Mnova MCP",
    instructions=(
        "Use mnova_status first. For structure confirmation, call "
        "mnova_prepare_structure_1d with the 1D NMR data and a ChemDraw/chemical "
        "structure file. Build an auditable assignment-plan JSON from the returned "
        "atom indices and multiplet UUIDs, then call mnova_apply_assignments_1d. "
        "Never overwrite raw data; keep low-confidence assignments unresolved by default."
    ),
)


@mcp.tool(name="mnova_status")
def mnova_status() -> dict[str, Any]:
    """Check MestReNova, bridge readiness, supported formats, and workflow."""
    return status()


@mcp.tool(name="mnova_process_1d")
def mnova_process_1d(
    input_path: str,
    output_dir: str | None = None,
    processing_template_path: str | None = None,
) -> dict[str, Any]:
    """Process 1D NMR data with Mnova and export auditable spectrum artifacts."""
    try:
        return process_1d(input_path, output_dir, processing_template_path)
    except MnovaError as exc:
        raise ValueError(str(exc)) from exc


@mcp.tool(name="mnova_prepare_structure_1d")
def mnova_prepare_structure_1d(
    input_path: str,
    structure_path: str,
    output_dir: str | None = None,
    processing_template_path: str | None = None,
    run_verification: bool = True,
) -> dict[str, Any]:
    """Open 1D NMR plus CDX/CDXML (or another supported structure) in Mnova.

    Processes the spectrum, extracts atom metadata and stable peak/multiplet IDs,
    optionally runs Mnova Verify, and saves a prepared .mnova document. The result
    is the evidence package used to create a separate assignment-plan JSON.
    """
    try:
        return prepare_structure_1d(
            input_path,
            structure_path,
            output_dir,
            processing_template_path,
            run_verification,
        )
    except MnovaError as exc:
        raise ValueError(str(exc)) from exc


@mcp.tool(name="mnova_apply_assignments_1d")
def mnova_apply_assignments_1d(
    prepared_mnova_path: str,
    assignment_plan_path: str,
    output_dir: str | None = None,
    run_verification: bool = True,
    allow_low_confidence: bool = False,
) -> dict[str, Any]:
    """Validate and write an assignment plan into a prepared Mnova document.

    Links molecule atoms/protons to real Mnova multiplet UUIDs, writes matching
    lowercase letter labels onto the structure and directly above the assigned
    peaks, optionally reruns Mnova Verify, and saves a new assigned .mnova file.
    Each plan entry requires a lowercase ``label``. Low-confidence assignments
    are rejected unless explicitly allowed.
    """
    try:
        return apply_assignments_1d(
            prepared_mnova_path,
            assignment_plan_path,
            output_dir,
            run_verification,
            allow_low_confidence,
        )
    except MnovaError as exc:
        raise ValueError(str(exc)) from exc


def main() -> None:
    mcp.run("stdio")


if __name__ == "__main__":
    main()
