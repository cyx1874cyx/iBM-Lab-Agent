/**
 * dsh-lab-agent / labTasks — 课题 CRUD、专属工作区、会话/工作区/cwd 绑定与核心记忆版本。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	labProjectSchema,
	projectMemoryVersionSchema,
	projectMemoryKey,
	projectSessionSchema,
	projectSessionKey
} from "../../src/task-models.js";
import { LabTasksService } from "./index.js";

export const projectsMethods = {

	// ── 项目 ────────────────────────────────────────────────────────────────

	/** 创建项目：保存所选目标/模板版本快照 + 创建专属工作区目录（§五 步骤 1）。 */
	async createProject({ id, name, coreMarkdown, memoryChangeNote, goalProfileId, goalProfileVersion, templateId, templateVersion }) {
		if (this.table("projects").get(id) !== undefined) throw new Error(`project '${id}' already exists`);
		const goal = await this.ctx.labGoals.snapshotForTask(goalProfileId, goalProfileVersion);
		const template = await this.ctx.labTemplates.resolve(templateId, templateVersion);
		if (template === undefined) throw new Error(`template '${templateId}'@${templateVersion} not found`);
		const now = new Date().toISOString();
		// 课题专属工作区目录：workspace.create 采纳一个已存在目录。
		const workspacePath = join(this.projectsRoot, id);
		await mkdir(workspacePath, { recursive: true });
		const project = labProjectSchema.parse({
			id,
			name,
			goalProfile: { id: goal.id, version: goal.version, snapshot: goal },
			template: { id: template.id, version: template.version, snapshot: template },
			status: "active",
			memoryVersion: "1",
			workspacePath,
			createdAt: now,
			updatedAt: now
		});
		const markdown = coreMarkdown?.trim() || [
			`# ${name}`,
			"",
			"## 核心课题",
			"请在此描述研究问题、核心假设和预期目标。",
			"",
			"## 当前进展",
			"- 项目已创建"
		].join("\n");
		const memory = projectMemoryVersionSchema.parse({
			id: projectMemoryKey(id, "1"),
			projectId: id,
			version: "1",
			markdown,
			changeNote: memoryChangeNote?.trim() || "创建课题核心记忆",
			contentSha256: createHash("sha256").update(markdown).digest("hex"),
			createdAt: now
		});
		await this.table("projects").put(id, project);
		await this.table("memories").put(memory.id, memory);
		await this.writeProjectMemoryFile(id);
		return project;
	},


	listProjects() {
		return [...this.table("projects").keys()].sort().map((k) => this.table("projects").get(k));
	},


	/**
	 * 彻底删除课题：先校验并删除插件专属 projects/<id> 工作区目录，再级联
	 * 删除任务域中的课题数据。Harness 工作区注册由浏览器侧 WorkspaceRuntime
	 * 删除；这里不接触 `.dsh/sessions` 中由 Harness 自己管理的会话日志。
	 */
	async deleteProject(projectId) {
		const project = this.requireProject(projectId);
		const projectsRoot = resolve(this.projectsRoot);
		const expectedPath = resolve(projectsRoot, projectId);
		const workspacePath = resolve(project.workspacePath ?? expectedPath);
		if (workspacePath !== expectedPath || workspacePath === projectsRoot) {
			throw new Error(`refusing to delete project workspace outside '${projectsRoot}': ${workspacePath}`);
		}

		// 先删文件；若权限等原因失败则保留登记，修正后可安全重试。
		await rm(workspacePath, { recursive: true, force: true });

		const deleted = {};
		for (const tableName of ["provenance", "presentations", "reports", "bundles", "searches", "memories", "sessions"]) {
			const table = this.table(tableName);
			let count = 0;
			for (const key of [...table.keys()]) {
				const row = table.get(key);
				if (row?.projectId !== projectId) continue;
				if (await table.delete(key)) count += 1;
			}
			deleted[tableName] = count;
		}
		deleted.projects = await this.table("projects").delete(projectId) ? 1 : 0;
		return { projectId, workspacePath, deleted };
	},


	/** 确保课题有专属工作区目录（升级前的旧项目可能没有 workspacePath）：
	 *  有则返回原路径；没有则建默认目录并写回项目行。同时确保核心记忆文件
	 *  「项目记忆.md」存在（旧项目缺文件时补写）。返回 { path }。 */
	async ensureProjectWorkspace(projectId) {
		const project = this.requireProject(projectId);
		let workspacePath = project.workspacePath;
		if (!workspacePath) {
			workspacePath = join(this.projectsRoot, projectId);
			await mkdir(workspacePath, { recursive: true });
			const updated = { ...project, workspacePath };
			await this.table("projects").put(projectId, updated);
		}
		const memoryFile = join(workspacePath, LabTasksService.PROJECT_MEMORY_FILE);
		if (!existsSync(memoryFile)) await this.writeProjectMemoryFile(projectId);
		return { path: workspacePath };
	},


	/** 把当前版本核心记忆落盘到课题工作区 `项目记忆.md`（无工作区则跳过）。
	 *  文件头带版本与变更说明，供 agent 读取时识别当前版本。 */
	async writeProjectMemoryFile(projectId) {
		const project = this.requireProject(projectId);
		if (!project.workspacePath) return;
		const memory = this.getProjectMemory(projectId);
		if (memory === undefined) return;
		const header = [
			`# ${project.name} — 课题核心记忆`,
			"",
			`> 版本 v${memory.version} · 更新于 ${memory.createdAt} · ${memory.changeNote ?? ""}`,
			"> 本文件是课题的长期记忆，由「课题核心记忆」面板/`lab_project_memory_update` 维护，",
			"> 每次提交新版本会整体重写。阅读时以文件内容为准，勿参考其他孤立文件。",
			""
		].join("\n");
		await writeFile(join(project.workspacePath, LabTasksService.PROJECT_MEMORY_FILE), header + memory.markdown + "\n", "utf8");
	},


	/** 记录课题 ↔ 工作区绑定（工作区级：该空间内所有会话归属同一课题）。 */
	async bindProjectWorkspace({ projectId, workspaceId }) {
		this.requireProject(projectId);
		const existing = this.getProjectSession(projectId);
		const now = new Date().toISOString();
		const row = projectSessionSchema.parse(existing ?? { projectId, workspaceId, sessionIds: [], createdAt: now });
		row.workspaceId = workspaceId;
		if (existing === undefined) row.createdAt = now;
		await this.table("sessions").put(projectSessionKey(projectId), row);
		return row;
	},


	/** 记录某个会话归属课题（追加进 sessionIds；重复调用幂等）。 */
	async bindProjectSession({ projectId, sessionId, workspaceId }) {
		this.requireProject(projectId);
		const existing = this.getProjectSession(projectId);
		const now = new Date().toISOString();
		const row = projectSessionSchema.parse(existing ?? { projectId, workspaceId, sessionIds: [], createdAt: now });
		if (existing === undefined) row.createdAt = now;
		if (workspaceId !== undefined) row.workspaceId = workspaceId;
		if (!row.sessionIds.includes(sessionId)) row.sessionIds = [...row.sessionIds, sessionId];
		await this.table("sessions").put(projectSessionKey(projectId), row);
		return row;
	},


	/** 查询某课题的工作区/会话绑定（无则返回 undefined）。 */
	getProjectSession(projectId) {
		return this.table("sessions").get(projectSessionKey(projectId));
	},


	/** 反查：某 Harness 会话属于哪个课题（launch 绑定过的会话；无则返回 undefined）。 */
	getProjectBySession(sessionId) {
		for (const key of this.table("sessions").keys()) {
			const row = this.table("sessions").get(key);
			if ((row.sessionIds ?? []).includes(sessionId) || row.sessionId === sessionId) {
				const project = this.table("projects").get(row.projectId);
				if (project !== undefined) return { project, sessionId, workspaceId: row.workspaceId };
			}
		}
		return undefined;
	},


	/** 反查：某工作区属于哪个课题（该空间内所有会话都共享课题标识与记忆）。 */
	getProjectByWorkspace(workspaceId) {
		for (const key of this.table("sessions").keys()) {
			const row = this.table("sessions").get(key);
			if (row.workspaceId === workspaceId) {
				const project = this.table("projects").get(row.projectId);
				if (project !== undefined) return { project, workspaceId, sessionIds: row.sessionIds ?? [] };
			}
		}
		return undefined;
	},


	/** 反查：某工作目录（cwd）属于哪个课题。匹配 project.workspacePath，
	 *  不依赖绑定记录——同一课题空间里手动新建的会话也能识别课题。 */
	getProjectByCwd(path) {
		if (!path) return undefined;
		const normalized = String(path).replace(/[\\/]+$/, "");
		for (const id of this.table("projects").keys()) {
			const project = this.table("projects").get(id);
			if (project.workspacePath && String(project.workspacePath).replace(/[\\/]+$/, "") === normalized) {
				const row = this.getProjectSession(id);
				return { project, workspaceId: row?.workspaceId, sessionIds: row?.sessionIds ?? [] };
			}
		}
		return undefined;
	},


	getProjectMemory(projectId, version) {
		const project = this.requireProject(projectId);
		const resolvedVersion = version ?? project.memoryVersion;
		return this.table("memories").get(projectMemoryKey(projectId, resolvedVersion));
	},


	listProjectMemoryVersions(projectId) {
		this.requireProject(projectId);
		return [...this.table("memories").keys()]
			.map((key) => this.table("memories").get(key))
			.filter((row) => row.projectId === projectId)
			.sort((a, b) => Number(b.version) - Number(a.version));
	},


	async updateProjectMemory({ projectId, markdown, changeNote }) {
		const project = this.requireProject(projectId);
		const normalized = markdown?.trim();
		if (!normalized) throw new Error("project core markdown must not be empty");
		const current = this.getProjectMemory(projectId);
		if (current?.markdown === normalized) throw new Error("project core markdown has not changed");
		// 兼容升级前已存在、尚无 memory 行的项目：第一次提交从 v1 开始。
		const version = current === undefined ? "1" : String(Number(project.memoryVersion) + 1);
		const now = new Date().toISOString();
		const memory = projectMemoryVersionSchema.parse({
			id: projectMemoryKey(projectId, version),
			projectId,
			version,
			markdown: normalized,
			changeNote: changeNote?.trim() || "更新课题核心记忆",
			contentSha256: createHash("sha256").update(normalized).digest("hex"),
			createdAt: now
		});
		await this.table("memories").put(memory.id, memory);
		await this.table("projects").put(projectId, { ...project, memoryVersion: version, updatedAt: now });
		await this.writeProjectMemoryFile(projectId);
		return memory;
	},


	// ── 查询 ────────────────────────────────────────────────────────────────

	getProject(id) {
		return this.table("projects").get(id);
	}
};
