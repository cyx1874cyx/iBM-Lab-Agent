/**
 * dsh-lab-agent / labTasks — 产物溯源记录（ArtifactProvenance）与产物 kind → skill 映射。
 */



/** 产物 kind → 关联 nature skill 名。 */
export const KIND_TO_SKILL = {
	search: "nature-academic-search",
	"source-bundle": "nature-reader",
	"reading-report": "nature-paper-card",
	presentation: "nature-paper2ppt"
};

export const provenanceMethods = {

	/** 记录 ArtifactProvenance。 */
	async recordProvenance({ projectId, kind, runId, recordId, inputs, model, source, replaced }) {
		const skillName = KIND_TO_SKILL[kind];
		const skill = skillName ? await this.ctx.ibmRuntime.skillSnapshot(skillName) : undefined;
		return this.ctx.ibmCore.recordProvenance({
			projectId, kind, runId, recordId, inputs, model, source, replaced,
			skillVersions: skill ? [{ skillName: skill.skillName, commitSha: skill.commitSha, manifestVersion: skill.manifestVersion }] : []
		});
	},


	listProvenance(projectId) {
		return this.ctx.ibmCore.listProvenance(projectId);
	}
};
