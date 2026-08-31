/**
 * Regression case: python dependency lock.
 *
 * python/requirements.lock must exist, contain only valid pinned
 * requirements, and its sha256 must match vendor.lock.json's pythonDeps hash.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pythonLockSha256 } from "../../../src/python-lock-hash.js";

const REQ_LINE = /^[A-Za-z0-9._-]+(==|>=|<=|~=|!=)[^\s]+(\s+#.*)?$/;

export default {
	name: "python-lock",
	description: "requirements.lock parses and its hash matches vendor.lock.json",
	tags: ["python"],
	required: [],
	async run(ctx) {
		const lockPath = join(ctx.repoRoot, "python", "requirements.lock");
		const text = await readFile(lockPath, "utf8");
		const lines = text
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		const problems = [];
		for (const line of lines) {
			if (!REQ_LINE.test(line)) problems.push(`invalid requirement line: ${line}`);
		}
		const sha = pythonLockSha256(await readFile(lockPath));
		if (sha !== ctx.vendorLock.pythonDeps.sha256) {
			problems.push(`hash mismatch: file ${sha} != lock ${ctx.vendorLock.pythonDeps.sha256}`);
		}
		return {
			pass: problems.length === 0,
			details: problems.length === 0 ? `${lines.length} pinned requirements, hash ok` : problems.join("; ")
		};
	}
};
