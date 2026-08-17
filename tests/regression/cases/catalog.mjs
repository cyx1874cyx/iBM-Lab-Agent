/**
 * Regression case: nature-skills catalog integrity.
 *
 * Every pinned skill must keep its complete directory: every entry recorded
 * in vendor.lock.json at pin time must still exist, SKILL.md and
 * manifest.yaml must be present, and the manifest version must match the
 * lock — the "keep the complete skill directory" requirement from the plan.
 */

export default {
	name: "catalog",
	description: "pinned skill directories complete; manifest versions match vendor.lock.json",
	tags: ["nature-skills"],
	required: [],
	async run(ctx) {
		const { skills, diagnostics } = await ctx.scan();
		const problems = [];
		for (const d of diagnostics) {
			problems.push(`${d.skill}: ${d.error ?? `missing ${d.missing.join(", ")}`}`);
		}
		const locked = new Map(ctx.vendorLock.skills.map((s) => [s.name, s]));
		for (const skill of skills) {
			const lockEntry = locked.get(skill.name);
			if (!lockEntry) {
				problems.push(`${skill.name}: scanned but absent from vendor.lock.json`);
				continue;
			}
			if (skill.manifestVersion !== lockEntry.manifestVersion) {
				problems.push(`${skill.name}: manifest version ${skill.manifestVersion} != locked ${lockEntry.manifestVersion}`);
			}
			for (const entry of lockEntry.requiredFiles) {
				if (!(entry in skill.entries)) problems.push(`${skill.name}: entry '${entry}' missing (was present at pin time)`);
			}
		}
		for (const name of locked.keys()) {
			if (!skills.some((s) => s.name === name)) problems.push(`${name}: locked but not scanned`);
		}
		return {
			pass: problems.length === 0,
			details: problems.length === 0 ? `${skills.length} skills intact @ ${ctx.vendorLock.pinnedCommit.slice(0, 12)}` : problems.join("; ")
		};
	}
};
