---
name: ibm-origin-plotting
description: Create, restyle, audit, template, and export scientific figures in Origin/OriginPro through the Origin MCP server using the iBM group plotting standard. Use for CSV, TSV, TXT, DAT, XLS, XLSX, OPJU, or existing Origin graphs when the user asks to 按课题组规范作图, 修改或检查 Origin 图, make a publication-ready scientific plot, create multi-panel figures, preserve editable Origin output, build a reusable graph template, or verify iBM compliance.
---

# iBM Origin Plotting

Build scientifically honest Origin figures, apply the iBM visual standard, verify the rendered result, and retain editable source artifacts.

## Reference routing

- Read [iBM Origin standard](references/ibm-origin-standard.md) completely before creating, restyling, or auditing a figure.
- Read [Origin MCP playbook](references/origin-mcp-playbook.md) completely before changing Origin, using FigureSpec, saving a template, or troubleshooting a tool route.
- Read [tested workflow and known limits](references/tested-workflow.md) before exporting, saving, or handling a plotting failure.
- For a pure policy question that does not touch Origin, the standard reference is sufficient.

## Precedence and guardrails

Apply rules in this order:

1. Follow the user's explicit scientific intent and target-journal requirements.
2. Preserve data integrity and prevent misleading presentation.
3. Enforce the standard's **MUST** rules.
4. Apply **SHOULD** rules unless the data or figure structure justifies a documented deviation.
5. Use templates, themes, and aesthetic presets only as starting points.

Never alter source data in place. Put calculated or transformed values in a new worksheet or output file. Treat smoothing, interpolation, normalization, baseline correction, fitting, and point removal as analyses, not decoration. Do not perform them unless requested or scientifically necessary; preserve the raw series and disclose the method and parameters.

## Workflow

### 1. Establish the figure contract

Determine the scientific question, chart type or comparison, X/Y/error/group columns, units, output destination, and whether the user wants analysis, a reusable template, or only a visual audit. Inspect ambiguous data before asking; stop only when competing interpretations would change the scientific claim.

For every task, distinguish:

- a standard single-panel figure;
- a multi-panel, inset, dual-Y, or other non-standard layout;
- an audit of an existing graph.

The standard single-panel geometry is a **9 cm × 8 cm graph layer**, not a 9 cm × 8 cm page. Multi-panel figures may use other layer sizes and proportionate typography; document the chosen hierarchy instead of pretending they use the single-panel dimensions.

### 2. Connect and inspect

Snapshot the current project, active folder/window and target graph before mutation. For workflow tests create a uniquely named test folder; never replace, close or reset the user project. Restore the original active folder/window in `finally`. Resolve actual object names returned by tools; never assume `Graph1`.

1. Call `origin_ping` or `origin_capabilities`; call `origin_doctor` if the connection fails.
2. Import table data with `origin_import_table` when needed.
3. Run `origin_diagnose_worksheet` and read representative rows with `origin_read_worksheet`.
4. Verify column roles, units, types, missing values, and error columns.
5. Use `origin_recommend_chart` when the chart type is not specified.
6. Search for a matching verified user template before rebuilding a common group figure.

### 3. Plan before mutating

Use a declarative FigureSpec for supported single-panel, grid, custom-grid, inset, or dual-Y work. Call `origin_plan_figure_spec`, inspect column validation and unsupported operations, and execute only when the plan is valid. If FigureSpec cannot express a required feature, use the specific safe editing tool in the playbook.

Plan the final labels, limits, ticks, legend need, palette, redundant series encodings, layer geometry, exports, and QA checks. Do not mistake the FigureSpec page canvas or a Nature-style preset for the exact iBM finish.

### 4. Build and apply the exact finish

Create the graph with FigureSpec, `origin_plot`, `origin_plot_auto`, a dedicated plot tool, or a verified template. Then explicitly apply the standard:

- set a standard single layer to 9 cm × 8 cm;
- use `Scale With Layer Frame` for the demonstrated default (`layer.fixed=0`), not a forced fixed factor;
- set Arial and nominal Origin sizes 36 for axis titles and 32 for tick labels, legend text, and in-graph text;
- use sentence case and put units in parentheses;
- set axis/frame and plot strokes within 2–4 pt;
- choose honest axis limits, deliberate major/minor ticks, inward ticks, and appropriate top/right tick visibility;
- default to straight connections and solid lines;
- distinguish multiple series by deep color plus line pattern or symbol;
- place or remove the legend according to whether it carries necessary identity;
- after all labels and objects are placed, fit the graph page tightly around them.

Apply typography after any theme, template, merge, or layer-resize operation that may change element scaling. Do not force `layer.factor=0.46`: the supplied source shows `Scale With Layer Frame`, and the displayed Actual Size of 14.7 is an observed scaled result, not a universal fixed-factor requirement.

### 5. Verify structurally and visually

Use all available layers of evidence:

1. Inspect graph and layer structure with `origin_get_graph_info` and, when exposed, `origin_get_layer_info`.
2. Run `origin_diagnose_graph` when available.
3. Read back every automatable hard property after the final theme/template/resize operation.
4. Render with `origin_view_graph` and inspect typography, white space, overlap, clipping, contrast, curve visibility, and legend placement.
5. Export a PNG preview and inspect the actual export; a correct Origin window is not proof of a correct export.
6. Re-run the checklist in the standard reference and iterate until no material defect remains.

For a standard single panel, verify at minimum:

- layer unit is centimetres and layer width/height are 9.0/8.0 (read-back tolerance 0.005 cm);
- `Scale With Layer Frame` is active (`layer.fixed=0`); record the current factor only as diagnostic state;
- Arial nominal sizes are 36/32/32;
- axis/frame and plot strokes are 2–4 pt;
- the page is tight without clipping any graph object;
- no undisclosed transformation occurred;
- the editable project and requested exports exist and are non-empty.

Do not claim exact compliance from a successful setter, a theme name, a template name, or appearance alone. If a required property cannot be read back, label it **unverified**. Call the result an **iBM-aligned draft** rather than **iBM-compliant** when any MUST rule remains unverified or failed.

### 6. Save, export, and template

Use a project-saving API for `.opju`; `save -i` saves an active window (`.oggu` for graphs), not a project. OGGU is an editable graph format, not evidence of a license lock. To preserve an open user project while saving a test, export only the owned Project Explorer folder with `pe_save` and verify the file.

For a data PPT, separately verify embedded Origin OLE editing by double-click in a dedicated empty Origin session. Closing an activated OLE presentation can terminate Origin and its bridge; never perform that lifecycle test in the user working project. Never call the PPT requirement complete solely because OPJU and PNG files exist.

Save an `.opju` project for publication-facing work and whenever editability or reproducibility matters. Export the requested vector and/or high-resolution raster formats and confirm each file exists and is non-empty.

Save a reusable graph template only when the user asks for one or the task explicitly updates the group template. Save it only after the compliance gate passes, and add searchable metadata for plot types, data roles, column count, and intended use. Never overwrite an existing group template without explicit authorization.

## Safe fallback policy

Prefer declared MCP tools. If a required editing or read-back tool is absent:

1. Discover the exact capability in the `standard` or `full` Origin MCP profile.
2. Query the local Origin knowledge base.
3. Prefer a verified template when it expresses the requirement.
4. Use `origin_run_labtalk` only for syntax verified against Origin documentation or the installed Origin MCP source.
5. Re-read the active graph name after `graph_not_found`; do not silently continue on another graph.
6. Stop before a compliance claim when a MUST property still cannot be set or verified.

Never invent a property path or LabTalk command from memory.

## Handoff

Report the graph name, source file and selected columns, transformations or an explicit statement that none were applied, OPJU path, export paths, verified geometry and typography, scale mode, template used or saved, deviations from the standard, and unverified items.
