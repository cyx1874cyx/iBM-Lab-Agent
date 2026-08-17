/**
 * dsh-lab-agent: ReadingGoalProfile 服务（Cordis host service, ctx.labGoals）。
 *
 * 计划 §三：用户创建/保存/复制/修改精读目标并在每次任务中选择版本。
 * 版本行不可变（key id@version）；update 发布新版本；delete 发布 archived
 * 版本（历史与快照永远可读）；内置聚前药默认目标幂等种子。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import {
	BUILTIN_GOALS,
	cloneGoal,
	goalKey,
	nextVersion,
	readingGoalProfileSchema,
	toPaperCardRequirements
} from "../src/goal-profile.js";

/** Domain declaration: reading goal profiles (own domain — facility opens once per name). */
export const labGoalsDomainSpec = defineDomain({
	name: "lab_goal_profiles",
	version: 0,
	tables: {
		reading_goal_profiles: domainTable(readingGoalProfileSchema)
	}
});

export class LabGoalsService extends Service {
	static inject = ["storageDomain"];
	domain;
	table;

	constructor(ctx, config = {}) {
		super(ctx, "labGoals");
		this.config = config;
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labGoalsDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.goals.domainClose");
		this.domain = domain;
		this.table = domain.table("reading_goal_profiles");
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labGoals is not started yet");
		return this.table;
	}

	/** 该 id 的全部版本行（key id@*，新→旧）。 */
	rowsFor(id) {
		const table = this.requireTable();
		const rows = [];
		for (const k of table.keys()) {
			if (!k.startsWith(`${id}@`)) continue;
			rows.push(table.get(k));
		}
		return rows.sort((a, b) => Number(b.version) - Number(a.version));
	}

	/**
	 * 当前可用版本：最大版本行且 status 为 active。版本单调递增且删除只追加
	 * archived 尾部，所以最大版本的状态即该 profile 的当前状态。
	 */
	latestActive(id) {
		const rows = this.rowsFor(id);
		const newest = rows[0];
		return newest !== undefined && newest.status === "active" ? newest : undefined;
	}

	/** 幂等种子内置默认（仅缺省时写入；失败只告警，不炸启动）。 */
	async ensureSeed() {
		for (const builtin of BUILTIN_GOALS) {
			if (this.latestActive(builtin.id) !== undefined) continue;
			try {
				await this.requireTable().put(goalKey(builtin.id, builtin.version), builtin);
			} catch (error) {
				this.ctx.logger.warn(`labGoals: seed '${builtin.id}' failed: ${String(error)}`);
			}
		}
	}

	/** 可用目标列表（每个 id 当前版本的摘要）。 */
	async list() {
		await this.ensureSeed();
		const table = this.requireTable();
		const seen = new Set();
		const out = [];
		// 倒序遍历：每个 id 首次遇到即最新版本，其状态决定是否列出
		for (const k of [...table.keys()].sort().reverse()) {
			const row = table.get(k);
			if (seen.has(row.id)) continue;
			seen.add(row.id);
			if (row.status !== "active") continue;
			out.push({ id: row.id, version: row.version, name: row.name, topics: row.topics, tags: row.tags, updatedAt: row.updatedAt });
		}
		return out;
	}

	/** 解析目标版本行；version 缺省取最新 active。历史/archived 版本始终可读。 */
	async resolve(id, version) {
		await this.ensureSeed();
		if (version !== undefined) {
			const row = this.requireTable().get(goalKey(id, String(version)));
			return row === undefined ? undefined : { ...row };
		}
		const row = this.latestActive(id);
		return row === undefined ? undefined : { ...row };
	}

	/** 创建目标 v1。 */
	async create(id, fields) {
		await this.ensureSeed();
		if (this.rowsFor(id).length > 0) throw new Error(`goal profile '${id}' already exists (active or archived; ids are never reused)`);
		const now = new Date().toISOString();
		const row = readingGoalProfileSchema.parse({ ...fields, id, version: "1", status: "active", createdAt: now, updatedAt: now });
		await this.requireTable().put(goalKey(id, "1"), row);
		return { ...row };
	}

	/** 修改目标：基于最新 active 版本发布新版本（旧版本/旧报告引用不变）。 */
	async update(id, fields) {
		await this.ensureSeed();
		const base = this.latestActive(id);
		if (base === undefined) throw new Error(`goal profile '${id}' not found`);
		const now = new Date().toISOString();
		const version = nextVersion(this.rowsFor(id).map((r) => r.version));
		const row = readingGoalProfileSchema.parse({ ...base, ...fields, id, version, status: "active", updatedAt: now });
		await this.requireTable().put(goalKey(id, version), row);
		return { ...row };
	}

	/** 复制目标为新 id（v1）。 */
	async copy(id, newId, name) {
		await this.ensureSeed();
		const source = this.latestActive(id);
		if (source === undefined) throw new Error(`goal profile '${id}' not found`);
		if (this.rowsFor(newId).length > 0) throw new Error(`goal profile '${newId}' already exists (active or archived)`);
		const row = cloneGoal(source, newId, name ?? `${source.name}（副本）`);
		await this.requireTable().put(goalKey(newId, "1"), row);
		return { ...row };
	}

	/** 删除目标（从可用列表移除；历史版本与快照仍可读）。 */
	async deleteProfile(id) {
		await this.ensureSeed();
		const base = this.latestActive(id);
		if (base === undefined) throw new Error(`goal profile '${id}' not found`);
		const now = new Date().toISOString();
		const version = nextVersion(this.rowsFor(id).map((r) => r.version));
		const row = { ...base, version, status: "archived", updatedAt: now };
		await this.requireTable().put(goalKey(id, version), row);
		return true;
	}

	/** 任务快照：返回目标版本的深拷贝（任务保存引用；后续修改不影响旧报告）。 */
	async snapshotForTask(id, version) {
		const row = await this.resolve(id, version);
		if (row === undefined) throw new Error(`goal profile '${id}'@${version ?? "latest"} not found`);
		return structuredClone(row);
	}

	/** 转换为 nature-paper-card 重点审查要求。 */
	toPaperCardRequirements(goal) {
		return toPaperCardRequirements(goal);
	}
}

export default LabGoalsService;
