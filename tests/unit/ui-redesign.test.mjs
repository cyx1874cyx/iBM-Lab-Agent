/**
 * dsh-lab-agent: 前端「简化与视觉改版」验收清单（需求 §2–§9）。
 *
 * 改版是纯界面调整，没有可自动点击的端到端用例（桌面壳 + WebView2 才能在
 * 本机跑起来），所以这里把需求文档里**可静态判定**的验收点逐条钉住：
 * 该出现的结构必须在，该删的重复容器 / 解释文字 / 常驻状态行必须不在。
 *
 * 判定对象是 client/src/*.js（源码契约，与 esbuild 产物解耦）与
 * desktop/src/index.html（桌面壳顶栏）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../../client/src", import.meta.url));
const read = (name) => readFile(join(srcDir, name), "utf8");

async function clientSource() {
	const names = (await readdir(srcDir)).filter((name) => name.endsWith(".js"));
	return (await Promise.all(names.map((name) => readFile(join(srcDir, name), "utf8")))).join("\n");
}

const shellPath = fileURLToPath(new URL("../../desktop/src/index.html", import.meta.url));

test("§2.1/§9 品牌去重：产品名只在侧栏保留一处", async () => {
	const [branding, project, shell, redesign] = await Promise.all([
		read("branding.js"), read("components-project.js"), readFile(shellPath, "utf8"), read("redesign.js"),
	]);
	// 侧栏：Logo + iBM Agent，无英文副标题。
	assert.match(branding, /<b>iBM Agent<\/b>/);
	assert.doesNotMatch(branding, /ib-brand-text"><b>iBM Agent<\/b><small>/);
	// 面板顶栏不再重复 Logo + 产品名 + Project Research Workspace。
	assert.doesNotMatch(project, /"iBM Lab Agent", h\("small", null, "Project Research Workspace"\)/);
	assert.doesNotMatch(project, /className: "ib-brand"/);
	// 桌面壳顶栏同样不再重复产品名。
	assert.doesNotMatch(shell, /class="brand"/);
	// 会话标题旁的预设标识（=「iBM科研 Agent」）被隐去。
	assert.match(redesign, /span\[class\*='_label'\]\{display:none/);
});

test("§2.2/§9 课题入口：图标 + 名称 + 下拉箭头，无英文标签与记忆版本", async () => {
	const [literature, redesign] = await Promise.all([read("components-literature.js"), read("redesign.js")]);
	assert.doesNotMatch(literature, /Research workspace|ib-badge-version|ib-badge-copy/);
	assert.match(literature, /className: "ib-badge-name"/);
	assert.match(literature, /className: "ib-badge-caret"/);
	assert.match(redesign, /\.ib-research-badge\{[^}]*height:var\(--ib-control-h\)/);
	assert.match(redesign, /\.ib-project-entry \.ib-badge-name\{[^}]*font-size:15\.5px;[^}]*font-weight:600/);
	// 紧凑状态入口（WebVPN + iWAN 合并）与「更多」菜单在桌面壳。
	const shell = await readFile(shellPath, "utf8");
	assert.match(shell, /id="status-entry"/);
	assert.match(shell, /id="more-menu"/);
	assert.match(shell, /height:36px/);
});

test("§3.1 课题页去嵌套：单行标签页 + 分组标题，无外层大框与副标题", async () => {
	const [project, redesign] = await Promise.all([read("components-project.js"), read("redesign.js")]);
	// 分类导航：三项单行标签，且不再有解释性副标题。
	assert.match(project, /const tabs = \[\s*\["literature", "文献资料"\], \["planning", "研究设计"\], \["characterization", "表征分析"\]\]/);
	assert.match(project, /tabs\.map\(\(\[id, label\]\) => h\("button", \{ className: "ib-tab"/);
	// 不再有 meta 副标题表 / 外层 ib-board 大框。
	assert.doesNotMatch(project, /const meta = \{ literature: \["文献资料"/);
	assert.doesNotMatch(project, /className: "ib-board"/);
	// 分组标题（保留条目数量）与条目列表直接铺在内容区。
	assert.match(project, /className: "ib-lit-group"/);
	assert.match(project, /className: "ib-group-head"/);
	assert.match(project, /className: "ib-group-count"/);
	// 标签页选中态用下划线。
	assert.match(redesign, /\.ib-tab\[data-active=true\]::after\{content:"";[^}]*background:var\(--ib-accent\)/);
});

test("§4 精读条目：短引用主标题 + 中文副标题，无独立状态行", async () => {
	const [project, redesign] = await Promise.all([read("components-project.js"), read("redesign.js")]);
	assert.match(project, /className: "ib-lit-title ib-citation"/);
	assert.match(project, /className: "ib-lit-zh"/);
	// 短引用：期刊斜体加粗由 CSS 表达，卷/页/年保持正体。
	assert.match(redesign, /\.ib-citation i\{font-style:italic;font-weight:700\}/);
	assert.match(redesign, /\.ib-lit-title\{[^}]*font-size:18px;[^}]*font-weight:600/);
	assert.match(redesign, /\.ib-lit-zh\{[^}]*font-size:16px;[^}]*font-weight:400/);
	// 中文标题缺翻译时保留原标题，不编造译名。
	assert.match(project, /const zhTitle = report\.titleZh \|\| bundle\.title \|\| null/);
	// 不再有「作者 · 期刊 · DOCX 已生成 …」这类独立状态行。
	assert.doesNotMatch(project, /artifactState/);
	assert.doesNotMatch(project, /className: "ib-lit-main"[^\n]*h\("small"/);
});

test("§5.1 完成状态用按钮填充色 + 完成图标表达", async () => {
	const [project, redesign] = await Promise.all([read("components-project.js"), read("redesign.js")]);
	assert.match(project, /"data-kind": "reading", "data-done": readingDone \? "true" : undefined/);
	assert.match(project, /"data-kind": "ppt", "data-done": pptDone \? "true" : undefined/);
	assert.match(project, /readingBusy \? h\(SpinSvg, null\) : \(readingDone \? h\(CheckSvg, null\) : null\)/);
	// 文字与颜色：开始精读/打开精读（青绿）、制作 PPT/打开 PPT（蓝）。
	assert.match(project, /readingDone \? "打开精读" : "开始精读"/);
	assert.match(project, /pptDone \? "打开 PPT" : "制作 PPT"/);
	assert.match(redesign, /\[data-done=true\]\[data-kind=reading\]\{background:var\(--ib-accent\)/);
	assert.match(redesign, /\[data-done=true\]\[data-kind=ppt\]\{background:var\(--ib-blue\)/);
	assert.match(redesign, /\.ib-act\{[^}]*height:var\(--ib-action-h\)[^}]*font-size:14px/);
	// 加载态必须有加载图标。
	assert.match(redesign, /@keyframes ib-spin/);
});

test("§5.2/§6 低频操作收进更多菜单，PDF/SI 用次级样式且未归档给「获取原文」", async () => {
	const [project] = await Promise.all([read("components-project.js")]);
	assert.match(project, /export function MoreMenu\(/);
	assert.match(project, /className: "ib-more-menu"/);
	assert.match(project, /导出 RIS（写入磁盘）/);
	assert.match(project, /label: "删除精读条目", danger: true/);
	// 检索条目突出「查看文献」，不再让每行都挂红色删除按钮。
	assert.doesNotMatch(project, /className: "ib-lit-btn", "data-danger": true/);
	assert.match(project, /expanded \? "收起文献" : "查看文献"/);
	assert.match(project, /className: "ib-sub-btn"/);
	assert.match(project, /bundlePdfUrl \? "正文 PDF" : "获取原文"/);
});

test("§7/§9 两段常驻解释文字与布局说明完整删除", async () => {
	const source = await clientSource();
	assert.doesNotMatch(source, /未获取原文时点击灰色 PDF\/SI 按钮/);
	assert.doesNotMatch(source, /每个会话汇总为一个检索条目和一个 RIS/);
	assert.doesNotMatch(source, /左侧检索记录 · 右侧精读档案与下载/);
	assert.doesNotMatch(source, /工作规划、实验方案与合成路线/);
	assert.doesNotMatch(source, /NMR 等结构表征和审核结果/);
});

test("§6/§9 字号整体放大，条目悬停用淡灰背景", async () => {
	const [redesign, project] = await Promise.all([read("redesign.js"), read("components-project.js")]);
	assert.match(redesign, /--ib-action-h:34px/);
	assert.match(redesign, /\.ib-overlay \.ib-group-head h3\{margin:0;font-size:17px;font-weight:600/);
	assert.match(redesign, /\.ib-project-copy h1\{font-size:22px;font-weight:600\}/);
	assert.match(redesign, /\.ib-lit-meta\{font-size:14\.5px/);
	assert.match(redesign, /\.ib-lit-item:hover\{background:var\(--ib-hover\)\}/);
	// 一屏显示更少条目：条目留白随字号同步增加，且不靠缩字换空间。
	assert.match(redesign, /\.ib-lit-item\{[^}]*padding:16px 2px/);
	assert.match(redesign, /\.ib-lit-title\{[^}]*white-space:normal/);
});

test("§9 原有检索/精读/文件获取/PPT/导出/删除功能仍可访问", async () => {
	const project = await read("components-project.js");
	for (const marker of [
		"tasks_search_ris", "tasks_search_delete", "tasks_report_delete",
		"onRequestArtifact(readingPrompt)", "onRequestArtifact(pptPrompt)",
		"armCaptureFor(event, bundle, \"pdf\")", "armCaptureFor(event, bundle, \"si\")",
		"ib-search-results", "openPreview({ kind: \"report\", report })", "openPreview({ kind: \"ppt\", report, presentation })"
	]) {
		assert.ok(project.includes(marker), `改版后仍必须保留：${marker}`);
	}
});
