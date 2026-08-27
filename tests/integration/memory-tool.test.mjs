/**
 * Integration: 课题核心记忆模型工具（lab_project_memory_read / _update）。
 *
 * agent 会话里直接读写课题核心记忆数据行：自动按会话反查课题、追加版本行、
 * 未绑定会话给出明确错误——归档类任务不再需要绕路或发明孤立记忆文件。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

async function bootMemoryTool() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-mtool-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false,
		extraRows: [
			{ id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt" },
			{ id: "tools", name: "@deepseek-ai/dsh-tools" },
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"] },
			{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labNoteTemplates", "labTemplates", "labVersions"], config: { projectsRoot: join(dir, "projects") } },
			{ id: "lab-memory-tool", name: "dsh-lab-agent/memory-tool", inject: ["tools", "labTasks"] },
			{ id: "lab-tasks-tool", name: "dsh-lab-agent/tasks-tool", inject: ["tools", "labTasks"] }
		]
	});
	// 造一个课题 + 绑定会话（模拟课题 launch 后的环境）
	const project = await handle.ctx.labTasks.createProject({
		id: "mtool-project",
		name: "记忆工具课题",
		goalProfileId: "default-prodrug-polymer",
		goalProfileVersion: "1",
		templateId: "nature-default",
		templateVersion: "1"
	});
	await handle.ctx.labTasks.bindProjectSession({ projectId: project.id, sessionId: "session-mtool", workspaceId: "ws-mtool" });
	return { handle, dir, project };
}

const agentExec = (sessionId, cwd) => ({ agent: { session: { id: sessionId, header: cwd ? { cwd } : {} } } });

test("memory tools: register, resolve project by session, read and update core memory", async () => {
	const { handle, dir, project } = await bootMemoryTool();
	try {
		const tools = handle.ctx.tools;
		const names = tools.schemas().map((t) => t.name);
		assert.ok(names.includes("lab_project_memory_read"), "read tool registered");
		assert.ok(names.includes("lab_project_memory_update"), "update tool registered");

		const read = tools.get("lab_project_memory_read");
		const update = tools.get("lab_project_memory_update");

		// 自动按会话反查课题：读到 v1 初始记忆
		const initial = await read.execute({}, agentExec("session-mtool"));
		assert.equal(initial.ok, true);
		assert.equal(initial.projectId, "mtool-project");
		assert.equal(initial.version, "1");
		assert.match(initial.markdown, /核心课题/);

		// 提交 v2：归档总结
		const submitted = await update.execute({
			markdown: "# 记忆工具课题\n\n## 当前进展\n- 已归档课题设计总结",
			changeNote: "课题设计总结归档"
		}, agentExec("session-mtool"));
		assert.equal(submitted.ok, true);
		assert.equal(submitted.version, "2");
		assert.equal(submitted.changeNote, "课题设计总结归档");
		assert.deepEqual(submitted.history.map((h) => h.version), ["2", "1"]);

		// 再次读取确认新版本生效（后续对话的默认背景）
		const after = await read.execute({}, agentExec("session-mtool"));
		assert.equal(after.version, "2");
		assert.match(after.markdown, /已归档课题设计总结/);
		assert.equal(handle.ctx.labTasks.getProject("mtool-project").memoryVersion, "2");

		// 显式 projectId 可用
		const byId = await read.execute({ projectId: "mtool-project" });
		assert.equal(byId.ok, true);
		assert.equal(byId.projectId, "mtool-project");

		// 从课题工作目录直接创建、未经过 launch 绑定的会话也能自动定位。
		const byCwd = await read.execute({}, agentExec("session-cwd-only", project.workspacePath));
		assert.equal(byCwd.ok, true);
		assert.equal(byCwd.projectId, "mtool-project");

		// 所有文献登记工具共享同一回退；公众号登记无需再手传 projectId。
		const registerWechat = tools.get("lab_tasks_register_wechat_paper");
		const wechat = await registerWechat.execute({
			sourceUrl: "https://mp.weixin.qq.com/s?__biz=test&mid=456&idx=1&sn=cwd",
			title: "Cwd-resolved paper"
		}, agentExec("session-cwd-wechat", project.workspacePath));
		assert.equal(wechat.ok, true);
		assert.ok(wechat.bundleId);
		assert.ok(wechat.reportId);
		assert.equal(handle.ctx.labTasks.getBundle(wechat.bundleId).projectId, "mtool-project");

		// 未绑定且 cwd 不属于课题空间 → 明确错误（引导先进入课题）
		const unbound = await read.execute({}, agentExec("session-nobody"));
		assert.equal(unbound.ok, false);
		assert.match(unbound.error, /未归属任何课题/);

		// 空 markdown → 拒绝
		const empty = await update.execute({ markdown: "   " }, agentExec("session-mtool"));
		assert.equal(empty.ok, false);
		assert.match(empty.error, /不能为空/);

		// 内容未变化 → 拒绝（不产生空版本）
		const unchanged = await update.execute({ markdown: "# 记忆工具课题\n\n## 当前进展\n- 已归档课题设计总结" }, agentExec("session-mtool"));
		assert.equal(unchanged.ok, false);
		assert.match(unchanged.error, /has not changed/);

		// 不存在的 projectId → 明确错误
		const badId = await read.execute({ projectId: "no-such-project" });
		assert.equal(badId.ok, false);
		assert.match(badId.error, /不存在/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
