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

	// 入口：课题徽章旁边一个按钮；右侧栏不可用时回落到原有全屏面板，不能点了没反应。
	assert.match(badge, /openProjectTab\?\.\(bound\.project\.id\)/);
	assert.match(badge, /openWorkspace\(bound\.project\)/, "回落路径必须打开原有面板");
});
