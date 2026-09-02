---
name: nmr-analyze-simulate
description: Interpret NMR spectra, assign and verify a ChemDraw target structure inside MestReNova, and generate provenance-marked synthetic 1D NMR raw data. Use when Codex needs to inspect NMR images, peak tables, processed spectra, or Bruker/Varian/Agilent FID directories; import CDX/CDXML with measured 1D 1H or 13C data; write atom-to-multiplet assignments into an Mnova document; assess identity, purity, integrations, coupling, end groups, reaction conversion, or polymer composition; troubleshoot artifacts; or create reproducible simulated complex FIDs and Varian/Agilent .fid datasets from a peak model.
---

# NMR analysis and simulation

Preserve the distinction between observations, assignments, calculations, and hypotheses. Never present synthetic data as experimental data.

## Route the request

1. Identify the input:
   - For a screenshot or plotted spectrum, perform visual/semiquantitative interpretation only.
   - For CSV/JCAMP/peak tables, analyze the supplied processed values and retain their units.
   - For a directory containing `fid` + `procpar`, treat it as Varian/Agilent.
   - For a directory containing `fid`/`ser` + `acqus`, treat it as Bruker.
   - For a molecular structure without measured data, predict plausible regions and label every assignment as predicted.
2. Choose the task:
   - For interpretation or raw-data processing, follow **Interpret a spectrum**.
   - For a ChemDraw structure plus measured 1D NMR that must be labeled and checked in MestReNova, follow **Assign and verify in MestReNova**.
   - For synthetic data, follow **Simulate a raw FID**.
   - For comparison, process measured and synthetic data independently, then compare peak positions, multiplicities, relative integrals, and missing/extra signals.
3. Read [references/interpretation.md](references/interpretation.md) for assignment, quantitation, uncertainty, and reporting rules.
4. Read [references/mnova-structure-verification.md](references/mnova-structure-verification.md) before writing assignments into MestReNova.
5. Read [references/simulation.md](references/simulation.md) before constructing or reviewing a peak-model JSON.

## Interpret a spectrum

1. Work on a copy or write all outputs to a new directory. Do not modify vendor raw data.
2. Record nucleus, solvent, field strength, temperature, pulse program, scans, acquisition time, relaxation delay, spectral width, and reference when available. Mark missing metadata.
3. Process 1D raw FIDs with `scripts/process_1d.py`. Before installing anything, search the current project and the input dataset's ancestors for `.venv`, `venv`, or `.nmr_env` and use its Python when it contains `numpy`, `scipy`, `matplotlib`, and `nmrglue`. Otherwise use the bundled workspace Python or system Python. Do not install dependencies into the analysis-output directory.
4. Inspect the full spectrum before zooming into diagnostic regions. Check phase, baseline, truncation/ringing, solvent suppression, clipping, digital-filter artifacts, water/solvent peaks, and signal-to-noise.
5. Reference against a stated internal standard, residual solvent, or known signal. Do not silently assume a reference.
6. Build a peak table with chemical shift/range, multiplicity, J values when resolved, integral, tentative assignment, evidence, alternatives, and confidence.
7. Test assignments against all constraints: proton/carbon count, symmetry, multiplicity, coupling, integration, expected shift, exchange, overlap, isotope labeling, and the proposed structure or reaction.
8. Separate conclusions into:
   - directly observed;
   - strongly supported assignment;
   - tentative/ambiguous assignment;
   - not assessable from the supplied data.
9. For quantitative claims, show the normalization signal and formula. Check relaxation delay, saturation, overlap, baseline, and response assumptions before reporting conversion, composition, DP, or purity.
10. Recommend the smallest decisive follow-up experiment, such as a longer relaxation delay, more scans, COSY, HSQC, HMBC, DEPT/APT, DOSY, variable temperature, spike-in, or an orthogonal method.

Example raw-data command:

```powershell
python scripts/process_1d.py "C:\data\sample.fid" --output "C:\data\sample_analysis" --reference-ppm 7.260 --reference-window 7.1 7.4
```

When a known signal-free range is available, add `--noise-window LOW HIGH`; otherwise the script estimates noise from the quietest distributed spectral blocks.

Treat the generated peak list as a measurement aid, not an automatic chemical assignment.

## Assign and verify in MestReNova

Use the Mnova MCP as a two-stage, auditable workflow. Do not jump directly from a structure image or predicted shifts to labels in the final document.

1. Require the measured NMR input and a machine-readable structure. Prefer the original ChemDraw `.cdx` or `.cdxml`; `.mol`, `.sdf`, `.mrv`, `.cml`, `.smi`, and `.inchi` are acceptable fallbacks. A PNG copied from ChemDraw is not a structure file.
2. Call `mnova_status`. Stop the Mnova route if the executable or bridge is unavailable; continue with file-based interpretation only if that still answers the request.
3. Call `mnova_prepare_structure_1d` with the NMR path and structure path. This opens both inputs in one Mnova document, processes the 1D spectrum, exports atoms and their valid proton indices, exposes stable peak/multiplet UUIDs, optionally runs Mnova Verify, and saves `prepared.mnova` without touching the raw data.
4. Inspect the returned molecule identity (`smiles`/`inchi` when available), nucleus, solvent/reference, spectral quality, integrals, multiplets, and Verify warnings. Treat Mnova's automatic assignments as hypotheses, not approved labels.
5. Build a separate assignment-plan JSON from the returned `atoms[].index`, `atoms[].non_equivalent_h_indices`, and `multiplets[].uuid`. Give every written assignment one lowercase letter in `label` (`a` through `z`, then `aa`, `ab`, ...), plus the observed ppm/range, `high` or `medium` confidence, and a concise evidence statement. Assign labels by a chemically readable traversal of the structure, not by ppm order. Put low-confidence, solvent, water, reference, impurity, unexplained, or non-uniquely resolved signals in `unresolved`.
6. Validate the plan against the exact preparation analysis before applying it:

```powershell
python scripts/validate_mnova_assignment_plan.py analysis.json assignment-plan.json
```

7. Call `mnova_apply_assignments_1d` with `prepared.mnova` and the validated plan. Keep `allow_low_confidence=false` unless the user explicitly accepts speculative labels. The tool links molecule atoms/protons to real Mnova multiplet UUIDs, reruns Verify when available, restores the audited plan, replaces structure numbers with lowercase letters, places matching blue labels horizontally and directly above the assigned peaks, hides verbose multiplet detail boxes, and saves a new `assigned.mnova`. It requests blue structure-number text, but some Mnova assignment themes override that color; preserve the letters and report the actual rendered color after visual QA.
8. Confirm that `applied_assignment_count` equals the intended count and that the returned assignments and `display_labels` refer to the planned labels, atom/h targets, and multiplet UUIDs. Inspect the assigned PDF or Mnova document visually: a structure label and its peak label must be identical; coincident labels must be comma-joined without spaces (for example `k,l`); labels must not sit in the top chemical-shift pick row. If any mapping or placement differs, do not present the document as complete.
9. Report target-supporting signals, contradictions, missing/extra signals, unresolved regions, Verify score/quality/significance and warnings, and the smallest decisive follow-up experiment. Never use a Verify score alone as proof of identity.

For ambiguous 1D data, write only the non-controversial labels and recommend COSY/HSQC/HMBC or another decisive dataset rather than forcing a complete assignment.

Letter-label rules are strict: use lowercase Roman letters only; use one label per distinct assigned environment; reuse a label only for chemically equivalent sites linked to the same multiplet; show distinct non-equivalent proton labels on one heavy atom as a comma-joined structure label such as `a,d`; and show multiple assignments at one coincident/overlapped peak as `k,l`. Use blue, unboxed, horizontal spectrum text centered immediately above the relevant peak.

## Simulate a raw FID

1. Define the scientific purpose: assignment aid, processing test, teaching example, sensitivity estimate, or expected-spectrum comparison.
2. Build a JSON peak model using [references/simulation.md](references/simulation.md). Specify nucleus, observation frequency, carrier, spectral width, complex points, peak positions, areas, linewidths, phases, multiplet weights/J values, noise, and random seed.
3. Use `scripts/simulate_1d.py` to create:
   - complex time-domain FID (`.npy` and interleaved float32 binary);
   - processed preview CSV and PNG;
   - expanded component table;
   - simulation metadata with `synthetic: true`, model hash, parameters, and seed;
   - optionally, a Varian/Agilent `.fid` directory that is read back for validation.
4. Prefer a Varian template from the same instrument only when downstream vendor software requires its extended `procpar` fields. The script preserves the template parameter dictionary but replaces acquisition-defining fields and writes explicit synthetic provenance.
5. Check that every modeled center lies within the spectral window, the FID is finite, the vendor dataset can be read back, and a preview maximum occurs near every expected component/group.
6. State model omissions, especially second-order coupling, strong coupling, exchange, relaxation distributions, concentration/temperature effects, imperfect pulses, receiver filters, decoupling artifacts, isotope distributions, and unknown impurities.
7. Never remove `synthetic` labels or use simulated output as a substitute for measured evidence.

Example simulation command:

```powershell
python scripts/simulate_1d.py model.json --output synthetic_ethanol --format varian
```

## Output contract

For interpretation, deliver:

- a concise conclusion answering the chemical question;
- acquisition/processing summary;
- peak-assignment table with confidence and alternatives;
- explicit integral calculations and uncertainty/caveats;
- artifact/quality assessment;
- decisive follow-up suggestions;
- links to processed CSV, figures, and report when files were created.

For MestReNova structure verification, additionally deliver:

- the prepared and assigned `.mnova` documents;
- the exact assignment-plan JSON and applied assignment JSON/CSV;
- the letter-label mapping and a visually checked assigned PDF/Mnova view;
- a target-structure verdict stated as supported, contradicted, or inconclusive;
- a list of unresolved or excluded signals;
- Mnova Verify results and license/status limitations, clearly separated from the manual evidence assessment.

For simulation, deliver:

- the synthetic raw-data directory/archive;
- the exact input peak model and metadata;
- preview spectrum and component table;
- readback/peak-location verification results;
- a prominent statement that the files are simulated rather than acquired.

## Boundaries

- Do not infer stereochemistry, connectivity, purity, or identity from one weak/overlapped signal alone.
- Do not report more chemical-shift or integral precision than the data supports.
- Do not use image pixel areas as quantitative integrals unless the user explicitly accepts an approximate digitization.
- Do not normalize to solvent, water, or exchangeable peaks without a justified response model.
- Do not call an absent peak proof of absence without a detection limit or adequate signal-to-noise.
- Treat 2D and solid-state datasets as expert review tasks; preserve raw dimensions and acquisition metadata, and do not force them through the 1D scripts.
- Do not overwrite the user's ChemDraw file, vendor raw data, prepared Mnova document, or an existing assignment plan.
- Do not label solvent, water, standards, impurities, or unresolved overlaps as target atoms merely to complete the structure.
