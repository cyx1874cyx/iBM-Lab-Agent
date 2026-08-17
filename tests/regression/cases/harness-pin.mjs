/**
 * Regression case: harness version pin.
 *
 * harness.lock.json must match the actual harness installation the plugin is
 * developed/run against (the "固定 Harness commit" requirement, pinned as
 * exact npm package versions).
 */

import { findHarnessNodeModules, harnessPackageVersion } from "../../../src/harness-root.js";

export default {
	name: "harness-pin",
	description: "harness.lock.json matches the harness installation package versions",
	tags: ["harness"],
	required: [],
	async run(ctx) {
		const nodeModules = findHarnessNodeModules();
		const problems = [];
		if (!nodeModules) {
			return { pass: false, details: "cannot locate harness node_modules (set DSH_HARNESS_NODE_MODULES or put dsh on PATH)" };
		}
		for (const [name, expected] of Object.entries(ctx.harnessLock.packages)) {
			const actual = harnessPackageVersion(nodeModules, name);
			if (actual === undefined) {
				problems.push(`${name}: not found in harness install`);
			} else if (actual !== expected) {
				problems.push(`${name}: installed ${actual} != locked ${expected}`);
			}
		}
		return {
			pass: problems.length === 0,
			details: problems.length === 0 ? `${Object.keys(ctx.harnessLock.packages).length} packages match harness.lock.json` : problems.join("; ")
		};
	}
};
