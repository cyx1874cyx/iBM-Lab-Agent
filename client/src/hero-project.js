// dsh-lab-agent：Hero（空白新会话）里的「课题选择框」。
//
// 为什么需要它：新建对话时 DSH 的 hero 行只有「工作目录」chip 与模式 chip，
// 用户看不出这条对话属于哪个课题，也没法在这里切课题（现场反馈：
// 「新建对话……也没有对应课题的选择框」）。
//
// DSH 的 `conversation.hero.workspace` 槽位就是工作目录 chip 旁边的那个位置
// （owner props: open / anchorRef / selectedId / onPick / onClose），所以这里注册一个
// occupant 渲染课题 chip：
//   * 选中课题 → 确保该课题有专属工作区（缺则创建并绑定）→ onPick(workspaceId)，
//     DSH 会把这条空白会话移过去，之后 projects_by_cwd 立即能认出课题；
//   * 菜单里同时保留「其他工作目录」，避免接管这个槽位后丢掉原生选目录的能力。
//
// 装配面（call / workspaces）由 apply.js 注入，组件本身不依赖 ctx。
import { useEffect, useState } from "react";
import { h } from "./h.js";
import { FlaskSvg } from "./components-templates.js";

let runtime = null;

/** 注入装配面：{ call, listWorkspaces, ensureWorkspace, openPanel, toast }。 */
export function setHeroProjectRuntime(next) {
	runtime = next && typeof next === "object" ? next : null;
}

export function HeroProjectPicker({ selectedId, onPick, onClose }) {
	const [state, setState] = useState({ projects: [], current: null, loading: true, error: "" });
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState("");
	const [workspaces, setWorkspaces] = useState([]);

	// 当前课题：由 DSH 给出的当前工作区反查（课题绑定是工作区级的）。
	useEffect(() => {
		let alive = true;
		const load = async () => {
			const call = runtime?.call;
			if (typeof call !== "function") { setState((s) => ({ ...s, loading: false })); return; }
			try {
				const listed = await call("projects_list");
				if (!alive) return;
				let current = null;
				if (selectedId) {
					const bound = await call("projects_by_workspace", { request: { workspaceId: selectedId } });
					if (!alive) return;
					current = bound?.bound?.project ?? null;
				}
				setState({ projects: listed?.projects ?? [], current, loading: false, error: "" });
			} catch (reason) {
				if (alive) setState((s) => ({ ...s, loading: false, error: reason?.message ?? String(reason) }));
			}
		};
		void load();
		const timer = setInterval(() => { void load(); }, 8000);
		return () => { alive = false; clearInterval(timer); };
	}, [selectedId]);

	// 打开菜单时刷新工作区列表（原生「选目录」的兜底入口）。
	useEffect(() => {
		if (!menuOpen) return undefined;
		const list = runtime?.listWorkspaces;
		if (typeof list === "function") setWorkspaces(list() ?? []);
		const onKey = (event) => { if (event.key === "Escape") setMenuOpen(false); };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [menuOpen]);

	const pickProject = async (project) => {
		if (busy) return;
		setBusy(project.id);
		try {
			const workspaceId = await runtime.ensureWorkspace(project.id);
			if (!workspaceId) throw new Error("该课题还没有可用的工作区");
			onPick?.(workspaceId);
			onClose?.();
			setMenuOpen(false);
			runtime?.toast?.(`已切换到课题「${project.name}」`);
		} catch (reason) {
			setState((s) => ({ ...s, error: reason?.message ?? String(reason) }));
		} finally {
			setBusy("");
		}
	};
	const pickWorkspace = (workspaceId) => {
		onPick?.(workspaceId);
		onClose?.();
		setMenuOpen(false);
	};

	const label = state.current?.name
		|| (state.loading ? "读取课题…" : "选择课题");
	const boundWorkspaceIds = new Set(state.projects.map((project) => project.workspacePath).filter(Boolean));
	const others = workspaces.filter((workspace) => workspace.workspaceId !== selectedId
		&& !boundWorkspaceIds.has(workspace.path));

	return h("div", { className: "ib-hero-project" },
		h("button", {
			type: "button",
			className: "ib-hero-chip",
			"aria-haspopup": "true",
			"aria-expanded": menuOpen ? "true" : undefined,
			title: state.current ? `当前课题：${state.current.name}` : "选择这条对话所属的课题",
			onClick: () => setMenuOpen((value) => !value)
		},
			h("span", { className: "ib-hero-chip-icon" }, h(FlaskSvg, { width: 15, height: 15 })),
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
				onClick: () => pickWorkspace(workspace.workspaceId)
			}, h("b", null, workspace.title || workspace.path || workspace.workspaceId))),
			h("button", {
				type: "button",
				role: "menuitem",
				className: "ib-hero-menu-item ib-hero-menu-item-strong",
				onClick: () => { setMenuOpen(false); onClose?.(); runtime?.openPanel?.(); }
			}, "课题管理面板 / 新建课题"),
			state.error ? h("div", { className: "ib-hero-menu-empty" }, `读取失败：${state.error}`) : null
		) : null);
}
