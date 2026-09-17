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
6. Read [references/axis-calibration.md](references/axis-calibration.md) only when processing raw vendor data or diagnosing a chemical-shift-axis mismatch.

## Interpret a spectrum

1. Work on a copy or write all outputs to a new directory. Do not modify vendor raw data.
2. Record nucleus, solvent, field strength, temperature, pulse program, scans, acquisition time, relaxation delay, spectral width, and reference when available. Mark missing metadata.
3. Before scientific processing, run `scripts/preflight_nmr.py INPUT` or, inside iBM Lab Agent, call `lab_characterization_preflight`. Use the selected interpreter for every subsequent helper. The preflight must confirm `numpy`, `scipy`, `matplotlib`, and `nmrglue`, read the dataset through the vendor reader, report the returned data shape and key acquisition metadata, and state whether Mnova can access the input path. Do not switch interpreters later or install dependencies into the analysis-output directory.
4. Process 1D raw FIDs with `scripts/process_1d.py` using the interpreter returned by preflight. Use nmrglue's vendor reader and the returned complex-array shape; do not independently guess real-versus-complex point counts from the binary file.
5. Inspect the full spectrum before zooming into diagnostic regions. Check phase, baseline, truncation/ringing, solvent suppression, clipping, digital-filter artifacts, water/solvent peaks, and signal-to-noise.
6. Reference against a stated internal standard, residual solvent, or known signal. Do not silently assume a reference.
7. If an independent processed axis and Mnova disagree beyond the precision needed for assignment, keep processing fixed and cross-calibrate at least three well-resolved peaks spanning the spectrum with `scripts/calibrate_axis.py`. Inspect residuals and mismatches before applying the fit. Treat the resulting slope and intercept as specific to that processed array; never try a sequence of scale factors or hardcode a successful factor as a Varian/Bruker rule. Stop assignment and report unresolved calibration if the regression is not acceptably linear.
8. Build a peak table with chemical shift/range, multiplicity, J values when resolved, integral, tentative assignment, evidence, alternatives, and confidence.
9. Test assignments against all constraints: proton/carbon count, symmetry, multiplicity, coupling, integration, expected shift, exchange, overlap, isotope labeling, and the proposed structure or reaction.
10. Separate conclusions into:
   - directly observed;
   - strongly supported assignment;
   - tentative/ambiguous assignment;
   - not assessable from the supplied data.
11. For quantitative claims, show the normalization signal and formula. Integrate target-product signals and only those non-product signals explicitly required as quantitative comparators. Do not display or use integrals for evidence-classified product-unrelated impurities. Check relaxation delay, saturation, overlap, baseline, and response assumptions before reporting conversion, composition, DP, or purity.
12. Recommend the smallest decisive follow-up experiment, such as a longer relaxation delay, more scans, COSY, HSQC, HMBC, DEPT/APT, DOSY, variable temperature, spike-in, or an orthogonal method.

Example raw-data command:

```powershell
python scripts/process_1d.py "C:\data\sample.fid" --output "C:\data\sample_analysis" --reference-ppm 7.260 --reference-window 7.1 7.4
```

When a known signal-free range is available, add `--noise-window LOW HIGH`; otherwise the script estimates noise from the quietest distributed spectral blocks.

Treat the generated peak list as a measurement aid, not an automatic chemical assignment.

Use the provided helpers before writing a diagnostic script. When a new diagnostic is still necessary, keep one small script with explicit inputs and machine-readable output, then either promote repeated logic into `scripts/` or remove the disposable file after use. Do not maintain several competing scripts that re-derive the same axis.

## Assign and verify in MestReNova

Use the Mnova MCP as a two-stage, auditable workflow. Do not jump directly from a structure image or predicted shifts to labels in the final document.

Inside iBM Lab Agent, when the user supplies FID/ZIP and a structure file directly in the conversation and no characterization task exists, call `lab_characterization_submit` first. Pass the two attachment paths and omit metadata that can be inferred. Continue with the returned task ID through the idempotent `lab_characterization_preflight`, `lab_characterization_update(status="running")`, Mnova preparation/application, and `lab_characterization_complete`. Do not ask the user to create the task in the panel. The completion tool accepts a Markdown report and archives an automatically generated DOCX; pass Mnova-returned name/SMILES in `compound` so the archived identity is complete. Also pass `assessment` with `verdict` (`match`, `mismatch`, or `inconclusive`), overall `confidence` (`high`, `medium`, or `low`), and a concise evidence summary. This confidence describes confidence in the structure verdict, not workflow completion. If an already completed result is revised, use `lab_characterization_recomplete`; it preserves the prior artifacts and registers the new hashes.

Use the project and Mnova workspace paths returned by preflight. If the input is already accessible to Mnova, pass it directly; do not copy files into a guessed global workspace. If it is inaccessible, copy only the required inputs into the reported workspace and record the source-to-copy mapping.

1. Require the measured NMR input and a machine-readable structure. Prefer the original ChemDraw `.cdx` or `.cdxml`; `.mol`, `.sdf`, `.mrv`, `.cml`, `.smi`, and `.inchi` are acceptable fallbacks. A PNG copied from ChemDraw is not a structure file.
2. Call `mnova_status`. Do not assume Mnova is installed on `C:`. The MCP searches the configured `MNOVA_EXE`, Windows registry, `PATH`, Program Files variables, and common paths on every local fixed drive. If the executable is unavailable, inspect `mcp_version` and `mnova_discovery.checked_candidates`; ask for the full `MestReNova.exe` path and set `MNOVA_EXE` in the environment that launches the MCP server, then restart it. Do not claim that setting `$env:MNOVA_EXE` in an unrelated terminal changes an already managed server. Stop the Mnova route only after this recovery step fails; continue with file-based interpretation if that still answers the request.
3. Call `mnova_prepare_structure_1d` with the NMR path and structure path. This opens both inputs in one Mnova document, processes the 1D spectrum, exports atoms and their valid proton indices, exposes stable peak/multiplet UUIDs, optionally runs Mnova Verify, and saves `prepared.mnova` without touching the raw data.
4. Inspect the returned molecule identity (`smiles`/`inchi` when available), nucleus, solvent/reference, spectral quality, integrals, multiplets, and Verify warnings. Treat Mnova's automatic assignments as hypotheses, not approved labels.
5. Build a separate assignment-plan JSON from the returned `atoms[].index`, `atoms[].non_equivalent_h_indices`, and `multiplets[].uuid`. Rebuild it after every prepare call from that call's analysis; never reuse atom indices or multiplet UUIDs from another structure file, hash, import, or prepare job. Give every written assignment one lowercase letter in `label` (`a` through `z`, then `aa`, `ab`, ...), plus the observed ppm/range, `high` or `medium` confidence, and a concise evidence statement. Assign labels by a chemically readable traversal of the structure, not by ppm order. Put low-confidence, solvent, water, reference, impurity, unexplained, or non-uniquely resolved signals in `unresolved`. For every unresolved multiplet, record its observed ppm/range, `classification`, `integration_policy`, and evidence-based `reason`. Use `integration_policy: "exclude"` for a product-unrelated impurity; use `review` for an unknown peak rather than hiding it merely because it is unassigned.
6. Validate the plan against the exact preparation analysis before applying it:

```powershell
python scripts/validate_mnova_assignment_plan.py analysis.json assignment-plan.json
```

7. Call `mnova_apply_assignments_1d` with `prepared.mnova` and the validated plan. Keep `allow_low_confidence=false` unless the user explicitly accepts speculative labels. The tool links molecule atoms/protons to real Mnova multiplet UUIDs, reruns Verify when available, restores the audited plan, removes displayed integrals whose unresolved items are marked `exclude`, replaces structure numbers with lowercase letters, places matching blue labels horizontally and directly above the assigned peaks, hides verbose multiplet detail boxes, and saves a new `assigned.mnova`. It requests blue structure-number text, but some Mnova assignment themes override that color; preserve the letters and report the actual rendered color after visual QA.
8. Confirm that `applied_assignment_count` equals the intended count and that the returned assignments and `display_labels` refer to the planned labels, atom/h targets, and multiplet UUIDs. Check `integration_cleanup`: every evidence-classified product-unrelated impurity must appear in `excluded_regions`, its overlapping displayed integral must be absent, and no unknown peak may have been excluded merely because it is unassigned. If an excluded impurity shares one integral region with a target signal, treat the whole integral as contaminated and omit it from quantitative normalization unless deconvolution or orthogonal evidence supports separation. Inspect the assigned PDF or Mnova document visually with an available image-viewing tool: a structure label and its peak label must be identical; coincident labels must be comma-joined without spaces (for example `k,l`); labels must not sit in the top chemical-shift pick row. If visual inspection is unavailable, mark `visual_qa: not_completed`, state what remains unchecked, and do not claim a visually verified result. If any mapping, placement, or integral cleanup differs, do not present the document as complete.
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
- the preflight result, including the selected interpreter, vendor reader, returned data shape, and path-access status;
- acquisition/processing summary;
- the matched-peak table and calibration JSON when cross-calibration was required;
- peak-assignment table with confidence and alternatives;
- explicit integral calculations and uncertainty/caveats;
- artifact/quality assessment;
- decisive follow-up suggestions;
- links to processed CSV, figures, and report when files were created.

For MestReNova structure verification, additionally deliver:

- the prepared and assigned `.mnova` documents;
- the exact assignment-plan JSON and applied assignment JSON/CSV;
- the letter-label mapping, assigned PDF/Mnova view, and explicit `visual_qa` status;
- a target-structure verdict stated as supported, contradicted, or inconclusive;
- a list of unresolved or excluded signals;
- the `integration_cleanup` audit, including excluded regions and any target region contaminated by a removed integral;
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
- Do not integrate product-unrelated impurities in the clean assigned Mnova view or include them in target-signal normalization. Retain a non-product signal only when it is explicitly required for a stated quantitative calculation, such as conversion or qNMR.
- Do not classify an unexplained peak as an unrelated impurity solely to suppress its integral; unknown peaks remain visible and use `integration_policy: "review"`.
- Do not call an absent peak proof of absence without a detection limit or adequate signal-to-noise.
- Treat 2D and solid-state datasets as expert review tasks; preserve raw dimensions and acquisition metadata, and do not force them through the 1D scripts.
- Do not overwrite the user's ChemDraw file, vendor raw data, prepared Mnova document, or an existing assignment plan.
- Do not label solvent, water, standards, impurities, or unresolved overlaps as target atoms merely to complete the structure.
