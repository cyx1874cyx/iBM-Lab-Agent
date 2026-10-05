// applyUi / apply：UI 装配与入口（从原 client/index.js 抽离）。
import ReactDOM from "react-dom";
import { h } from "./h.js";
import { injectStyles } from "./styles.js";
import { registerPluginSettings } from "./components-settings.js";
import { installDesktopClient } from "./desktop-client.js";
import { buildDescriptors } from "./descriptors.js";
import { applyBranding } from "./branding.js";
import { OverlayBoundary, Panel, Project } from "./components-project.js";
import { ProjectBadge } from "./components-literature.js";
import { installShellRequestBridge, installProjectShellBridge, setWebVpnVisibleViaShell } from "./lib.js";
import { registerWebVpnTab, WEBVPN_TAB_KIND } from "./webvpn-tab.js";
import { openProjectTab, registerProjectTab, setProjectLoader, setProjectPanelRenderer, setProjectTabOpener } from "./project-tab.js";
import { installHeroProjectChip, setHeroProjectRuntime } from "./hero-project.js";

/** 科研 Agent 预设 id（presets/lab-research/preset.patch.yml 声明的那一条）。 */
export const RESEARCH_PRESET_ID = "lab-research";

/**
 * 让「所有入口新建的会话」都默认进入科研 Agent 模式。
 *
 * DSH 0.1.7 把「新会话默认预设」放在 agent-preset-registry 的 selectedDefault
 * settings 字段里（既不是 profile patch，也不是 preset 自己的属性）。桌面版的
 * bootstrap 只写一个空的 `profiles/ibm-lab/cordis.patch.yml`，于是默认一直是
 * 内置的 standard；用户必须每次手动切模式——这正是「新建对话默认模式不是
 * ibmAgent」的原因。
 *
 * 这里复用的就是 DSH 设置页「设为默认」用的同一个写入面
 * （ctx.remote.settings.update("agent-preset-registry", { selectedDefault })），
 * 因此不需要改安装器、也不需要重建桌面壳。
 *
 * 安全边界：只有在 roster 读取成功、且 lab-research 确实注册过的情况下才写；
 * 写一个不存在的 id 会让之后每个新会话都创建失败，宁可不动。
 *
 * @returns {{ ok: boolean, changed?: boolean, reason?: string }}
 */
export async function ensureResearchPresetDefault(remote) {
	try {
		const roster = await remote.agentPresets.list();
		const presets = roster?.ok ? (roster.value?.presets ?? []) : null;
		if (presets === null) return { ok: false, reason: roster?.error?.message ?? "agentPresets.list failed" };
		const target = presets.find((row) => row.id === RESEARCH_PRESET_ID);
		if (target === undefined) return { ok: false, reason: `preset '${RESEARCH_PRESET_ID}' is not registered` };
		if (target.isDefault === true) return { ok: true, changed: false };
		const updated = await remote.settings.update("agent-preset-registry", { selectedDefault: RESEARCH_PRESET_ID }, undefined);
		if (!updated?.ok) return { ok: false, reason: updated?.error?.message ?? "settings.update failed" };
		return { ok: true, changed: true };
	} catch (reason) {
		return { ok: false, reason: reason?.message ?? String(reason) };
	}
}

export function applyUi(ctx) {
 // DSH 0.4.x 会按“列数 >= 4”给 Markdown 表格添加 md-table-wide。
 // 该分类不看实际内容宽度，会让同为四列的短表和长表走同一套横向布局，
 // 并在重新布局后保留错误的横向滚动位置。科研界面统一交给 CSS 的实际
 // 内容宽度与 overflow 判断；移除列数分类，并确保初始视口从左侧开始。
 const normalizeMarkdownTables=()=>{
  if(typeof document?.querySelectorAll!=="function")return;
  for(const wrapper of document.querySelectorAll(".md-table-wide")){
   wrapper.classList.remove("md-table-wide");
   wrapper.scrollLeft=0;
  }
 };
 normalizeMarkdownTables();
 if(typeof MutationObserver==="function"&&document?.body){
  const tableObserver=new MutationObserver(normalizeMarkdownTables);
  tableObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
  ctx.effect(()=>()=>tableObserver.disconnect(),"lab.markdown-table-layout");
 }
 const syncDesktopTheme=()=>{if(typeof requestAnimationFrame!=="function")return;return requestAnimationFrame(()=>{
  if(window.parent===window)return;
  const style=getComputedStyle(document.body),tokens={};
  for(const name of ["bg-base","bg-layer-1","bg-layer-2","border-l2","label-primary","label-secondary","brand-primary","state-error-primary"]){tokens[name]=style.getPropertyValue(`--dsw-alias-${name}`).trim();}
  window.parent.postMessage({source:"ibm-lab-agent",type:"SYNC_THEME",requestId:"theme",payload:{tokens,dark:document.body.hasAttribute("data-ds-dark-theme")}},"*");
 });};
 syncDesktopTheme();
 if(typeof MutationObserver==="function"){const themeObserver=new MutationObserver(syncDesktopTheme);themeObserver.observe(document.body,{attributes:true,attributeFilter:["style","data-ds-dark-theme"]});ctx.effect(()=>()=>themeObserver.disconnect(),"lab.theme-sync");}
 ctx.on?.("theme/change",syncDesktopTheme);

	const call = async (method, args) => {
		const payload = args && typeof args === "object" && Object.keys(args).length === 1 && "request" in args ? args.request : args;
		const result = payload === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
		if (!result.ok) throw new Error(result.error?.message || result.error?.code || "remote call failed");
		return result.value;
	};
	let root = null;
	let previousNativeTop = "";
 ctx.effect(() => installDesktopClient(call), "lab.native-desktop-client");
	const close = () => {
		if (!root) return;
		const node = root;
		root = null;
		ReactDOM.unmountComponentAtNode(node);
		node.remove();
		if (previousNativeTop) document.body.style.setProperty("--ib-native-top", previousNativeTop);
		else document.body.style.removeProperty("--ib-native-top");
		// 面板关掉后把原生文献浏览器放回去（面板打开时它是被收起来的）。
		setWebVpnVisibleViaShell(true);
	};
	const toast = (message) => {
		const node = document.createElement("div");
		node.className = "ib-toast";
		node.textContent = message;
		document.body.appendChild(node);
		setTimeout(() => node.remove(), 4500);
	};
	/**
	 * 会话开场提示。课题核心记忆已落盘到课题工作区 `项目记忆.md`
	 * （host 侧每次提交版本时同步重写）——开场只引导 agent 读取该文件，
	 * 不把整份记忆预填进输入框（避免输入框冗长、且记忆以文件为准）。
	 * 旧项目尚无文件时回退到面板返回的 memory 内容。
	 */
	const promptFor = (project, memory) => {
		const fileRef = `课题工作区里的「项目记忆.md」`;
		const lines = [
			`当前课题为「${project.name}」（项目编号：${project.id}）。`,
			`请先读取 ${fileRef}（课题工作区根目录，当前版本 v${memory?.version || project.memoryVersion || "?"}）了解课题背景，`
			+ "再开始工作；后续产物归档到这个项目。如发现信息冲突，先向我确认。",
			"",
			"开场请简短说明你已读取记忆、理解的课题背景，然后等待我的具体任务。"
		];
		if (!memory?.markdown && !project.workspacePath) {
			lines.splice(1, 0, "", `<!-- project-memory:${project.id}@${project.memoryVersion} -->`, memory?.markdown || `# ${project.name}`);
		}
		return lines.join("\n");
	};
	/**
	 * 为空白新会话选择科研 Agent 预设。DSH 0.4.3 的 remote 方法使用两个
	 * 位置参数（sessionId, agentPreset），返回 RemoteResult 且不会 throw——
	 * 必须检查 result.ok，否则预设切换失败会被静默吞掉。
	 * agent-preset-locked = 复用了已开始会话（预设已固定）：若该会话本就在
	 * 科研模式则无需处理，返回 "ok（沿用已有会话）"；否则返回失败说明。
	 * 返回 "ok" 或失败说明。
	 */
	const selectResearchPreset = async (sessionId, presetId) => {
		if (!presetId) return "ok（未配置科研预设，沿用会话默认）";
		try {
			const result = await ctx.remote.agentPresets.select(sessionId, presetId);
			if (!result.ok) {
				const code = result.error?.code ?? "unknown";
				const detail = result.error?.details?.reason ?? result.error?.message ?? "agentPresets.select 未返回 ok";
				if (code === "agent-preset/locked" || code === "agent-preset-locked") {
					// 复用了已开始会话：预设已固定，无法中途切换（DSH 约束）。
					return `ok（复用已开始的会话，预设已固定，无法切换到 ${presetId}）`;
				}
				return `预设选择失败（${code}）：${detail}`;
			}
			return "ok";
		} catch (reason) {
			return `预设选择调用失败：${reason?.message ?? reason}`;
		}
	};
	/**
	 * 课题 launch：绑定是**工作区级**的——一个课题一个专属 workspace，
	 * 空间内所有对话共享课题标识与核心记忆。流程：复用或创建专属
	 * 工作区 → 在课题工作区里开启**新会话**（connectWorkspace 复用空白
	 * 会话或新建）→ 选择科研 Agent 预设（agentPresets.select，仅对
	 * 空白会话有效）→ 记录会话绑定 → 打开会话 → 把当前版本核心记忆
	 * 预填进输入框。旧项目（无 workspacePath）补建工作区，不沿用当前
	 * 会话。
	 */
	const launchProject = async (project, opts = {}) => {
		const presetId = opts.presetId;
		let sessionId;
		let workspaceId;
		let openedNew = false;
		let presetApplied = "ok";
		// 确保课题有专属目录 + 核心记忆文件「项目记忆.md」（幂等，旧项目补建）
		const ensured = await call("projects_ensure_workspace", { request: { projectId: project.id } });
		project = { ...project, workspacePath: ensured.path };
		const bound = (await call("projects_binding", { request: { projectId: project.id } })).binding ?? null;
		const wsSnapshot = ctx.workspaces.list.getSnapshot();
		const hasWorkspace = (id) => (wsSnapshot.items ?? []).some((item) => item.workspaceId === id);
		if (bound?.workspaceId && hasWorkspace(bound.workspaceId)) {
			// 已有课题工作区（仍存活）：在空间里开启新对话
			workspaceId = bound.workspaceId;
		} else {
			// 无工作区绑定，或绑定的工作区已被删除：注册课题工作区
			// WorkspaceRuntime.create 成功时直接返回 Workspace view，失败时抛出
			// WorkspaceCreateError；它不是 wire 层的 { ok, value } 结果。
			const ws = await ctx.workspaces.create({ path: project.workspacePath });
			workspaceId = ws.workspaceId;
			try { await ctx.workspaces.rename(workspaceId, project.name); } catch (reason) { console.warn("dsh-lab-agent: workspace rename failed", reason); }
			await call("projects_bind_workspace", { request: { projectId: project.id, workspaceId } });
		}
		// 在课题工作区开启新对话：connectWorkspace 复用该空间空白会话或新建
		sessionId = await ctx.uiWorkspace.connectWorkspace(workspaceId);
		openedNew = true;
		presetApplied = await selectResearchPreset(sessionId, presetId);
		await call("projects_bind_session", { request: { projectId: project.id, sessionId, workspaceId } });
		ctx.uiWorkspace.openSession(sessionId);
		const actx = ctx.sessions.scope(sessionId);
		if (!actx) throw new Error("科研 Agent 会话尚未就绪，请稍后重试");
		// 面板中的产物按钮可提供一个明确任务；仍复用同一课题工作区与科研
		// Agent 预设，但在新对话输入框中优先放入该任务，而不是通用开场白。
		const prompt = String(opts.prompt || "").trim() || promptFor(project, opts.memory);
		if (opts.autoSubmit) await actx.get("conversation").send(prompt);
		else ctx.conversation.input.for(actx).setDraft(prompt);
		close();
		if (presetApplied !== "ok") toast(`⚠️ ${presetApplied}`);
		return { sessionId, workspaceId, openedNew, presetApplied };
	};
	const deleteProject = async (project) => {
		// 先从 Harness 工作区注册表移除；Host 端随后校验并物理删除专属目录。
		const binding = (await call("projects_binding", { request: { projectId: project.id } })).binding ?? null;
		if (binding?.workspaceId) {
			const registered = (ctx.workspaces.list.getSnapshot().items ?? []).some((item) => item.workspaceId === binding.workspaceId);
			if (registered) await ctx.workspaces.delete(binding.workspaceId);
		}
		return await call("projects_delete", { request: { projectId: project.id } });
	};
	const open = (initial) => {
		if (root) return;
		// 原生子 WebView 永远盖在网页之上：面板打开期间先把它收起来，
		// 否则课题面板会被文献浏览器挡住（关掉面板时再恢复）。
		setWebVpnVisibleViaShell(false);
		root = document.createElement("div");
		// NEXT's Windows caption/menu is a separate native chrome view (40px).
		// A fixed document overlay must leave that seat clear.
		previousNativeTop = document.body.style.getPropertyValue("--ib-native-top");
		// Panel portals into document.body, so the offset must live on that ancestor.
		if (navigator.platform === "Win32" && (window.location.protocol === "dsh-app:" || /Electron\//.test(navigator.userAgent))) document.body.style.setProperty("--ib-native-top", "40px");
		document.body.appendChild(root);
		try {
			ReactDOM.render(h(OverlayBoundary, { onClose: close }, h(Panel, { call, onClose: close, onDeleteProject: deleteProject, onStartChat: launchProject, initial: initial ?? null })), root);
		} catch (reason) {
			console.error("[dsh-lab-agent] overlay mount failed:", reason);
			close(); // 重置 root，避免侧边栏点击被残留节点短路
			toast(`面板加载失败：${reason?.message ?? reason}`);
		}
	};
	const openWorkspace = (project) => open(project);
	const disposeBranding = applyBranding(() => open());
	ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: "lab-project-badge", order: 10 }, (props) => h(ProjectBadge, { ...props, call, openWorkspace, toast, openProjectTab })), "dsh-lab-agent: project badge");
	// 文献浏览器 tab：DSH 右侧栏是可扩展停靠面，把 WebVPN 子 WebView 挂成其中一类
	// 页面 tab（与自带「文件」「文档预览」并列）。单独一次 inject，右侧栏未挂载时
	// 只有这一个能力缺失，不阻塞整个面板。
	ctx.inject(["slots", "sidebarRightTabs", "sidebarRight"], (tabCtx) => {
		// 文献浏览器：页面 tab（「+」类型列表里可选）。
		registerWebVpnTab(tabCtx, { openTab: () => tabCtx.sidebarRight.openTab(WEBVPN_TAB_KIND) });
		// 课题：资源 tab，一个课题一个标签页（页面 tab 的身份只由 kind 决定，
		// 做不到每课题一标签）。
		registerProjectTab(tabCtx);
		setProjectTabOpener((address) => tabCtx.sidebarRight.openResource(address));
		setProjectLoader(async (projectId) => (await call("projects_get", { request: { id: projectId } }))?.project ?? null);
		// 侧栏 tab 里放的就是全屏面板里的那一页（Project），只是套上 ib-panel-embed 把
		// 全屏布局收敛成单列。不走 Panel：它用 createPortal 渲染全屏 overlay 外壳。
		setProjectPanelRenderer((projectId) => h("div", { className: "ib-overlay ib-panel-embed" },
			h("div", { className: "ib-main" },
				h(Project, {
					call,
					project: { id: projectId },
					// 「← 所有课题」在侧栏里没有列表可回，改为打开全屏课题管理页。
					onBack: () => open(null),
					onDelete: deleteProject,
					onStartChat: launchProject
				}))));
	}, "dsh-lab-agent: 右侧栏 tab");
	// Hero（空白新会话）里的「课题选择框」。
	//
	// ⚠️ 不能抢 hero 的两个槽位：`conversation.hero.workspace` 是 DSH 自己的
	// WorkspacePicker、`conversation.hero.agentPreset` 是模式 chip，都是 single 槽位
	// 且 priority 0。同优先级抢注会抛
	// `single slot "..." already has a registration at priority 0`，而 **applyUi 里抛错
	// 会被 Cordis 判为失败、把整个注入上下文销毁** —— 之后所有 `ctx.remote` 调用都会变成
	// `cannot get required service "remote" in inactive context`，课题页整个不可用
	// （2026-10-01 现场复现，本机 headless Chrome 也复现过）。
	//
	// 也不能退而挂输入区那个列表槽位：那会把 chip 变成输入框上方的横幅，
	// 而项目历史上明确否决过「输入框横幅」这种做法。
	// 最终做法：DOM 注入到 hero 行里（见 hero-project.js），和 branding.js 注入侧栏品牌同源。
	const ensureWorkspaceForProject = async (projectId) => {
		const ensured = await call("projects_ensure_workspace", { request: { projectId } });
		const binding = (await call("projects_binding", { request: { projectId } })).binding ?? null;
		const snapshot = ctx.workspaces.list.getSnapshot();
		const alive = (workspaceId) => (snapshot.items ?? []).some((item) => item.workspaceId === workspaceId);
		if (binding?.workspaceId && alive(binding.workspaceId)) return binding.workspaceId;
		const workspace = await ctx.workspaces.create({ path: ensured.path });
		await call("projects_bind_workspace", { request: { projectId, workspaceId: workspace.workspaceId } });
		return workspace.workspaceId;
	};
	setHeroProjectRuntime({
		call,
		currentSession: () => {
			const snapshot = ctx.sessions.list.getSnapshot();
			const id = snapshot?.current;
			const row = id ? snapshot?.byId?.[id] : undefined;
			if (row === undefined) return null;
			const workspace = (ctx.workspaces.list.getSnapshot().items ?? []).find((item) => (item.sessionIds ?? []).includes(id));
			return { blank: row.blank !== false, cwd: row.cwd, workspaceId: workspace?.workspaceId };
		},
		ensureWorkspace: ensureWorkspaceForProject,
		openWorkspace: async (workspaceId, projectId) => {
			const sessionId = await ctx.uiWorkspace.connectWorkspace(workspaceId);
			// 顺手把会话记到课题名下（不是必须：projects_by_cwd 也能认出课题，
			// 但绑定后课题页的会话列表才是完整的）。
			if (projectId) await call("projects_bind_session", { request: { projectId, sessionId, workspaceId } }).catch(() => {});
			ctx.uiWorkspace.openSession(sessionId);
			return sessionId;
		},
		listWorkspaces: () => (ctx.workspaces.list.getSnapshot().items ?? []).map((item) => ({ workspaceId: item.workspaceId, title: item.title, path: item.path })),
		openPanel: () => open(null),
		toast
	});
	ctx.effect(() => () => setHeroProjectRuntime(null), "dsh-lab-agent: hero 课题装配面注销");
	// chip 用 DOM 注入挂到 hero 行（见 hero-project.js 文件头：两个 hero 槽位都是
	// single 且被 DSH 占着，抢注会抛错并连坐整个注入上下文）。注入失败只告警。
	try {
		ctx.effect(() => installHeroProjectChip(), "dsh-lab-agent: hero 课题选择框");
	} catch (reason) {
		console.warn("[dsh-lab-agent] 挂载「hero 课题选择框」失败，已跳过：", reason?.message ?? reason);
	}
	// 桌面壳顶栏的 WebVPN 指示器只发请求；由这里先开右侧栏 tab 再开原生窗口。
	ctx.effect(() => installShellRequestBridge(), "dsh-lab-agent: shell request bridge");
	// 桌面壳顶栏「课题入口」桥（本次改版）：常驻推送当前课题 + 接受打开请求。
	// 空白新会话里 session header 不渲染，只有这条桥能保证入口一直在。
	ctx.effect(() => installProjectShellBridge({
		ctx,
		call,
		openProject: (project) => open(project ?? null),
		openProjectTab
	}), "dsh-lab-agent: project shell bridge");
	ctx.effect(() => () => { if (disposeBranding) disposeBranding(); close(); }, "lab.overlay-and-branding");
}

export async function apply(ctx) {
	ctx.effect(() => { injectStyles(); return () => document.querySelector("style[data-plugin-css=dsh-lab-agent]")?.remove(); }, "lab.styles");
	await ctx.remote.$mount({ package: "dsh-lab-agent", descriptors: buildDescriptors() });
	ctx.inject(["remote", "remote.lab", "slots", "locale"], registerPluginSettings, "iBM plugin settings section");
	ctx.inject(["remote", "remote.lab", "remote.agentPresets", "slots", "sessions", "workspaces", "uiWorkspace", "conversation"], applyUi);
	// 新会话默认模式：单独一次注入。settings 命名空间缺失时只丢失这一项能力，
	// 绝不能让 applyUi 一起挂掉（inject 未满足时回调根本不会执行）。
	ctx.inject(["remote", "remote.settings", "remote.agentPresets"], (settingsCtx) => {
		void ensureResearchPresetDefault(settingsCtx.remote).then((result) => {
			if (result.ok && result.changed) console.info("[dsh-lab-agent] 新会话默认模式已设为", RESEARCH_PRESET_ID);
			else if (!result.ok) console.warn("[dsh-lab-agent] 默认模式设置失败：", result.reason);
		});
	}, "dsh-lab-agent: default research preset");
}
