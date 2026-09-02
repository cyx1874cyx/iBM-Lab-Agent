# MestReNova structure assignment and verification

## Contents

- Input contract
- Two-stage workflow
- Assignment-plan schema
- Letter-label style
- Assignment logic
- Verification interpretation
- Failure handling
- Delivery checklist

## Input contract

Keep every input inside the active project/workspace.

Required:

- one measured 1D NMR dataset or Mnova-readable spectrum;
- one machine-readable target structure, preferably ChemDraw `.cdx` or `.cdxml`.

Accepted structure fallbacks are `.mol`, `.sdf`, `.sd`, `.mrv`, `.cml`, `.smi`, and `.inchi`. Reject screenshots as the sole structure input because they do not preserve atom indices or bonding unambiguously.

Record the nucleus and whether the supplied structure is the intended neutral form, salt, solvate, isotope-labeled form, stereoisomer, or repeating-unit representation. For polymers, clarify whether the structure is an exact oligomer, idealized repeat unit, or end-group model before assigning atom indices.

## Two-stage workflow

### 1. Prepare evidence

Call `mnova_status`, then `mnova_prepare_structure_1d`.

The preparation result is the source of truth for identifiers used later:

- `atoms[].index`: Mnova atom index;
- `atoms[].non_equivalent_h_indices`: valid attached-proton site indices for 1H assignments;
- `multiplets[].uuid`: stable Mnova multiplet identifier;
- `artifacts.mnova`: prepared document;
- `artifacts.analysis_json`: auditable evidence package.

Check that the imported molecule's SMILES/InChI and atom count are consistent with the user's structure. Stop if the structure imported as multiple unintended fragments, lost isotope/stereochemical information relevant to the question, or does not represent the stated target.

Do not treat auto-picked peaks, auto-created multiplets, automatic integrals, or Mnova Verify's proposed assignments as established chemical assignments. Inspect them against the full spectrum and fix processing/reference problems before building a plan.

### 2. Apply approved assignments

Create and validate a plan tied to the exact preparation job. Then call `mnova_apply_assignments_1d`.

The apply operation must:

- refuse atom indices or multiplet UUIDs absent from the prepared document;
- refuse low-confidence assignments by default;
- write to a new output directory;
- link assignments by Mnova multiplet UUID rather than by rounded ppm alone;
- save the approved assignments after Verify has run;
- preserve unresolved items in the audit result.

Compare the returned `assignments` and `display_labels` with the plan. The count alone is insufficient: verify display label, atom index, proton site, multiplet UUID, range, and the actual visual placement.

## Assignment-plan schema

Use UTF-8 JSON:

```json
{
  "schema_version": "1.1",
  "source_job_id": "preparation job id",
  "source_analysis_path": "C:\\project\\mnova-mcp-output\\...\\analysis.json",
  "assignments": [
    {
      "label": "a",
      "atom_index": 4,
      "h_index": 1,
      "multiplet_uuid": "{real-uuid-from-analysis}",
      "ppm": 3.651,
      "range_min_ppm": 3.620,
      "range_max_ppm": 3.681,
      "confidence": "high",
      "evidence": "2H integral, quartet-like splitting, J 7.1 Hz, and expected OCH2 shift"
    }
  ],
  "unresolved": [
    {
      "multiplet_uuid": "{another-real-uuid}",
      "ppm": 1.56,
      "reason": "overlaps water/impurity; no unique atom assignment"
    }
  ]
}
```

Rules:

- Every assignment requires one lowercase-letter `label`. Use `a` through `z`, then `aa`, `ab`, and so on when more labels are needed. Do not put commas, spaces, primes, numerals, Greek letters, or uppercase letters in an individual `label` field.
- Assign letters in a chemically readable order around the target structure; do not derive the sequence from ppm order.
- Reuse one label only for chemically equivalent/symmetric sites linked to the same observed multiplet. One label must never point to two different multiplet UUIDs.
- Copy ppm and range from the selected multiplet; do not identify a multiplet by a rounded shift alone.
- For 1H assignments, use the numeric `h_index` returned by `non_equivalent_h_indices`. The MCP translates it to Mnova's a/b/c proton label.
- For 13C assignments, omit `h_index`.
- Use `high`, `medium`, or `low` only. Keep `low` in `unresolved` unless the user explicitly requests speculative writeback.
- State evidence, not a circular claim such as "matches target".
- Do not reuse the same atom/h target for two assignments unless the chemistry genuinely requires multiple observed environments and the plan explicitly explains it. The default validator rejects duplicate targets.
- Multiple equivalent/symmetric atoms may point to one multiplet when justified; list each atom target explicitly and explain the symmetry.

## Letter-label style

The final Mnova view follows one shared label language on structure and spectrum:

- Structure labels are lowercase letters placed beside the corresponding atom/proton environment; request blue numbering to match the reference style. A heavy atom with distinct assigned proton environments shows their labels joined by commas with no spaces, for example `a,d`. Mnova may override the structure-number color with its assigned-molecule theme, so visual QA must record the rendered color rather than claiming blue when it was overridden.
- Spectrum labels repeat exactly the same lowercase letters. Place each label horizontally, centered directly above the highest representative peak of its assigned multiplet, with a small clear gap. Do not rotate labels and do not place them in the chemical-shift peak-pick row at the top of the spectrum.
- When two or more assignments share one coincident or intentionally combined multiplet, join the distinct labels in plan order with commas and no spaces, for example `i,j` or `m,n,o,p`. Do not add parentheses, ppm values, multiplicity, or integral text to this label.
- Use blue (`#0000FF`), regular sans-serif text, approximately 10–12 pt, without a box. Keep verbose multiplet labels hidden in the clean assignment view.
- Do not place target letters on solvent, water, reference, standard, impurity, or unresolved peaks.
- The structure-to-spectrum mapping must be exact and bidirectional: every visible target letter on the structure has a matching visible peak label, and every visible peak letter maps back to the intended structure site.

If labels collide, first move the text vertically by the smallest amount that restores legibility while keeping it immediately above the peak. Combine labels only when the assignments truly share the same multiplet; never combine chemically separate nearby signals merely to reduce clutter.

## Assignment logic

Evaluate assignments in this order:

1. Exclude reference, residual solvent, water, known additives, and obvious impurities.
2. Check target atom/proton counts and molecular symmetry.
3. Check integration after defensible normalization.
4. Check multiplicity and resolved J values.
5. Check chemical-shift environment and substituent effects.
6. Check internal consistency across all target signals, including required missing signals and unexplained extras.
7. Use 2D correlations, isotope patterns, reaction context, or orthogonal data when available.

Use `high` only when more than one independent constraint agrees and no realistic alternative remains. Use `medium` when the assignment is plausible but not unique. Keep overlap-limited, exchangeable, prediction-only, or contradiction-bearing assignments unresolved.

For a proposed product, distinguish:

- identity support: diagnostic target signals are present with coherent counts/relationships;
- purity: extra non-solvent signals and quantitative acquisition conditions are separately assessed;
- conversion/composition: explicit integral formulas and response assumptions are required;
- complete atom assignment: usually requires suitable 2D data for nontrivial structures.

## Verification interpretation

Mnova Verify returns decision-support metrics:

- `score`: approximately -1 (mismatch) to +1 (match), with 0 indeterminate;
- `quality`: score combined with significance;
- `significance`: strength/reliability weight for the score;
- per-test results and messages: identify count, prediction, assignment, acquisition, or quality failures.

Report the raw values and warnings. Do not invent universal pass/fail thresholds. Interpret a positive score cautiously when the spectrum has few peaks, poor quality, excessive overlap, or a flexible/symmetric/polymeric target. Treat a negative or low-quality result as a contradiction to investigate, not automatically as proof that the sample is wrong.

If Verify is unavailable, unlicensed, or fails, preserve that status and continue the evidence-based manual assessment. Do not emulate a Verify score.

## Failure handling

- Structure import fails: request the original `.cdx/.cdxml`; try `.mol`/`.sdf` only as an explicit conversion fallback.
- No multiplet UUIDs: correct processing/peak picking before assigning; do not create ppm-only pseudo-links.
- Reference or phase/baseline is wrong: reprocess into a new preparation job and discard the stale plan.
- Atom indices changed after editing/reimport: regenerate the preparation analysis and rebuild the plan.
- Verify overwrites labels: use the MCP apply operation, which restores the audited plan after Verify; then compare the returned assignments.
- 1D evidence is non-unique: write only decisive assignments and recommend COSY/HSQC/HMBC or the smallest resolving experiment.

## Delivery checklist

- raw NMR and target structure remain unmodified;
- `prepared.mnova` and `assigned.mnova` both exist;
- analysis JSON, assignment plan, applied assignment JSON/CSV, and verification JSON are linked;
- applied atom/h/multiplet identifiers match the plan;
- structure and peak labels are lowercase letters with exact one-to-one mapping; spectrum labels are blue, and any structure-theme color override is disclosed;
- peak labels are horizontal and directly above their assigned peaks; coincident labels use comma joining without spaces;
- verbose multiplet boxes do not obscure the clean label view;
- unresolved/excluded signals are listed;
- the verdict is `supported`, `contradicted`, or `inconclusive`, with reasons;
- Verify metrics are separated from the manual evidence conclusion;
- no synthetic or predicted signal is presented as measured evidence.
