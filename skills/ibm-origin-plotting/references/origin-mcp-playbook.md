# Origin MCP playbook

## Contents

1. Tool routing
2. Data and FigureSpec planning
3. Exact iBM finishing sequence
4. Property verification
5. Multi-panel and template workflows
6. Safe fallbacks
7. QA and delivery

## 1. Tool routing

Use the highest-level route that fully expresses the task:

1. `origin_recommend_chart` for a recommendation without creating a graph.
2. `origin_search_templates` when a saved group template may match.
3. `origin_plan_figure_spec` then `origin_execute_figure_spec` for supported declarative work.
4. `origin_plot_auto` for a simple one-shot chart when full planning adds no value.
5. `origin_plot` or a dedicated plot tool when the chart type is known.
6. Graph-editing tools for exact geometry, axes, plots, legends, and QA.
7. `origin_run_labtalk` only for a property whose syntax has been verified.

The compact profile exposes common data, plot, preview, and export tools. Discover the `standard` or `full` profile when exact editing/read-back tools such as `origin_get_layer_info`, `origin_set_axis`, `origin_set_plot_style`, `origin_apply_nature_style`, `origin_format_legend`, or `origin_diagnose_graph` are absent.

Do not use `origin_set_graph_page(width=9, height=8, unit="cm")` to satisfy the iBM layer requirement. That tool targets the graph page, while the standard fixes the graph **layer** at 9 cm × 8 cm.

## 2. Data and FigureSpec planning

Before plotting:

1. Connect with `origin_ping` or `origin_capabilities`.
2. Import with `origin_import_table` when needed.
3. Run `origin_diagnose_worksheet` on the plotted columns.
4. Read enough rows with `origin_read_worksheet` to confirm types, units, missing values, monotonic X behavior where relevant, and error-column meaning.
5. Reject an empty worksheet or all-null plotted column. Treat warnings according to their scientific effect.

Use absolute paths in FigureSpec. Set explicit data roles, axis titles, limits or auto-limit intent, plot types, group styles, export paths, and QA requirements. Call `origin_plan_figure_spec` first. Do not execute when column validation fails or an unsupported operation would alter the intended figure.

FigureSpec page setup is only an initial canvas. A Nature theme is only a first-pass style. The exact iBM layer geometry, scale mode, typography, strokes, ticks, margins, and verification happen afterward.

## 3. Exact iBM finishing sequence

Apply this order after graph creation. Repeating the order matters because themes, templates, merges, and layer resizing can overwrite or rescale later properties.

### 3.1 Resolve the actual graph and layer

Read the current project or `origin_get_graph_info` response and use the returned graph name. After any `graph_not_found`, inspect again; never assume `Graph1`.

For a standard figure, target the intended single layer. For multi-layer work, identify each layer explicitly before changing geometry.

### 3.2 Apply a base style

Optionally apply `origin_apply_nature_style` or `style_mode="nature"` as a starting point with Arial, nominal 36/32/32, a starting line width within 2–4 pt, zero transparency, and series differentiation. Never stop here or claim that the theme equals the iBM standard.

### 3.3 Set the standard layer geometry and scale mode

Prefer a declared layer-geometry tool if the installed profile exposes one. Otherwise use this Origin-documented LabTalk property route on the verified active layer:

```labtalk
layer.unit=3;
layer.width=9;
layer.height=8;
layer.fixed=0;
```

Origin documents `layer.unit=3` as centimetres, `layer.width`/`layer.height` as the layer-frame dimensions, and `layer.fixed=0` as checked `Scale With Layer Frame`.

Do not set `layer.factor=0.46`. With `layer.fixed=0`, Origin updates the factor when the layer is resized. Read and report the current factor only as diagnostic state.

### 3.4 Reapply exact typography

Use the exposed typography tools first. If a verified LabTalk fallback is required, set the axis-title objects and legend directly, and set tick-label properties only through a path confirmed in the installed Origin version:

```labtalk
xb.font=font(Arial);
yl.font=font(Arial);
xb.fsize=36;
yl.fsize=36;
legend.font=font(Arial);
legend.fsize=32;
```

For Origin versions where they read back correctly, the bottom/left tick-label paths may be `layer.x.label.font`, `layer.y.label.font`, `layer.x.label.pt`, and `layer.y.label.pt`. Verify them before use. Do not use an unverified `layer.*.ticklabel` path.

Apply Arial nominal 32 to other displayed axes, legends, and in-graph annotations. Preserve sentence case, symbols, superscripts/subscripts, and units in parentheses.

### 3.5 Set axes and ticks

Use `origin_set_axis` for scale, limits, major step, and title. Choose a readable 1–2–5 × 10^n step, prefer round labels when suitable, and avoid empty end ranges. For bar/column charts, normally include zero unless the scientific convention requires otherwise.

Use an exposed axis-style tool for 2–4 pt frame lines, inward major/minor ticks, minor count, and top/right visibility. If unavailable, query the local knowledge base before a LabTalk fallback. Do not infer that a setter changed all four axes.

### 3.6 Style plots and groups

Use `origin_set_plot_style` or the relevant chart-specific tool. For line plots:

- default to Straight and Solid;
- use width 2–4 pt;
- use deep colors from the standard;
- use allowed non-dot patterns for multiple series;
- add marker or pattern redundancy when color alone is insufficient;
- keep transparency at 0 unless the chart type, such as an uncertainty band, requires it.

Use Dependent group editing for coordinated styles and Independent for per-series control. Verify every series after a group operation.

Never use Spline/B-Spline as a styling shortcut. If smoothing is requested, run a declared analysis such as `origin_run_analysis(analysis="smooth", ...)`, preserve the raw series, record method and parameters, and plot the derived series distinctly.

### 3.7 Format the legend and annotations

Use `origin_format_legend` when available. Hide an unnecessary single-series legend; otherwise use Arial nominal 32, no frame, concise labels, and a non-overlapping position. Place all annotations before fitting the page.

### 3.8 Fit the page tightly

After all objects are final, use the documented X-Function route:

```labtalk
pfit2l margin:=tight;
```

This fits the graph page to include the completed layer and graph objects. Re-read the layer geometry afterward; the layer must remain 9 cm × 8 cm for a standard single panel. Inspect the exported image because hidden or detached objects can affect bounds.

## 4. Property verification

Use `origin_get_graph_info`, `origin_get_layer_info`, diagnostics, and targeted read-back tools when available. If an exact getter is absent, use a documentation-backed LabTalk query and capture the returned values.

Verify after the final theme/template/resize operation:

| Property | Standard single-panel expectation |
|---|---|
| Layer unit | 3 / cm |
| Layer width × height | 9.0 × 8.0 |
| Scale mode | `layer.fixed=0` / Scale With Layer Frame |
| Scale factor | Record current value; no fixed required value |
| Axis-title font | Arial, nominal 36 |
| Tick-label font | Arial, nominal 32 |
| Legend/in-graph font | Arial, nominal 32 |
| Axis/frame and plot strokes | 2–4 pt |
| Page bounds | Tight, all objects included |
| Content | No empty layer, clipping, overlap, or misleading scale |

On supported Origin versions, `xb.fsize` and `yl.fsize` read axis-title nominal size, while tick-label properties may be available through `layer.x.label.pt` and `layer.y.label.pt`. Treat a failed property read as an interface limitation, not evidence that the requested value was applied.

The displayed Actual Size may differ from nominal size under layer-frame scaling. Evaluate readability in the rendered and exported figure; do not replace nominal 36/32 values with the observed actual values.

## 5. Multi-panel and template workflows

### Multi-panel figures

Use FigureSpec, `origin_merge_graphs`, `origin_create_graph_layout`, or `origin_arrange_layers` as appropriate. Define rows, columns, gaps, shared scales, and panel labels deliberately. Then:

1. Apply consistent layer geometry and element-scaling policy.
2. Choose proportional nominal sizes that remain readable.
3. Reapply typography and strokes after merge/arrange operations.
4. Align axes and shared labels.
5. Fit and inspect the full page.
6. Report that the layout uses an adapted multi-panel standard rather than standard 9 × 8 cm single-panel geometry.

### Reusable templates

Before plotting, call `origin_search_templates` with intended plot type, roles, data shape, and keywords when available. Reuse only a template whose match reasons fit the request.

After a verified graph passes QA, use `origin_save_graph_template` only when requested. Supply a clear name, description, tags, plot types, roles, and column-count metadata. Confirm before replacing an existing template. Reapply data-specific titles, scales, legend text, and QA whenever a template is reused.

## 6. Safe fallbacks

Use this sequence for a missing exact control:

1. Discover the exact MCP tool and broader profile.
2. Query `origin_query_knowledge` or browse the local Origin knowledge collection.
3. Inspect the installed Origin MCP tool schema or source when necessary.
4. Prefer a verified template for stable repeated formatting.
5. Use `origin_run_labtalk` only with verified syntax.
6. Read back the result and inspect the render.
7. If the property remains unverifiable, report it and stop short of a compliance claim.

Do not guess parameter names, property paths, line-style indices, color indices, or LabTalk syntax.

## 7. QA and delivery

Use all three QA layers:

- structural: graph/layer/plot inspection and exact property read-back;
- diagnostic: worksheet and graph diagnostics;
- visual: `origin_view_graph` plus inspection of an actual exported PNG.

Save the `.opju` project before final export when editability matters. Export requested PDF/SVG/TIFF/PNG formats, verify the files are non-empty, and use adequate raster resolution.

The final handoff must state:

- graph name;
- source path and selected columns;
- transformations/analyses or `none`;
- OPJU and export paths;
- verified layer geometry, nominal typography, and scale mode;
- template used or saved;
- deviations and unverified rules;
- whether the result is `iBM-compliant` or an `iBM-aligned draft`.
