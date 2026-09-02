# NMR interpretation rules

## Contents

- Evidence order
- Processing and quality checks
- Assignment table
- Quantitative calculations
- Common confounders
- Reporting language

## Evidence order

Use evidence in this order:

1. Raw/processed spectral observation: position, sign, shape, integral, S/N.
2. Internal relationships: coupling, correlated peaks, shared line shape, consistent integral ratios.
3. Experimental metadata: nucleus, solvent, field, temperature, pulse sequence, decoupling, delays.
4. Structure/reaction constraints: atom counts, symmetry, labels, expected disappearance/appearance.
5. External shift expectations or databases.

Do not let a predicted assignment override contrary observed data.

## Processing and quality checks

- Preserve the original FID and parameters.
- Apply the smallest defensible line broadening; report it.
- Zero-fill to improve display/digital interpolation, not claimed physical resolution.
- Correct zero- and first-order phase before integration.
- Correct baseline conservatively and show important weak regions before/after when the conclusion depends on them.
- Reference with a named peak and value. Residual-solvent shifts depend on solvent, temperature, and concentration.
- Estimate noise from signal-free regions or equal-width blank integration windows.
- Inspect for truncation wiggles, receiver clipping, strong-signal tails, solvent/water saturation, spinning sidebands, foldover, and Bruker digital-filter delay.

## Assignment table

Use columns like:

| shift / ppm | multiplicity | J / Hz | integral | assignment | evidence | alternatives | confidence |
|---|---|---:|---:|---|---|---|---|
| 3.62-3.68 | m |  | 4.00 | proposed OCH2 | shift + integral | overlapping solvent/impurity | medium |

Use `high` only when multiple independent constraints agree. Use `medium` for a plausible but non-unique match. Use `low` for prediction-driven or overlap-limited assignments.

## Quantitative calculations

For two resolved signals A and reference R:

`molar ratio A/R = (I_A / n_A) / (I_R / n_R)`

For end-group polymer DP, define the repeat-unit and end-group proton counts explicitly:

`DP = (I_repeat / H_repeat) / (I_end / H_end)`

For conversion from disappearing reactant R and product P signals with response-corrected molar quantities:

`conversion = P / (P + R)`

Check before quantitation:

- relaxation delay is long enough for the slowest relevant T1;
- pulse angle and receiver response are appropriate;
- peaks are resolved and baseline-corrected;
- exchangeable peaks, solvent, water, and suppressed regions are excluded unless justified;
- 13C integrals are not treated as quantitative under ordinary broadband-decoupled acquisition;
- uncertainty includes integration-window and baseline sensitivity, not only point noise.

When a target is not detected, report a detection or upper bound only if noise and the expected linewidth/window are defined. A useful conservative approach integrates multiple equal-width blank windows and reports a one-sided 3-sigma upper area.

## Common confounders

- Overlap can mimic stoichiometric integrals.
- OH/NH peaks may broaden, exchange, move, or disappear.
- Deuteration changes both peak count and isotope patterns; incomplete labeling creates residual isotopologues.
- Strong coupling can invalidate first-order `n+1` patterns.
- Concentration, temperature, pH, metal ions, and hydrogen bonding move shifts.
- Residual solvent/water and common workup solvents can dominate weak products.
- Polymer peaks are often broad; end groups can be below detection even when polymer is present.
- Paramagnetic material can broaden or suppress signals.

## Reporting language

Prefer:

- "A signal is observed at ..." for direct observation.
- "Assigned to ... because ..." for evidence-based assignment.
- "Consistent with, but not unique to ..." for ambiguity.
- "Not detected above the estimated limit ..." for evidence-based absence.
- "Cannot be determined from this dataset" when metadata, resolution, or S/N is insufficient.

Avoid "confirmed" unless the available experiments exclude realistic alternatives.
