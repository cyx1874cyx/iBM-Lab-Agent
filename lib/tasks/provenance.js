/**
 * dsh-lab-agent / labTasks — 产物溯源记录（ArtifactProvenance）与产物 kind → skill 映射。
 */

import { createHash } from "node:crypto";
import { artifactProvenanceSchema } from "../../src/task-models.js";


/** 产物 kind → 关联 nature skill 名。 */
export const KIND_TO_SKILL = {
	search: "nature-academic-search",
	"source-bundle": "nature-reader",
	"reading-report": "nature-paper-card",
	presentation: "nature-paper2ppt"
};

export const provenanceMethods = {

	/** 记录 ArtifactProvenance。 */
	async recordProvenance({ projectId, kind, runId, inputs, model, source, replaced }) {
		const skillName = KIND_TO_SKILL[kind];
		const skill = skillName ? await this.ctx.labVersions.resolveNatureSkill(skillName) : undefined;
		const now = new Date().toISOString();
		const id = `${kind}-${runId}`;
		const record = artifactProvenanceSchema.parse({
			id,
			projectId,
			kind,
			runId,
			inputsSha256: createHash("sha256").update(JSON.stringify(inputs ?? {})).digest("hex"),
			skillVersions: skill
				? [{ skillName: skill.skillName, commitSha: skill.commitSha, manifestVersion: skill.manifestVersion }]
				: [],
			model,
			source: source ?? "labTasks",
			...(replaced ? { replaced } : {}),
			createdAt: now
		});
		await this.table("provenance").put(id, record);
		return record;
	},


	listProvenance(projectId) {
		return [...this.table("provenance").keys()]
			.map((k) => this.table("provenance").get(k))
			.filter((p) => p.projectId === projectId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}
};
