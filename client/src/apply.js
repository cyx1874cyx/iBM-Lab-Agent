// applyUi / apply：UI 装配与入口（从原 client/index.js 抽离）。
import ReactDOM from "react-dom";
import { h } from "./h.js";
import { buildDescriptors } from "./descriptors.js";
import { applyBranding } from "./branding.js";
import { OverlayBoundary, Panel } from "./components-project.js";
import { ProjectBadge, ResearchFileUpload } from "./components-literature.js";

export function applyUi(ctx) {
	const call = async (method, args) => {
		const payload = args && typeof args === "object" && Object.keys(args).length === 1 && "request" in args ? args.request : args;
		const result = payload === undefined ? await ctx.remote.lab[method]() : await ctx.remote.lab[method](payload);
		if (!result.ok) throw new Error(result.error?.message || result.error?.code || "remote call failed");
		return result.value;
	};
	let root = null;
	const close = () => { if (!root) return; const node = root; root = null; ReactDOM.unmountComponentAtNode(node); node.remove(); };
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
	 * 为空白新会话选择科研 Agent 预设。wire 层返回 { result: { ok, error } }，
	 * **不会 throw**——必须检查 result.ok，否则预设切换失败会被静默吞掉。
	 * agent-preset-locked = 复用了已开始会话（预设已固定）：若该会话本就在
	 * 科研模式则无需处理，返回 "ok（沿用已有会话）"；否则返回失败说明。
	 * 返回 "ok" 或失败说明。
	 */
	const selectResearchPreset = async (sessionId, presetId) => {
		if (!presetId) return "ok（未配置科研预设，沿用会话默认）";
		try {
			const response = await ctx.connection.api.agentPresets.select({ sessionId, agentPreset: presetId });
			const result = response?.result ?? response;
			if (!result.ok) {
				const code = result.error?.code ?? "unknown";
				const detail = result.error?.message ?? "agentPresets.select 未返回 ok";
				if (code === "agent-preset-locked") {
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
		sessionId = await ctx.workspaces.connectWorkspace(workspaceId);
		openedNew = true;
		presetApplied = await selectResearchPreset(sessionId, presetId);
		await call("projects_bind_session", { request: { projectId: project.id, sessionId, workspaceId } });
		ctx.sessions.open(sessionId);
		const actx = ctx.sessions.scope(sessionId);
		if (!actx) throw new Error("科研 Agent 会话尚未就绪，请稍后重试");
		// 面板中的产物按钮可提供一个明确任务；仍复用同一课题工作区与科研
		// Agent 预设，但在新对话输入框中优先放入该任务，而不是通用开场白。
		const prompt = String(opts.prompt || "").trim() || promptFor(project, opts.memory);
		ctx.conversation.input.for(actx).setDraft(prompt);
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
		root = document.createElement("div");
		document.body.appendChild(root);
		try {
			ReactDOM.render(h(OverlayBoundary, { onClose: close }, h(Panel, { call, onClose: close, onDeleteProject: deleteProject, onStartChat: launchProject, onOpenSearch: (sessionId) => { close(); try { ctx.sessions.open(sessionId); } catch (reason) { toast(reason.message || "无法打开该会话"); } }, initial: initial ?? null })), root);
		} catch (reason) {
			console.error("[dsh-lab-agent] overlay mount failed:", reason);
			close(); // 重置 root，避免侧边栏点击被残留节点短路
			toast(`面板加载失败：${reason?.message ?? reason}`);
		}
	};
	const openWorkspace = (project) => open(project);
	const disposeBranding = applyBranding(() => open());
	ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: "lab-project-badge", order: 10 }, (props) => h(ProjectBadge, { ...props, call, openWorkspace })), "dsh-lab-agent: project badge");
	ctx.slots.inject("conversation.input.left", () => ctx.slots.register({ name: "conversation.input.left", id: "lab-project-file-upload", order: 40 }, (props) => h(ResearchFileUpload, { ...props, call, toast })), "dsh-lab-agent: research file upload");
	ctx.on("dispose", () => { if (disposeBranding) disposeBranding(); close(); });
}

export async function apply(ctx) {
	await ctx.remote.$mount({ package: "dsh-lab-agent", descriptors: buildDescriptors() });
	ctx.inject(["remote", "remote.lab", "slots", "sessions", "workspaces", "conversation", "connection"], applyUi);
}
