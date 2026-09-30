// 课题作为右侧栏「资源 tab」的契约：寻址规则、每课题一标签、以及装配面。
//
// 寻址规则在 client/src/project-address.js（无 React 依赖，可直接 import）；
// 带 React 的 project-tab.js 只在源码层做契约断言——仓库 node_modules 里没有 react
// （由 DSH ModuleLoader 运行时注入），带 React 的模块无法在测试进程里加载。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const addressHref = pathToFileURL(fileURLToPath(new URL("../../client/src/project-address.js", import.meta.url))).href;
const address = () => import(addressHref);

test("课题地址是资源地址：每个课题一个 contentId，因此每个课题一个 tab", async () => {
	const api = await address();

	// 资源 tab 的 contentId 就是地址本身，地址里必须带上课题 id。
	const first = api.projectAddress("proj-alpha");
	const second = api.projectAddress("proj-beta");
	assert.notEqual(first, second, "不同课题必须得到不同地址，否则会被去重成同一个 tab");
	assert.equal(api.projectIdOf(first), "proj-alpha");
	assert.equal(api.projectIdOf(second), "proj-beta");

	// id 里的特殊字符必须往返一致（否则 id 里带空格/斜杠的课题会串台）。
	for (const id of ["plain", "with space", "a/b", "中文课题", "x?y#z", "p-1_2.3"]) {
		assert.equal(api.projectIdOf(api.projectAddress(id)), id, `id 往返失败：${id}`);
	}
});

test("课题地址只认自己这一种，坏输入不抛异常", async () => {
	const api = await address();
	for (const foreign of [
		"dsh-resource://file/session/s1/home/me/a.md",
		"sidebar://lab-project",
		"lab-project/p1",
		"",
		undefined,
		null,
	]) {
		assert.equal(api.projectIdOf(foreign), undefined, `不应认领：${String(foreign)}`);
	}
	// 空前缀之后为空 → 不是有效课题 id。
	assert.equal(api.projectIdOf(api.PROJECT_ADDRESS_PREFIX), undefined);
	// 百分号编码损坏不能把异常抛到渲染层。
	assert.equal(api.projectIdOf(`${api.PROJECT_ADDRESS_PREFIX}%zz`), undefined);
});

test("认领模式必须覆盖本类型的全部地址（含 \":\" 才会按整条地址匹配）", async () => {
	const api = await address();
	assert.equal(api.PROJECT_PATTERNS.length, 1);
	const pattern = api.PROJECT_PATTERNS[0];
	// 含 ":" 是右侧栏按整条地址匹配的前提；不含就退化成只匹配 URI path，永远匹配不上。
	assert.ok(pattern.includes(":"), "模式必须含 \":\" 才会按整条地址匹配");
	assert.ok(
		pattern.startsWith(api.PROJECT_ADDRESS_PREFIX),
		"模式必须以地址前缀开头，否则 openResource 会因为「没有类型认领」抛错",
	);

	// 用右侧栏真正使用的匹配器（picomatch）实测；它是传递依赖，缺失时跳过而不是误报。
	let picomatch;
	try {
		picomatch = createRequire(import.meta.url)("picomatch");
	} catch {
		picomatch = undefined;
	}
	if (picomatch === undefined) return;
	const match = picomatch(pattern, { nocase: true, dot: true });
	for (const id of ["p1", "with space", "中文课题", "a/b"]) {
		assert.equal(match(api.projectAddress(id)), true, `模式应命中：${id}`);
	}
	assert.equal(match("dsh-resource://file/session/s1/home/me/a.md"), false, "模式不得吃掉文件资源");
});

test("装配面是资源 tab：openResource + patterns，且不贡献 guide 条目", async () => {
	const [tab, apply, badge] = await Promise.all([
		read("client/src/project-tab.js"),
		read("client/src/apply.js"),
		read("client/src/components-literature.js"),
	]);

	// 资源类型必须有 patterns；页面类型才靠 openTab(kind)。
	assert.match(tab, /patterns:\s*PROJECT_PATTERNS/);
	assert.match(tab, /ctx\.slots\.inject\("sidebar\.right\.pane\.tab"/, "正文必须注册到右侧栏 tab 座位");
	assert.match(tab, /ctx\.slots\.inject\("sidebar\.right\.pane\.tab\.title"/, "标签条要显示课题名，必须注册标题座位");
	// guide 条目点开走 openTab(kind)（页面语义），对本资源类型是无效地址——不能贡献。
	const definition = tab.match(/ctx\.sidebarRightTabs\.register\(\{([\s\S]*?)\n\t\}\)/);
	assert.ok(definition, "必须能提取 tab 类型定义");
	assert.doesNotMatch(definition[1], /guide/, "资源类型不得贡献 guide 条目");

	// 打开器必须是 openResource(address)，不是 openTab(kind)。只断言函数体，
	// 不看文件里作为反例的说明性注释。
	const opener = tab.match(/export function openProjectTab\(projectId\) \{[\s\S]*?\n\}/);
	assert.ok(opener, "必须存在 openProjectTab");
	assert.match(opener[0], /openResourceAction\(projectAddress\(id\)\)/);
	assert.doesNotMatch(opener[0], /openTab\(/, "打开器必须走资源语义，不能走页面语义的 openTab");
	assert.match(apply, /setProjectTabOpener\(\(address\) => tabCtx\.sidebarRight\.openResource\(address\)\)/);
	// 右侧栏服务单独注入，缺失时只有这一项能力缺失。
	assert.match(apply, /ctx\.inject\(\["slots", "sidebarRightTabs", "sidebarRight"\]/);
	// 课题读取走既有 remote，不新增 host 服务。
	assert.match(apply, /call\("projects_get", \{ request: \{ id: projectId \} \}\)/);

	// 入口就是课题徽章本身（不是旁边另加一个按钮）：点它在右侧栏开该课题的标签页。
	// 右侧栏不可用时回落到原有全屏面板，不能点了没反应。
	assert.match(badge, /onClick: \(\) => \{\s*\n\s*if \(openProjectTab\?\.\(bound\.project\.id\)\) return;/);
	assert.match(badge, /openWorkspace\(bound\.project\)/, "回落路径必须打开原有面板");
	// 本次改版 §2.1：入口标题不再写英文/记忆版本；按钮结构是
	// 「课题图标 + 课题名称 + 下拉箭头」，标题里带上课题名。
	assert.match(badge, /title: `打开课题空间：\$\{projectName\}`/);
	assert.doesNotMatch(badge, /Research workspace|记忆 v|ib-badge-version/);
	assert.match(badge, /ib-badge-caret/);
	// 不再有上一轮那个多余的旁挂按钮。
	assert.doesNotMatch(badge, /ib-project-tab-btn/);
});

test("tab 正文里嵌的是真正的课题空间页面，不是只读摘要", async () => {
	const [tab, apply, styles] = await Promise.all([
		read("client/src/project-tab.js"),
		read("client/src/apply.js"),
		read("client/src/styles.js"),
	]);

	// 渲染器由 apply.js 注入，复用现有 Project 组件（全屏面板里的同一页）。
	assert.match(tab, /export function setProjectPanelRenderer\(fn\)/);
	assert.match(tab, /renderPanel = typeof fn === "function" \? fn : null/);
	assert.match(tab, /return h\("div", \{ className: "ib-project-tab-embed" \}, renderPanel\(projectId\)\)/);
	assert.match(apply, /setProjectPanelRenderer\(\(projectId\) => h\("div", \{ className: "ib-overlay ib-panel-embed" \}/);
	assert.match(apply, /h\(Project, \{/, "必须复用 Project，而不是另写一份课题页面");
	// Project 只用到 project.id，所以按 id 构造即可，正文不必先预取一次课题。
	assert.match(apply, /project: \{ id: projectId \}/);
	// 「← 所有课题」在侧栏里没有列表可回 → 打开全屏管理页。
	assert.match(apply, /onBack: \(\) => open\(null\)/);

	// 全屏定位必须被压掉：两个类一起用，优先级高于单类 .ib-overlay，不依赖书写顺序。
	assert.match(styles, /\.ib-overlay\.ib-panel-embed\{position:static;inset:auto;z-index:auto/);
	// 多列栅格在侧栏窄列里必须收敛成单列，否则会横向溢出。按实际规则逐条点名，
	// 不用宽松回退——那等于没测。
	const embedGrid = styles.match(/\.ib-panel-embed \.ib-grid[^{]*\{([^}]*)\}/);
	assert.ok(embedGrid, "必须有一组嵌入模式的栅格收敛规则");
	assert.match(embedGrid[1], /grid-template-columns:minmax\(0,1fr\)/);
	for (const cls of ["ib-grid", "ib-artifacts", "ib-memory", "ib-lit"]) {
		assert.ok(
			embedGrid[0].includes(`.ib-panel-embed .${cls}`),
			`嵌入模式必须把 ${cls} 收敛成单列，否则在 360–560px 的侧栏列里会溢出`,
		);
	}
	// 三个业务选项是例外：人工审核要求保持一排三个，不能被收敛掉。
	assert.ok(
		!embedGrid[0].includes(".ib-panel-embed .ib-tabs"),
		"文献资料/研究设计/表征分析 必须保持一排三个",
	);
	assert.match(styles, /\.ib-panel-embed \.ib-tabs\{gap:6px\}/);
	// 侧栏里不该再出现全屏抽屉式的宽度。
	assert.match(styles, /\.ib-panel-embed \.ib-preview-drawer\{width:min\(560px,94vw\)\}/);
});
