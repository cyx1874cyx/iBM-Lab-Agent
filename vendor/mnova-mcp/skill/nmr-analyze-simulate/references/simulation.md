# 1D FID simulation model

## Contents

- Model schema
- Peak expansion
- Signal model
- Vendor output
- Validation and limitations

## Model schema

Use UTF-8 JSON:

```json
{
  "experiment": {
    "title": "synthetic ethanol 1H NMR",
    "nucleus": "1H",
    "solvent": "CDCl3",
    "obs_mhz": 400.13,
    "carrier_ppm": 5.0,
    "spectral_width_hz": 6000.0,
    "complex_points": 16384,
    "scale": 10000.0,
    "noise_std": 0.001,
    "seed": 20260803,
    "reference_ppm": 7.26,
    "nt": 1,
    "d1_s": 1.0
  },
  "peaks": [
    {
      "label": "CH3",
      "ppm": 1.20,
      "area": 3.0,
      "linewidth_hz": 1.5,
      "multiplicity": "triplet",
      "j_hz": 7.1,
      "phase_deg": 0.0
    },
    {
      "label": "CH2",
      "ppm": 3.65,
      "area": 2.0,
      "linewidth_hz": 1.5,
      "multiplet_weights": [1, 3, 3, 1],
      "j_hz": 7.1
    },
    {
      "label": "residual CHCl3 reference",
      "ppm": 7.26,
      "area": 0.2,
      "linewidth_hz": 1.2
    }
  ]
}
```

Required experiment fields are `obs_mhz`, `carrier_ppm`, and `spectral_width_hz`. Defaults: `nucleus=1H`, `complex_points=16384`, `scale=10000`, `noise_std=0`, and a generated seed only when no seed is supplied. Always record the actual seed.

Required peak fields are `ppm`, `area`, and `linewidth_hz`. Use nonnegative area and positive linewidth. Optional fields are `label`, `phase_deg`, `multiplicity`, `multiplet_weights`, and `j_hz`.

Supported first-order multiplicity names are `s/singlet`, `d/doublet`, `t/triplet`, `q/quartet`, `quintet`, `sextet`, `septet`, and `octet`. Prefer explicit `multiplet_weights` when the intended intensities differ from Pascal weights.

## Peak expansion

Normalize component weights to sum to one. Center an n-line multiplet around `ppm` with adjacent spacing:

`delta_ppm = J_Hz / observation_frequency_MHz`

The declared group area remains the sum of component areas.

## Signal model

For each component k, generate a causal complex FID:

`s_k(t) = A_k exp(-pi LW_k t) exp(i(2 pi f_k t + phase_k))`

where `LW` is the Lorentzian full width at half maximum in Hz and:

`f_k = (carrier_ppm - peak_ppm) * observation_frequency_MHz`

Sum components, add seeded complex Gaussian noise in time domain, apply the declared scale, and store float32/complex64 output. This simple model gives Lorentzian lines and first-order splitting; it is not a spin-Hamiltonian simulation.

## Vendor output

The simulator always writes an open, generic complex FID plus metadata. With `--format varian`, also write a Varian/Agilent `.fid` directory through `nmrglue` and immediately read it back.

Use `--varian-template path/to/example.fid` when downstream VNMRJ software needs instrument-specific `procpar` entries. Use a template from the authorized local instrument, keep it unmodified, and replace identifying/acquisition-defining fields in the synthetic copy. Do not claim that generated vendor files reproduce console-specific receiver filters, pulse shapes, or hardware behavior.

## Validation and limitations

Validate all of the following:

- every component lies inside the modeled spectral window;
- all time-domain values are finite;
- the readback FID matches the written FID within float32 tolerance;
- the processed preview has the conventional decreasing-ppm axis;
- group/component areas and random seed are preserved in metadata;
- output filenames and metadata state `synthetic`.

Disclose that the model omits second-order/strong coupling, roof effects, relaxation distributions, chemical exchange, pulse excitation profiles, receiver/digital-filter response, radiation damping, decoupling sidebands, shimming distributions, concentration/temperature-dependent shifts, and unmodeled impurities unless explicitly implemented.
