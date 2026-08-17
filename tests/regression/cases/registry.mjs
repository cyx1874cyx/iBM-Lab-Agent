/**
 * Regression case: NatureSkillVersion registry.
 *
 * Boots a throwaway store, bootstraps the registry from the vendor tree +
 * lock, and asserts every locked skill resolves to a row carrying the pinned
 * commit, license, and python lock hash.
 */

export default {
	name: "registry",
	description: "NatureSkillVersion rows match vendor.lock.json after bootstrap",
	tags: ["registry", "nature-skills"],
	required: [],
	async run(ctx) {
		return await ctx.withTempRegistry(async (labVersions) => {
			const { registered, diagnostics } = await labVersions.bootstrapFromVendor();
			const problems = [];
			for (const d of diagnostics) {
				problems.push(`${d.skill}: ${d.error ?? `missing ${d.missing?.join(", ")}`}`);
			}
			for (const lockSkill of ctx.vendorLock.skills) {
				const row = labVersions.resolveNatureSkill(lockSkill.name);
				if (!row) {
					problems.push(`${lockSkill.name}: not resolvable`);
					continue;
				}
				if (row.commitSha !== ctx.vendorLock.pinnedCommit) problems.push(`${lockSkill.name}: commit ${row.commitSha} != pinned ${ctx.vendorLock.pinnedCommit}`);
				if (row.manifestVersion !== lockSkill.manifestVersion) problems.push(`${lockSkill.name}: manifest ${row.manifestVersion} != locked ${lockSkill.manifestVersion}`);
				if (row.license !== ctx.vendorLock.license) problems.push(`${lockSkill.name}: license ${row.license} != locked ${ctx.vendorLock.license}`);
				if (row.pythonDepsLockSha256 !== ctx.vendorLock.pythonDeps.sha256) problems.push(`${lockSkill.name}: python lock hash mismatch`);
			}
			if (labVersions.snapshot().length < ctx.vendorLock.skills.length) problems.push("snapshot smaller than lock");
			return {
				pass: problems.length === 0,
				details: problems.length === 0 ? `${registered.length} rows registered and resolvable` : problems.join("; ")
			};
		});
	}
};
