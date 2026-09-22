// dsh-lab-agent：课题主页面作为 DSH 右侧栏的「资源 tab」——每个课题一个标签页。
//
// 为什么是**资源 tab**而不是页面 tab：右侧栏的页面 tab 身份只由 kind 决定
// （`pageAddress(kind) = sidebar://<kind>`，`params` 完全不参与身份），所以一个 kind
// 只能有一个页面 tab——用 `openTab("lab-project", { params: { projectId } })` 打开第二个
// 课题只会聚焦第一个。资源 tab 的 contentId 就是地址本身，因此
// `dsh-resource://lab-project/<projectId>` 能让每个课题各占一个 tab。
// 完整论证见 docs/PROJECT_AS_SIDEBAR_TAB_EVALUATION.md。
//
// 地址匹配已实测：patterns 里含 ":" 的模式按**整条地址**用 picomatch 匹配
// （`dsh-resource://lab-project/**` 命中 `dsh-resource://lab-project/proj-1`，
// 不命中 `dsh-resource://file/...`）。
import { useEffect, useState } from "react";
import { h } from "./h.js";
import { PROJECT_ADDRESS_PREFIX, PROJECT_PATTERNS, PROJECT_TAB_ID, PROJECT_TAB_KIND, projectAddress, projectIdOf } from "./project-address.js";

// 寻址规则（含「为什么必须是资源 tab」）在 project-address.js，那里无 React 依赖、
// 可被 Node 直接单测。这里原样再导出，调用方不必关心拆分。
export { PROJECT_ADDRESS_PREFIX, PROJECT_PATTERNS, PROJECT_TAB_ID, PROJECT_TAB_KIND, projectAddress, projectIdOf };

// ── 装配面（由 apply.js 注入，保持本模块不依赖 ctx）─────────────────────────
let openResourceAction = null;
let loadProject = null;
let openPanelAction = null;

/** 打开器：`(address) => void`，来自 ctx.sidebarRight.openResource。 */
export function setProjectTabOpener(fn) {
	openResourceAction = typeof fn === "function" ? fn : null;
}

/** 课题读取器：`(projectId) => Promise<project|null>`。 */
export function setProjectLoader(fn) {
	loadProject = typeof fn === "function" ? fn : null;
}

/** 完整面板打开器：`(project) => void`，复用现有全屏课题面板。 */
export function setProjectPanelOpener(fn) {
	openPanelAction = typeof fn === "function" ? fn : null;
}

/**
 * 在右侧栏打开（或聚焦）某个课题的 tab。
 *
 * 资源 tab 按 (kind, contentId) 去重，而 contentId 就是地址，所以天然是「每课题一标签」，
 * 重复调用只会聚焦已打开的那个。
 *
 * @returns 右侧栏服务不可用、或课题 id 无效时返回 false。
 */
export function openProjectTab(projectId) {
	const id = String(projectId ?? "").trim();
	if (!openResourceAction || !id) return false;
	try {
		openResourceAction(projectAddress(id));
		return true;
	} catch (reason) {
		console.warn("[dsh-lab-agent] 打开课题 tab 失败", reason);
		return false;
	}
}

// ── 课题名缓存 ─────────────────────────────────────────────────────────────
// tab 标题由 title(address) 在打开时捕获，而那是同步接口、课题名要查一次 remote。
// 因此用一份模块级缓存 + 订阅：正文与标题座位谁先拿到名字都能让另一边更新。
const projectNames = new Map();
const nameListeners = new Set();

/** 记录课题名（幂等）。 */
export function publishProjectName(projectId, name) {
	const id = String(projectId ?? "");
	if (!id || typeof name !== "string" || !name) return;
	if (projectNames.get(id) === name) return;
	projectNames.set(id, name);
	for (const listener of nameListeners) listener();
}

/** 已缓存的课题名；未加载过返回 undefined。 */
export function projectNameOf(projectId) {
	return projectId === undefined ? undefined : projectNames.get(projectId);
}

function useProjectName(projectId) {
	const [, bump] = useState(0);
	useEffect(() => {
		const listener = () => bump((value) => value + 1);
		nameListeners.add(listener);
		return () => { nameListeners.delete(listener); };
	}, []);
	return projectNameOf(projectId);
}

/** 确保课题名已加载（标题座位对未激活的 tab 也会渲染，需要自己触发）。 */
function ensureProjectName(projectId) {
	if (projectId === undefined || projectNames.has(projectId) || !loadProject) return;
	Promise.resolve()
		.then(() => loadProject(projectId))
		.then((project) => { if (project?.name) publishProjectName(projectId, project.name); })
		.catch(() => {});
}

/** 右侧栏面板里的图标：一个侧栏轮廓，用于「在侧栏打开课题」按钮。 */
export function ProjectTabGlyph({ width = 14, height = 14 } = {}) {
	return h("svg", { viewBox: "0 0 16 16", width, height, fill: "none", stroke: "currentColor", "stroke-width": "1.4", "aria-hidden": "true" },
		h("rect", { x: "1.6", y: "2.6", width: "12.8", height: "10.8", rx: "2" }),
		h("line", { x1: "10.2", y1: "2.6", x2: "10.2", y2: "13.4" }));
}

const STATUS_LABEL = { active: "进行中", archived: "已归档", closed: "已结束" };

function row(label, value, title) {
	return h("div", { className: "ib-project-tab-row" },
		h("span", null, label),
		h("b", { title: title ?? (typeof value === "string" ? value : undefined) }, value));
}

/**
 * tab 正文：课题摘要（只读）。
 *
 * 这是评估里「先打通每课题一标签的通路」的第一步——紧凑视图，不改动现有全屏面板的
 * 布局假设。需要完整编辑能力时点「打开完整面板」。
 */
export function ProjectTabBody({ useTabInfo }) {
	const { tab } = useTabInfo();
	const projectId = projectIdOf(tab?.contentId);
	const revision = tab?.navigation?.revision ?? 0;
	const [state, setState] = useState({ status: "loading" });
	const cachedName = useProjectName(projectId);

	useEffect(() => {
		if (projectId === undefined) { setState({ status: "invalid" }); return undefined; }
		if (!loadProject) { setState({ status: "unavailable" }); return undefined; }
		let disposed = false;
		setState({ status: "loading" });
		Promise.resolve()
			.then(() => loadProject(projectId))
			.then((project) => {
				if (disposed) return;
				if (!project) { setState({ status: "missing" }); return; }
				publishProjectName(projectId, project.name);
				setState({ status: "ready", project });
			})
			.catch((reason) => {
				if (!disposed) setState({ status: "error", message: reason?.message || String(reason) });
			});
		return () => { disposed = true; };
	}, [projectId, revision]);

	if (state.status === "invalid") {
		return h("div", { className: "ib-project-tab ib-project-tab-note" }, "这个标签页不是课题地址，无法显示课题内容。");
	}
	if (state.status === "unavailable" || state.status === "loading") {
		return h("div", { className: "ib-project-tab ib-project-tab-note" }, "正在读取课题…");
	}
	if (state.status === "missing") {
		return h("div", { className: "ib-project-tab ib-project-tab-note" }, "该课题已不存在（可能已被删除）。");
	}
	if (state.status === "error") {
		return h("div", { className: "ib-project-tab ib-project-tab-note" }, `读取课题失败：${state.message}`);
	}

	const { project } = state;
	const goal = project.goalProfile;
	const template = project.template;
	return h("div", { className: "ib-project-tab" },
		h("div", { className: "ib-project-tab-head" },
			h("b", { title: project.name }, project.name || cachedName || project.id),
			h("span", { className: "ib-chip" }, STATUS_LABEL[project.status] || project.status || "—")),
		h("div", { className: "ib-project-tab-rows" },
			row("课题编号", project.id || "—"),
			row("核心记忆", `v${project.memoryVersion || "1"}`),
			row("工作区", project.workspacePath || "尚未建立", project.workspacePath),
			row("精读目标", goal ? `${goal.id}@${goal.version}` : "—"),
			row("阅读模板", template ? `${template.id}@${template.version}` : "—"),
			row("创建", project.createdAt ? new Date(project.createdAt).toLocaleDateString() : "—"),
			row("更新", project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : "—")),
		h("div", { className: "ib-project-tab-foot" },
			h("button", {
				className: "ib-btn",
				disabled: !openPanelAction,
				title: openPanelAction ? "打开全屏课题面板" : "课题面板当前不可用",
				onClick: () => { try { openPanelAction?.(project); } catch { /* 面板打开失败不应影响侧栏 */ } }
			}, "打开完整面板")));
}

/** tab 标题座位：把课题名写进标签条（页面 tab 的 title() 只在打开时捕获一次）。 */
export function ProjectTabTitle({ useTabInfo }) {
	const { tab } = useTabInfo();
	const projectId = projectIdOf(tab?.contentId);
	const name = useProjectName(projectId);
	useEffect(() => { ensureProjectName(projectId); }, [projectId]);
	return h("span", { className: "ib-project-tab-title", title: name || projectId || "" }, name || "课题");
}

/**
 * 注册课题资源 tab 类型、正文与标题座位。
 *
 * 刻意**不贡献 guide 条目**：guide 条目是「按类型」的一条入口，点开走的是
 * `openTab(kind)`（页面 tab 语义，地址 `sidebar://<kind>`），对本资源类型是无效地址；
 * 课题的入口由「在侧栏打开课题」按钮（带 projectId）承担。
 *
 * @param ctx - Cordis 装配面（sidebarRightTabs / slots / effect）。
 */
export function registerProjectTab(ctx) {
	ctx.effect(() => ctx.sidebarRightTabs.register({
		id: PROJECT_TAB_ID,
		kind: PROJECT_TAB_KIND,
		// 含 ":" → 按整条地址匹配；实测命中 dsh-resource://lab-project/<id>。
		patterns: PROJECT_PATTERNS,
		priority: "extension",
		// 打开时捕获，此时通常还没查到课题名；实时名称由下面的标题座位补上。
		title: () => "课题"
	}), "dsh-lab-agent: 课题 tab 类型");
	ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
		name: "sidebar.right.pane.tab",
		key: PROJECT_TAB_ID
	}, ProjectTabBody)), "dsh-lab-agent: 课题 tab 正文");
	ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
		name: "sidebar.right.pane.tab.title",
		key: PROJECT_TAB_ID
	}, ProjectTabTitle)), "dsh-lab-agent: 课题 tab 标题");
	ctx.effect(() => () => {
		setProjectTabOpener(null);
		setProjectLoader(null);
		setProjectPanelOpener(null);
	}, "dsh-lab-agent: 课题 tab 装配面注销");
}
