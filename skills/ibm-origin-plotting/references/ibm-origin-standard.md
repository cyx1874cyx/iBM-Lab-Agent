# iBM Origin plotting standard

This reference operationalizes the Origin-specific rules shown in the iBM plotting-standard deck, from 《250902 iBM课题组作图规范参考2.pptx》 (11 slides), especially slides 2–11. Use the source deck when a later revision is supplied.

## 1. Rule language

- **MUST**: required for an iBM-compliant standard figure.
- **SHOULD**: source-backed default or recommendation; deviate only for a scientific or layout reason and report the deviation.
- **MAY**: contextual option.
- **Integrity override**: a source aesthetic suggestion must not distort data or conceal an analysis.

Do not promote incidental UI values such as layer left/top coordinates, dialog defaults, or the displayed Actual Size into universal requirements unless the slide text or a validated rule explicitly identifies them as such.

## 2. Standard single-panel contract

| Element | Rule | Level |
|---|---|---|
| Graph layer | 9 cm × 8 cm | MUST |
| Graph page | Fit tightly around all completed graph objects; no avoidable surrounding white space | MUST |
| Background | White | MUST |
| Font family | Arial throughout the Origin graph | MUST |
| Axis-title nominal size | 36 in Origin's Size field | MUST |
| Tick-label nominal size | 32 in Origin's Size field | MUST |
| Legend/in-graph nominal size | 32 in Origin's Size field | MUST |
| Element scaling | Scale With Layer Frame | SHOULD |
| Axis/frame thickness | 2–4 pt | MUST |
| Plot line width | 2–4 pt | MUST |

The 9 cm × 8 cm value belongs to the **layer**, not the page. Page size depends on tick labels, titles, legends, and annotations and must be fitted after those objects are finished.

### Origin sizing semantics

The source Size tab visibly selects **Scale With Layer Frame**. In LabTalk this is `layer.fixed=0`. Origin updates `layer.factor` as the layer is resized. Do not force Fixed Factor or `layer.factor=0.46` as an iBM requirement.

The source Tick Labels dialog shows nominal Size 32 and Actual Size 14.7. This demonstrates that nominal and rendered sizes can differ under layer-frame scaling. It does **not** establish 0.46 as a universal factor. Record the factor and actual appearance after final resizing; keep the required nominal fields at 36/32/32 for the standard layer.

For multi-panel figures or non-standard layer sizes, select readable sizes that preserve the axis-title > tick/legend hierarchy. Document the chosen geometry and nominal sizes; do not call the layout a standard 9 × 8 cm single panel.

## 3. Text, capitalization, and units

- **MUST** use Arial in the Origin graph.
- **MUST** use sentence case for ordinary multi-word labels: capitalize only the first word unless a proper noun, abbreviation, chemical name, or scientific convention requires otherwise.
- **MUST** place units in parentheses: `Wavelength (nm)`, `Time (s)`, `Concentration (μM)`.
- **MUST NOT** express the label-unit relationship with a slash such as `Wavelength/nm`.
- **MUST** preserve Greek letters, superscripts, subscripts, minus signs, and other scientific notation.
- **SHOULD** keep axis titles, legend labels, and annotations concise and non-redundant.

## 4. Page margins and geometry

- **MUST** set page margin control to `Tight` or use an equivalent verified fit-to-layer operation after all graph objects are placed.
- **MUST** inspect the exported result for both empty outer margins and clipping.
- **MUST** re-check the layer remains 9 cm × 8 cm after fitting the page.
- **MAY** allow the layer's left/top placement to change during page fitting; those coordinates are not standardized.

## 5. Axes, frames, scales, and ticks

### Lines and ticks

- **MUST** use 2–4 pt axis/frame thickness.
- **SHOULD** use black as the primary axis color.
- **MAY** color secondary axes when multiple Y axes need clear association with their data.
- **SHOULD** point major and minor ticks inward.
- **SHOULD NOT** show ticks on the top and right borders unless they convey needed scale information.
- **MUST** use Arial 32 for displayed numeric tick labels in the standard single panel.
- **MAY** hide Y numeric tick labels for relative intensity when absolute values have no meaning; retain honest relative scaling and explain it in the caption or handoff.

### Limits and increments

- **SHOULD** keep X limits close to the data so both ends do not contain gratuitous empty gaps.
- **SHOULD** choose major tick labels that are easy to read and calculate. Prefer multiples of ten when the data scale permits; avoid awkward endpoints such as 283 or 632 merely because they are raw extrema.
- **SHOULD** choose a readable 1–2–5 × 10^n increment and normally show about 4–7 major intervals. Scientific suitability takes priority over forcing a multiple of ten.
- **SHOULD** use about 3–4 minor ticks between adjacent major ticks when useful, with values that are easy to infer from the major increment.
- **MUST NOT** add minor ticks arbitrarily.
- **SHOULD** adjust X/Y spacing for multi-curve figures so trends remain separable.
- **MUST** avoid a truncated or broken scale that exaggerates an effect. Make any justified axis break visible.

## 6. Curves and plot groups

### Group behavior

- Use `Dependent` when the group should share coordinated styles.
- Use `Independent` when series require individual treatment.
- After applying group styling, verify each series remains distinguishable and scientifically mapped to the intended data.

### Connection and smoothing

- **SHOULD** use `Straight` as the default connection.
- **MUST NOT** use Spline or B-Spline merely to suppress visible noise or make the curve look prettier.
- **MAY** use a smoothing or interpolating analysis only when the user requests it or the scientific method requires it. Preserve the raw series, disclose the method and parameters, and visually distinguish the derived result.

This integrity rule intentionally narrows the source slide's cosmetic Spline suggestion: an attractive curve is not allowed to imply measurements that were not made.

### Line patterns and widths

- **SHOULD** use Solid for a single curve.
- For multiple curves, prefer `Solid`, `Dash`, `Dash Dot`, `Dash Dot Dot`, and `Short Dash`.
- **SHOULD NOT** use dot-dominant patterns: `Dot`, `Short Dot`, or `Short Dash Dot`.
- **MUST** keep final plot-line width within 2–4 pt.

The source deck contains an internal conflict: slide 9 recommends width values 1.0, 1.2, 1.4, and 1.6 by pattern, while slide 10 explicitly requires Width 2–4. Preserve slide 9's pattern recommendations, but do not treat its numeric widths as hard requirements. The later explicit 2–4 pt rule governs final compliance.

### Colors and redundant encoding

- **SHOULD** use deep, high-contrast colors such as `Black`, `Red`, `Blue`, `Olive`, `Dark Cyan`, `Orange`, `Wine`, `Violet`, and `Royal`.
- **SHOULD NOT** use light colors such as `Yellow`, `Cyan`, `Green`, and `LT Cyan` on white.
- **MUST** distinguish multiple series by more than color when feasible: also vary line pattern or symbol.
- **MAY** repeat line patterns when there are many curves, but use different colors to maintain identity.
- **MUST** re-render and change an assignment when contrast is inadequate.

## 7. Legends and annotations

- **SHOULD** hide the legend for a single self-explanatory series.
- **MUST** show a legend when series identity is otherwise ambiguous.
- **SHOULD** use a frameless legend with short, meaningful labels consistent with worksheet long names.
- **MUST** use Arial nominal 32 for legend and in-graph text in the standard single panel.
- **MUST** prevent legends and annotations from covering data, error bars, fit curves, or uncertainty bands.

## 8. Data integrity

- **MUST** keep source data unchanged.
- **MUST** record transformations and parameters.
- **MUST** include supplied uncertainty when the intended claim depends on it.
- **MUST NOT** infer units, error type, or statistical meaning from an ambiguous column name.
- **MUST NOT** remove points, normalize, baseline-correct, interpolate, fit, or smooth without disclosure.

## 9. Output, editability, and templates

- **MUST** retain an editable Origin graph/project for publication-facing work.
- **MUST**, when delivering a data PPT under slide 2, embed an Origin OLE object and test its double-click reopening. PNG/PDF plus a separate OPJU does not satisfy this PPT requirement. If OLE is unavailable, deliver the editable project and explicitly mark PPT embedding incomplete.
- **MUST NOT** substitute only a screenshot when editable Origin output is required.
- **SHOULD** export vector PDF/SVG for manuscript workflows that accept it.
- **SHOULD** export high-resolution PNG/TIFF for preview or raster-only destinations.
- **MUST** confirm requested outputs exist and are non-empty.
- **MAY** save a verified finished graph as a reusable template when requested.
- **MUST** avoid overwriting an existing group template without explicit authorization.

## 10. Source evidence map

| Source | Explicit evidence |
|---|---|
| Slide 2 | Origin graphs in data PPT must be embedded editable objects that reopen on double-click; an image is insufficient |
| Slide 3 | 9 × 8 cm layer; Arial; sentence case; nominal 36/32/32; units in parentheses; round axis numbers; deliberate 3–4 minor ticks; Scale With Layer Frame shown |
| Slide 4 | Page Margin Control = Tight; no surrounding blank area |
| Slide 5 | Axis/frame 2–4 pt; black primary; multi-Y colors; inward ticks recommended; top/right ticks generally hidden |
| Slide 6 | Tight data range; suitable X/Y spacing; iterate scale choices |
| Slide 7 | Arial tick labels, nominal 32; Actual Size 14.7 shown; relative-intensity Y labels may be hidden |
| Slide 8 | Dependent versus Independent group styling |
| Slide 9 | Straight connection; preferred and discouraged line patterns; legacy pattern values |
| Slide 10 | Plot width 2–4; deep palette; avoid light colors |
| Slide 11 | Save and reuse user graph templates |

## 11. Compliance checklist

### MUST pass

- [ ] The scientific question and column roles are clear.
- [ ] Source data remain unchanged; analyses are disclosed.
- [ ] A standard single layer is 9.0 cm × 8.0 cm (allow ≤0.005 cm read-back rounding on Origin 2025b).
- [ ] The graph page is tight and no object is clipped.
- [ ] Origin graph text is Arial.
- [ ] Standard nominal sizes are axis title 36, ticks 32, legend/in-graph 32.
- [ ] Axis/frame and plot widths are 2–4 pt.
- [ ] Units use parentheses, not a slash.
- [ ] No arbitrary minor ticks or misleading axis limits are present.
- [ ] Multiple series are identifiable and adequately contrasted.
- [ ] No undisclosed smoothing or transformation occurred.
- [ ] Necessary legends are readable and non-overlapping.
- [ ] Rendered preview and actual export were inspected.
- [ ] Editable OPJU and requested exports exist and are non-empty.

### SHOULD verify or justify

- [ ] Scale With Layer Frame is active and the resulting actual typography is readable.
- [ ] Ticks point inward; unnecessary top/right ticks are absent.
- [ ] Major labels are round and easy to calculate.
- [ ] Minor ticks are deliberate, normally 3–4 when useful.
- [ ] Straight/solid defaults and the deep palette are used unless the data requires otherwise.
- [ ] A single self-explanatory series has no unnecessary legend.

## 12. Delivery gate

Call a standard single-panel result **iBM-compliant** only when every applicable MUST item was set and verified by read-back, diagnostics, rendered inspection, or file inspection as appropriate. A setter response alone is not verification.

If a MUST property cannot be read back, mark it **unverified** and call the result an **iBM-aligned draft**. Report justified deviations from SHOULD rules without falsely treating them as hard failures.
