// dsh-lab-agent：新建对话（blank session）里的「课题选择框」。
//
// 为什么需要它：新建对话时 DSH 的 hero 行只有「工作目录」chip 与模式 chip，
// 用户看不出这条对话属于哪个课题，也没法在这里切课题（现场反馈：
// 「新建对话……也没有对应课题的选择框」）。
//
// 为什么不占槽位：hero 行的两个槽位（conversation.hero.workspace / .agentPreset）
// 都是 **single** 槽位，分别被 DSH 的 WorkspacePicker 与模式 chip 占着（priority 0）。
// 同优先级抢注会抛
//   single slot "conversation.hero.workspace" already has a registration at priority 0
// 而在 applyUi 里抛错会被 Cordis 判为失败、把整个注入上下文销毁 —— 之后所有
// ctx.remote 调用都变成 cannot get required service "remote" in inactive context，
// 课题页整个不可用（2026-10-01 现场复现 + 本机 headless Chrome 复现）。
// 退而挂输入区的那个列表槽位也不行：那会把 chip 变成输入框上方的横幅，而项目
// 历史上明确否决过这种做法。所以这里改成**注入到 hero 行里**：把 chip 挂在
// 「工作目录」chip 旁边（DSH 用 [class*='_heroWorkspaceRow'] 渲染这一行），
// 与 branding.js 注入侧栏品牌是同一套做法，不碰任何槽位。
//
// 选课题 = 确保该课题有专属工作区（缺则创建并绑定）→ 在课题工作区里开/复用空白会话
// 并切换过去（ctx.uiWorkspace.connectWorkspace + openSession），于是 projects_by_cwd
// 立刻认出课题。装配面由 apply.js 注入，组件本身不依赖 ctx。
import ReactDOM from "react-dom";
import { useEffect, useState } from "react";
import { h } from "./h.js";

let runtime = null;

/** 注入装配面：{ call, ensureWorkspace, openWorkspace, listWorkspaces, openPanel, toast }。 */
export function setHeroProjectRuntime(next) {
	runtime = next && typeof next === "object" ? next : null;
}

export function HeroProjectPicker() {
	// chip 只被注入到 hero 行（那一行只存在于空白新会话），会话信息从装配面读。
	const [session, setSession] = useState(() => runtime?.currentSession?.() ?? null);
	useEffect(() => {
		const timer = setInterval(() => setSession(runtime?.currentSession?.() ?? null), 3000);
		return () => clearInterval(timer);
	}, []);
	const blank = session === null || session.blank !== false;
	const [state, setState] = useState({ projects: [], current: null, loading: true, error: "" });
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState("");
	const [workspaces, setWorkspaces] = useState([]);
	const cwd = session?.cwd;

	useEffect(() => {
		if (!blank) return undefined;
		let alive = true;
		const call = runtime?.call;
		if (typeof call !== "function") { setState((s) => ({ ...s, loading: false })); return undefined; }
		const load = async () => {
			try {
				const listed = await call("projects_list");
				let bound = null;
				if (cwd) {
					const current = await call("projects_by_cwd", { request: { path: cwd } }).catch(() => null);
					bound = current?.bound?.project ?? null;
				}
				if (!alive) return;
				setState({ projects: listed?.projects ?? [], current: bound, loading: false, error: "" });
			} catch (reason) {
				if (alive) setState((s) => ({ ...s, loading: false, error: reason?.message ?? String(reason) }));
			}
		};
		void load();
		const timer = setInterval(() => { void load(); }, 8000);
		return () => { alive = false; clearInterval(timer); };
	}, [blank, cwd]);

	useEffect(() => {
		if (!menuOpen) return undefined;
		const list = runtime?.listWorkspaces;
		if (typeof list === "function") setWorkspaces(list() ?? []);
		const onKey = (event) => { if (event.key === "Escape") setMenuOpen(false); };
		const onClick = (event) => { if (!event.target.closest?.(".ib-hero-project")) setMenuOpen(false); };
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onClick, true);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerdown", onClick, true);
		};
	}, [menuOpen]);

	if (!blank) return null;

	const pickProject = async (project) => {
		if (busy) return;
		setBusy(project.id);
		try {
			const workspaceId = await runtime.ensureWorkspace(project.id);
			if (!workspaceId) throw new Error("该课题还没有可用的工作区");
			await runtime.openWorkspace(workspaceId, project.id);
			setMenuOpen(false);
			runtime?.toast?.(`已切换到课题「${project.name}」`);
		} catch (reason) {
			setState((s) => ({ ...s, error: reason?.message ?? String(reason) }));
		} finally {
			setBusy("");
		}
	};
	const pickWorkspace = async (workspaceId) => {
		if (busy) return;
		setBusy(workspaceId);
		try {
			await runtime.openWorkspace(workspaceId, null);
			setMenuOpen(false);
		} catch (reason) {
			setState((s) => ({ ...s, error: reason?.message ?? String(reason) }));
		} finally {
			setBusy("");
		}
	};

	const label = state.current?.name || (state.loading ? "读取课题…" : "选择课题");
	const others = workspaces.filter((workspace) => workspace.workspaceId !== session?.workspaceId);

	return renderChip({ label, state, menuOpen, busy, others, setMenuOpen, pickProject, pickWorkspace });
}

/** 渲染 chip + 菜单（与 DOM 注入解耦，便于单独阅读）。 */
function renderChip({ label, state, menuOpen, busy, others, setMenuOpen, pickProject, pickWorkspace }) {

	return h("div", { className: "ib-hero-project" },
		h("button", {
			type: "button",
			className: "ib-hero-chip",
			"aria-haspopup": "true",
			"aria-expanded": menuOpen ? "true" : undefined,
			title: state.current ? `当前课题：${state.current.name}（点击切换）` : "选择这条对话所属的课题",
			onClick: () => setMenuOpen((value) => !value)
		},
			h("span", { className: "ib-hero-chip-label" }, label),
			h("span", { className: "ib-hero-chip-caret", "aria-hidden": "true" }, "▾")),
		menuOpen ? h("div", { className: "ib-hero-menu", role: "menu" },
			state.projects.length
				? state.projects.map((project) => h("button", {
					key: project.id,
					type: "button",
					role: "menuitem",
					className: "ib-hero-menu-item",
					"data-active": state.current?.id === project.id ? "true" : undefined,
					disabled: Boolean(busy),
					onClick: () => void pickProject(project)
				},
					h("b", null, project.name),
					h("small", null, busy === project.id
						? "正在打开…"
						: (state.current?.id === project.id ? "当前课题" : project.id))))
				: h("div", { className: "ib-hero-menu-empty" }, state.loading ? "正在读取课题…" : "还没有课题，先在课题面板里新建一个。"),
			others.length ? h("div", { className: "ib-hero-menu-sep" }, "其他工作目录") : null,
			others.map((workspace) => h("button", {
				key: workspace.workspaceId,
				type: "button",
				role: "menuitem",
				className: "ib-hero-menu-item",
				disabled: Boolean(busy),
				onClick: () => void pickWorkspace(workspace.workspaceId)
			}, h("b", null, workspace.title || workspace.path || workspace.workspaceId))),
			h("button", {
				type: "button",
				role: "menuitem",
				className: "ib-hero-menu-item ib-hero-menu-item-strong",
				onClick: () => { setMenuOpen(false); runtime?.openPanel?.(); }
			}, "课题管理面板 / 新建课题"),
			state.error ? h("div", { className: "ib-hero-menu-empty" }, `读取失败：${state.error}`) : null
		) : null);
}

/**
 * 把课题 chip 注入 hero 行（「工作目录」chip 旁边）。
 *
 * hero 行由 DSH 渲染，React 可能随时重渲染并丢掉我们追加的节点，所以用
 * MutationObserver + rAF 去抖做幂等补注（与 branding.js 注入侧栏品牌同一套路），
 * 组件本身挂在自己的 host 节点里，卸载时一起清理。
 *
 * @returns {() => void} 注销函数（交给 ctx.effect）。
 */
export function installHeroProjectChip() {
	if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
	let host = null;
	let scheduled = false;
	const unmount = () => {
		if (host === null) return;
		const node = host;
		host = null;
		try { ReactDOM.unmountComponentAtNode(node); } catch { /* 已被 React 摘掉时忽略 */ }
		node.remove();
	};
	const inject = () => {
		const row = document.querySelector("[class*='_heroWorkspaceRow']");
		if (!row) { unmount(); return; }
		if (host !== null && row.contains(host)) return;
		unmount();
		host = document.createElement("div");
		host.className = "ib-hero-project-host";
		host.dataset.dshLabHeroProject = "1";
		row.appendChild(host);
		try { ReactDOM.render(h(HeroProjectPicker), host); }
		catch (reason) { console.warn("[dsh-lab-agent] hero 课题选择框渲染失败：", reason); unmount(); }
	};
	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => { scheduled = false; inject(); });
	};
	inject();
	const observer = new MutationObserver(schedule);
	observer.observe(document.body, { childList: true, subtree: true });
	return () => { observer.disconnect(); unmount(); };
}
