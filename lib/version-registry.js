/**
 * dsh-lab-agent: NatureSkillVersion registry (Cordis host service).
 *
 * Provides `ctx.labVersions` on the host plane. Durable records live in the
 * `lab_agent` storage domain (`nature_skill_versions` table, JSON backend),
 * keyed `skillName@commitSha` so an upgrade keeps every prior version row and
 * old reports stay resolvable to the exact skill version they cite.
 *
 * Writes are explicit only: the install script / upgrade tool call
 * `bootstrapFromVendor`; the regression runner records pass dates. The
 * service never mutates rows from a boot.
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { COMMIT_SHA_RE, readVendorLock } from "../src/lockfile.js";
import { scanSkillsRoot } from "../src/skill-catalog.js";

/** One durable NatureSkillVersion record (see plan §六). */
export const natureSkillVersionSchema = z.object({
	skillName: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
	repo: z.string().min(1),
	commitSha: z.string().regex(COMMIT_SHA_RE),
	manifestVersion: z.string().min(1),
	license: z.string().min(1),
	pythonDepsLockSha256: z.string().min(1),
	regressionPassedAt: z.string().optional(),
	pinnedAt: z.string(),
	updatedAt: z.string()
});

/** Domain declaration: one table of NatureSkillVersion records. */
export const labAgentDomainSpec = defineDomain({
	name: "lab_agent",
	version: 0,
	tables: {
		nature_skill_versions: domainTable(natureSkillVersionSchema)
	}
});

const key = (skillName, commitSha) => `${skillName}@${commitSha}`;

/**
 * Host service: read the pinned skill versions, resolve current versions,
 * and (via explicit calls) register/bootstrap them.
 */
export class LabVersionsService extends Service {
	static inject = ["storageDomain"];
	domain;
	table;

	/** @param config {{ vendorDir?: string, lockFile?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labVersions");
		this.config = config;
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labAgentDomainSpec);
		// ctx.effect(fn) runs fn IMMEDIATELY and collects its returned disposer,
		// hence the double arrow: close runs on fiber dispose, not at open.
		this.ctx.effect(() => () => domain.close(), "lab-agent.domainClose");
		this.domain = domain;
		this.table = domain.table("nature_skill_versions");
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labVersions is not started yet");
		return this.table;
	}

	/** All registered rows (key → record), keyed `skillName@commitSha`. */
	snapshot() {
		const table = this.requireTable();
		const rows = [];
		for (const k of table.keys()) rows.push({ key: k, record: table.get(k) });
		return rows.sort((a, b) => a.key.localeCompare(b.key));
	}

	/** The current (highest pinnedAt) version row for one skill. */
	resolveNatureSkill(skillName) {
		const rows = this.snapshot()
			.filter(({ record }) => record.skillName === skillName)
			.map(({ record }) => record)
			.sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt));
		return rows[0];
	}

	/** Upsert one NatureSkillVersion record. Async so validation failures reject. */
	async registerNatureSkill(entry) {
		const record = natureSkillVersionSchema.parse({ ...entry, updatedAt: new Date().toISOString() });
		await this.requireTable().put(key(record.skillName, record.commitSha), record);
		return record;
	}

	/**
	 * Bootstrap/refresh the registry from the deployment's vendored tree and
	 * vendor.lock.json. Idempotent: existing rows are overwritten with the
	 * current lock facts.
	 */
	async bootstrapFromVendor({ vendorDir = this.config.vendorDir, lockFile = this.config.lockFile } = {}) {
		if (!vendorDir || !lockFile) throw new Error("labVersions.bootstrapFromVendor requires vendorDir and lockFile (config or arguments)");
		const lock = await readVendorLock(lockFile);
		const skillsRoot = join(vendorDir, "skills");
		const { skills, diagnostics } = await scanSkillsRoot(skillsRoot, lock.skills.map((s) => s.name));
		const byName = new Map(skills.map((s) => [s.name, s]));
		const registered = [];
		for (const entry of lock.skills) {
			const scanned = byName.get(entry.name);
			const record = await this.registerNatureSkill({
				skillName: entry.name,
				repo: lock.repo,
				commitSha: lock.pinnedCommit,
				manifestVersion: scanned?.manifestVersion ?? entry.manifestVersion,
				license: lock.license,
				pythonDepsLockSha256: lock.pythonDeps.sha256,
				pinnedAt: lock.pinnedAt
			});
			registered.push(record);
		}
		return { registered, diagnostics, lock };
	}

	/** Record that the regression suite passed for the pinned versions. */
	async markRegressionPassed({ at = new Date().toISOString() } = {}) {
		const rows = this.snapshot();
		for (const { record } of rows) {
			await this.requireTable().put(key(record.skillName, record.commitSha), { ...record, regressionPassedAt: at, updatedAt: at });
		}
		return rows.length;
	}
}

export default LabVersionsService;
