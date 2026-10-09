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
	// 连接状态（WebVPN / iWAN 两个独立控件）与「更多」菜单在桌面壳，统一 36px。
	const shell = await readFile(shellPath, "utf8");
	assert.match(shell, /id="webvpn-indicator"/);
	assert.match(shell, /id="iwan-indicator"/);
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

test("§5.1 精读产物固定名称，完成状态用统一填充色表达", async () => {
	const [project, redesign] = await Promise.all([read("components-project.js"), read("redesign.js")]);
	assert.match(project, /"data-kind": "reading", "data-done": readingDone \? "true" : "false"/);
	assert.match(project, /"data-kind": "ppt", "data-done": pptDone \? "true" : "false"/);
	// 完成态只靠填充色：不再额外加对号（现场反馈「已经标色了就不需要再加对号」）。
	assert.match(project, /readingBusy \? h\(SpinSvg, null\) : null/);
	assert.doesNotMatch(project, /CheckSvg/);
	// 固定名称不因完成状态改变，完成状态仍由已有产物决定。
	assert.match(redesign, /\.ib-overlay \.ib-act\{[^}]*justify-content:center;[^}]*min-width:84px/);
	assert.doesNotMatch(project, /打开精读|开始精读|制作 PPT|阅读译文/);
	assert.match(redesign, /\.ib-reading-acts \.ib-act\[data-done=true\]\{background:var\(--ib-accent\)/);
	assert.match(redesign, /\.ib-act\{[^}]*height:var\(--ib-action-h\)[^}]*font-size:14px/);
	// 加载态必须有加载图标。
	assert.match(redesign, /@keyframes ib-spin/);
});

test("条目操作全部平铺在右侧，原有功能不被藏进弹层", async () => {
	const [project, redesign, literature] = await Promise.all([
		read("components-project.js"), read("redesign.js"), read("components-literature.js"),
	]);
	// 不再有下拉菜单：现场发现弹层会被 DSH 的滚动容器裁切、跑到屏幕外，
	// 等于把「200 字简介」「删除条目」这些原有功能藏没了。
	assert.doesNotMatch(project, /MoreMenu|ib-more-menu|ib-more-item/);
	assert.doesNotMatch(literature, /ib-badge-menu|ib-more-item|setMenuOpen/);
	assert.doesNotMatch(redesign, /\.ib-more\b|\.ib-more-menu|\.ib-badge-menu/);
	// 宽面板为左标题、右操作；窄容器由同等优先级的容器规则换行。
	assert.match(redesign, /\.ib-overlay \.ib-lit-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
	// 恢复的功能：简介 + 删除条目（精读条目）、导出 RIS + 删除（检索条目）。
	// 按钮文案不写「200 字」——篇幅是给 Agent 的约束，不是给人看的标签。
	assert.match(project, /report\.id in overview \? "收起简介" : "简介"/);
	assert.doesNotMatch(project, /"200 字简介"/);
	assert.match(project, /className: "ib-act ib-act-danger"[^\n]*deleteReport\(report, bundle\)/);
	assert.match(project, /className: "ib-act ib-act-danger"[^\n]*deleteSearch\(search\)/);
	assert.match(project, /导出 RIS/);
	assert.match(redesign, /\.ib-act-danger\{color:#b42318/);
	// PDF / SI 一律是图标按钮：已归档点亮，未归档灰着（不写字）。
	assert.match(project, /className: "ib-icon-btn", "data-ready": bundlePdfUrl \? "true" : "false"/);
	assert.match(project, /className: "ib-icon-btn", "data-ready": bundleSiUrl \? "true" : "false"/);
	assert.doesNotMatch(project, /ib-sub-btn/);
	assert.match(project, /expanded \? "收起文献" : "查看文献"/);
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

test("新建对话：hero 里有课题选择框，且桌面 bootstrap 会设置默认预设", async () => {
	const [apply, hero, dshRs, component] = await Promise.all([
		read("apply.js"),
		read("hero-project.js"),
		readFile(fileURLToPath(new URL("../../desktop/src-tauri/src/runtime/dsh.rs", import.meta.url)), "utf8"),
		read("components-project.js"),
	]);
	// 现场反馈：新建对话只有工作目录与模式 chip，看不到/选不了这条对话的课题。
	assert.match(apply, /import \{ installHeroProjectChip, setHeroProjectRuntime \} from "\.\/hero-project\.js"/);
	assert.match(apply, /setHeroProjectRuntime\(\{/);
	assert.match(hero, /export function HeroProjectPicker/);
	assert.match(hero, /call\("projects_list"\)/);
	// ⚠️ 不能抢 hero 的槽位：两个都是 single 且被 DSH 占着（WorkspacePicker / 模式 chip），
	// 同优先级注册会抛错，而 applyUi 里抛错会被 Cordis 销毁整个注入上下文 →
	// 课题页全部 remote 调用变成 "cannot get required service remote in inactive context"
	// （2026-10-01 现场复现 + 本机 headless Chrome 复现）。也不能挂 input.dock
	// （那会变成输入框上方横幅，项目历史上明确否决过），所以走 DOM 注入。
	assert.doesNotMatch(apply, /slots\.register\(\{[\s\S]{0,120}name: "conversation\.(hero\.|input\.dock)/);
	assert.doesNotMatch(apply, /slots\.inject\(\{[\s\S]{0,80}conversation\.input\.dock/);
	assert.match(apply, /ctx\.effect\(\(\) => installHeroProjectChip\(\), "dsh-lab-agent: hero 课题选择框"\)/);
	assert.match(hero, /export function installHeroProjectChip\(\)/);
	assert.match(hero, /document\.querySelector\("\[class\*='_heroWorkspaceRow'\]"\)/);
	assert.match(hero, /new MutationObserver\(schedule\)/);
	// 旧断言（不许用 input.dock）仍然成立，等于同时钉住了"不抢槽位"和"不占横幅"。
	assert.doesNotMatch(apply, /conversation\.input\.dock/);
	// 选课题 = 先确保它有专属工作区，再在课题工作区里开/复用空白会话并切过去。
	assert.match(apply, /projects_ensure_workspace/);
	assert.match(apply, /ctx\.workspaces\.create\(\{ path: ensured\.path \}\)/);
	assert.match(apply, /projects_bind_workspace/);
	assert.match(apply, /ctx\.uiWorkspace\.connectWorkspace\(workspaceId\)/);
	// 只在新建对话那一屏渲染，普通对话里不出现；并且保留「其他工作目录」入口。
	assert.match(hero, /const blank = session === null \|\| session\.blank !== false/);
	assert.match(hero, /if \(!blank\) return null/);
	assert.match(hero, /其他工作目录/);
	// 默认预设：DSH 0.1.7 从 agent-preset-registry 行的 config.default 取，而那是
	// profile patch 层的内容；桌面 bootstrap 必须在启动 DSH 之前把它写成 lab-research，
	// 否则全新安装的第一次启动仍然是 standard。
	assert.match(dshRs, /configure_default_preset/);
	assert.match(dshRs, /configure-default-preset\.mjs/);
	assert.match(dshRs, /"--dsh-home"/);
	assert.match(dshRs, /configure_default_preset\(layout, &bundled_plugin, logger\)/);
	// 简介按钮不写「200 字」；PDF/SI 一律图标按钮（灰/亮）。
	assert.doesNotMatch(component, /"200 字简介"/);
});
