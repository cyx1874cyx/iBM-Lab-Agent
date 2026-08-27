/**
 * Resolve the lab project targeted by a model tool call.
 *
 * Explicit input always wins. Otherwise prefer the durable session binding and
 * fall back to the session's workspace path. The cwd fallback is important for
 * conversations created directly inside a project workspace: those sessions
 * have valid durable cwd metadata even when they did not pass through the
 * "start research Agent conversation" flow that records a session binding.
 */
export function resolveToolProjectId(ctx, args, exec) {
	if (args?.projectId !== undefined) {
		const project = ctx.labTasks.getProject(args.projectId);
		if (project === undefined) return { error: `课题 '${args.projectId}' 不存在` };
		return { projectId: args.projectId };
	}

	const session = exec?.agent?.session;
	const sessionId = session?.id;
	if (sessionId) {
		const bound = ctx.labTasks.getProjectBySession(sessionId);
		if (bound !== undefined) return { projectId: bound.project.id };
	}

	const cwd = session?.header?.cwd;
	if (cwd) {
		const bound = ctx.labTasks.getProjectByCwd(cwd);
		if (bound !== undefined) return { projectId: bound.project.id };
	}

	if (!sessionId) {
		return { error: "无法确定当前会话。请从「我的科研课题」进入课题空间启动对话，或显式传入 projectId。" };
	}
	return { error: "当前会话未归属任何课题，且工作目录不属于课题空间。请从「我的科研课题」选择课题并开始科研 Agent 对话，或显式传入 projectId。" };
}
