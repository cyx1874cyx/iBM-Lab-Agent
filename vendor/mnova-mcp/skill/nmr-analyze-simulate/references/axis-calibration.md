# Raw-data axis calibration

Use this reference when raw FID processing and Mnova disagree about the chemical-shift axis.

## Start from format semantics

- Read Varian/Agilent data through `nmrglue.varian.read`. In the nmrglue implementation, the binary header `np` is the number of stored real-valued elements, while the returned direct dimension is normally complex and has `np / 2` points.
- Use the returned array shape as the time-domain complex-point count. Do not infer that count a second time from file size or multiply/divide it until the result looks plausible.
- Read `sw`, `sfrq`, `rfl`, `rfp`, `at`, and related values from `procpar`. Preserve both raw values and interpreted units in processing metadata.
- For Bruker, remove the digital filter before Fourier transformation and derive the axis from acquisition metadata through nmrglue's unit-conversion facilities where possible.

The local nmrglue source identifies its underlying Varian references as *VnmrJ / VNMR FID Data Format* and *VnmrJ User Programming, Chapter 5: Parameters and Data*. Consult the installed nmrglue source and those vendor documents when field semantics remain unclear.

## Cross-calibrate instead of trying scale factors

When an independently processed spectrum and Mnova disagree:

1. Keep processing parameters fixed, including zero filling and FFT ordering.
2. Match at least three well-resolved peaks that span the useful spectral range. Avoid solvent shoulders, overlap, and uncertain peak centers.
3. Store their processed point indices and Mnova ppm values in CSV:

```csv
point_index,reference_ppm
812,7.260
6451,3.642
11904,0.912
```

4. Run `scripts/calibrate_axis.py pairs.csv --output axis-calibration.json`.
5. Inspect slope sign, RMS residual, maximum residual, and each pair. A poor residual usually means a mismatched peak, different FFT ordering/zero filling, or a nonlinear processing mismatch.
6. Apply the fitted `ppm = intercept + slope * point_index` only to the exact processed array used to create the matched indices. Record the pair table and calibration JSON with the result.

The fitted slope is a diagnostic for that dataset and processing state. It is not evidence for a universal factor such as `sw/n`, `sw/(2n)`, or `sw/(4n)`. Do not convert a successful fit into a vendor-wide constant without verifying the vendor's documented definitions and the processing library's point conventions.
