/**
 * dsh-lab-agent: 模板填充指南（GUIDE.md）生成器 —— 纯格式化，无 IO。
 *
 * 目的：新同学/Agent 拿到一份模板时，不必读源码、不必问人，就知道
 *   「这一页用哪个版式、每个槽位要填什么、排版政策是什么、改模板该怎么做」。
 * 内容全部来自 manifest + slots.json + lint.json（唯一事实来源），所以模板一换、
 * 指南自动跟着变 —— 这就是「加一个模板 = 丢一份 pptx → 生成 manifest + lint 报告
 * → 按报告改模板，不需要写代码」的落地形式。
 */

const SEVERITY_LABEL = { error: "error", warning: "warning", info: "info" };

/** 表格单元格里不允许出现换行/竖线，避免把 markdown 表格撑坏。 */
function cell(text) {
	return String(text ?? "").replace(/[\r\n|]+/g, " ").trim();
}

/** 生成 GUIDE.md 内容。 */
export function renderTemplateGuide({
	template = {},
	slotSpec,
	lintReport,
	manifestInfo = {},
	cliVersion
} = {}) {
	const lines = [];
	const name = template.name ?? template.id ?? "(未命名模板)";
	lines.push(`# 模板填充指南：${name}`);
	lines.push("");
	lines.push(`> 本文件由 manifest 自动生成，**不要手工维护**：改模板后重新导入即会更新。`);
	lines.push("");
	lines.push("| 项 | 值 |");
	lines.push("| --- | --- |");
	lines.push(`| 模板 | ${cell(template.id)}@${cell(template.version)} ${cell(template.name)} |`);
	lines.push(`| 受众 / 用途 | ${cell(template.audience)} / ${cell(template.purpose)} |`);
	lines.push(`| 页面比例 / 最大页数 | ${cell(template.pageSize?.ratio)} / ${cell(template.maxPages ?? "不限")} |`);
	lines.push(`| 必选页 | ${cell((template.requiredPages ?? []).join("、") || "（无）")} |`);
	lines.push(`| manifest | ${cell(manifestInfo.manifestDir ?? "manifest/")}（pptx-cli ${cell(cliVersion ?? "?")} 生成，sha256 ${cell(String(manifestInfo.sha256 ?? "").slice(0, 12))}） |`);
	lines.push(`| 槽位规范 | slots.json（Agent 可读可改，改前先看 docs/PPT_TEMPLATE_SPEC.md） |`);
	lines.push(`| 体检报告 | lint.json |`);
	lines.push("");

	lines.push("## 一、三步走（不要写代码）");
	lines.push("");
	lines.push("1. 按下面的「角色 → 版式」表决定每一页用哪个版式（`slides[].role`）；");
	lines.push("2. 按「每个槽位要填什么」把内容写进 `plan.json`：");
	lines.push("");
	lines.push("```json");
	lines.push('{ "requiredPages": ["cover", "abstract", "summary"], "notesRequired": true,');
	lines.push('  "slides": [ { "role": "figure-1",');
	lines.push('      "slots": { "figure": "fig1.png", "caption": "Fig.1 …", "analysis": "…（一到两个自然段）" },');
	lines.push('      "notes": "这一页的讲稿" } ] }');
	lines.push("```");
	lines.push("");
	lines.push("3. 编译 + 构建（两条命令；构建脚本自己执行中文排版政策）：");
	lines.push("");
	lines.push("```bash");
	lines.push("node scripts/compile-ppt-plan.mjs --plan plan.json --template <本模板目录> --out compiled.json");
	lines.push("python scripts/pptx/build_from_template.py \\");
	lines.push("  --template <本模板目录>/source.pptx --parse <本模板目录>/parse.json \\");
	lines.push("  --compiled compiled.json --out deck.pptx --report conformance.json");
	lines.push("```");
	lines.push("");

	lines.push("## 二、角色 → 版式");
	lines.push("");
	lines.push("| 角色（plan.slides[].role） | layout id | 版式名 | 槽位 |");
	lines.push("| --- | --- | --- | --- |");
	for (const layout of slotSpec?.layouts ?? []) {
		if (!layout.role) continue;
		const keys = (layout.slots ?? []).map((slot) => `${slot.key}${slot.required ? "" : "?"}`).join(", ");
		lines.push(`| ${cell(layout.role)} | ${cell(layout.layoutId)} | ${cell(layout.layoutName)} | ${cell(keys)} |`);
	}
	lines.push("");
	lines.push("`?` = 可选槽位。");
	lines.push("");

	lines.push("## 三、每个槽位要填什么");
	lines.push("");
	for (const layout of slotSpec?.layouts ?? []) {
		if (!layout.role || (layout.slots ?? []).length === 0) continue;
		lines.push(`### ${layout.role}（版式 ${cell(layout.layoutName)} / \`${cell(layout.layoutId)}\`）`);
		lines.push("");
		lines.push("| 槽位 | 必填 | 类型 | 容量 | 提示文字（定位键） | 怎么填 |");
		lines.push("| --- | --- | --- | --- | --- | --- |");
		for (const slot of layout.slots ?? []) {
			const capacity = slot.kind === "image"
				? "按占位区域等比缩放"
				: `${slot.capacityLines ?? "?"} 行 / ${slot.fontPt ?? "?"}pt${slot.belowFontFloor ? "（低于下限，构建器会抬到下限）" : ""}`;
			lines.push(`| ${cell(slot.key)} | ${slot.required ? "必填" : "可选"} | ${cell(slot.kind)} | ${cell(capacity)} | ${cell(slot.prompt)} | ${cell(slot.usage)} |`);
		}
		lines.push("");
	}
	for (const layout of slotSpec?.layouts ?? []) {
		if (layout.role) continue;
		lines.push(`> ⚠️ 版式 \`${cell(layout.layoutId)}\`（${cell(layout.layoutName)}）没有识别出角色：Agent 不会自动填它。`);
		lines.push("");
	}

	lines.push("## 四、排版政策（构建器强制执行，不要试图绕过）");
	lines.push("");
	lines.push(`- 字体三槽：中文 \`a:ea=${cell(slotSpec?.policy?.fonts?.ea ?? "微软雅黑")}\`、西文 \`a:latin=${cell(slotSpec?.policy?.fonts?.latin ?? "Arial")}\`、复杂文种 \`a:cs=${cell(slotSpec?.policy?.fonts?.cs ?? "Arial")}\`；`);
	lines.push(`- 字号下限：${cell(slotSpec?.policy?.minFontPt ?? 20)}pt（小于它的 run 一律抬到下限，模板里的小字不会带进成品）；`);
	lines.push("- 分点：摘要、图文解读、总结段落等 `mode=paragraph` 的槽位一律剥掉项目符号；创新点（`mode=bullets`）保持分点；");
	lines.push("- 静态层：底图、上边线、logo、页标题由**版式**提供，绝对不要在内容里重复画；静态元素的位置/尺寸受指纹门控。");
	lines.push("");

	lines.push("## 五、体检报告摘要");
	lines.push("");
	if (lintReport === undefined) {
		lines.push("尚无 lint.json：先跑 `node scripts/lint-ppt-template.mjs <模板目录>`。");
	} else {
		lines.push(`- error ${lintReport.summary?.error ?? "?"}（其中必须修 ${lintReport.summary?.blocking ?? "?"}，构建器兜住 ${lintReport.summary?.compensatedErrors ?? "?"}）、warning ${lintReport.summary?.warning ?? "?"}、info ${lintReport.summary?.info ?? "?"}；`);
		const blocking = (lintReport.findings ?? []).filter((finding) => finding.severity === "error" && finding.compensated !== true).slice(0, 8);
		for (const finding of blocking) {
			lines.push(`- **必须修** \`${cell(finding.code)}\`：${cell(finding.message)}`);
		}
		const compensated = (lintReport.findings ?? []).filter((finding) => finding.compensated === true).slice(0, 8);
		for (const finding of compensated) {
			lines.push(`- 构建器兜住 \`${cell(finding.code)}\`：${cell(finding.message)}`);
		}
	}
	lines.push("");

	lines.push("## 六、怎么改模板（不需要写代码）");
	lines.push("");
	lines.push("1. 在 PowerPoint 里改 `.pptx`（**只改版式层**：占位符位置/提示文字/字体/字号；静态元素不要动）；");
	lines.push("2. 交一份新文件导入 → 系统自动生成 `manifest/`、`slots.json`、`GUIDE.md`、`lint.json`；");
	lines.push("3. 打开 `lint.json`，按 **必须修** 的条目改模板，重新导入，直到 `ok: true`；");
	lines.push("4. 提示文字是定位键：**改提示文字等于改槽位身份**，需要同步告知 Agent（或保留原提示文字）；");
	lines.push("5. 规范细节（角色约定、槽位命名、容量、静态层要求）见 `docs/PPT_TEMPLATE_SPEC.md`。");
	lines.push("");
	return lines.join("\n");
}

/** 从 lint 报告里取「必须修的 error」条数（供 UI/工具一行展示）。 */
export function blockingErrorCount(lintReport) {
	return (lintReport?.findings ?? []).filter((finding) => finding.severity === "error" && finding.compensated !== true).length;
}

export { SEVERITY_LABEL };
