/**
 * Integration smoke: boot the lab rows through the real harness loader
 * (dsh-app-boot + storage-domain) against a fixture vendor tree, and exercise
 * the NatureSkillVersion registry and the python-env service.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVendorLock } from "../../src/lockfile.js";
import { bootLite } from "../helpers/boot-lite.mjs";

const SHA = "c171989db699bd601d4373912b3fb8db96ecc95b";

async function makeFixture() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-int-"));
	const skills = join(dir, "vendor", "nature-skills", "skills");
	for (const name of ["nature-reader", "nature-shared"]) {
		const skill = join(skills, name);
		for (const sub of ["scripts", "references", "static", "agents", "evals"]) {
			await mkdir(join(skill, sub), { recursive: true });
		}
		await writeFile(join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\nbody\n`, "utf8");
		await writeFile(join(skill, "manifest.yaml"), `version: 1.0.0\n`, "utf8");
		await writeFile(join(skill, "README.md"), `readme\n`, "utf8");
	}
	const lock = createVendorLock({
		repo: "https://github.com/Yuan1z0825/nature-skills.git",
		pinnedCommit: SHA,
		pinnedAt: "2026-08-17T00:00:00.000Z",
		license: "Apache-2.0",
		skills: [
			{ name: "nature-reader", manifestVersion: "1.0.0", dir: "skills/nature-reader", requiredFiles: ["SKILL.md", "manifest.yaml", "scripts", "references"] },
			{ name: "nature-shared", manifestVersion: "1.0.0", dir: "skills/nature-shared", requiredFiles: ["SKILL.md", "manifest.yaml", "scripts", "references"] }
		],
		pythonDepsSha256: "ab".repeat(32)
	});
	const lockPath = join(dir, "vendor", "vendor.lock.json");
	await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
	return {
		dir,
		vendorDir: join(dir, "vendor", "nature-skills"),
		lockFile: lockPath,
		storageRoot: join(dir, "storages"),
		venvDir: join(dir, ".venv"),
		requirementsLock: join(dir, "requirements.lock")
	};
}

test("labVersions bootstraps, resolves, and marks regression pass", async () => {
	const fixture = await makeFixture();
	try {
		await writeFile(fixture.requirementsLock, "# empty\n", "utf8");
		const handle = await bootLite({
			storageRoot: fixture.storageRoot,
			vendorDir: fixture.vendorDir,
			lockFile: fixture.lockFile,
			venvDir: fixture.venvDir,
			requirementsLock: fixture.requirementsLock
		});
		try {
			const service = handle.ctx.labVersions;
			assert.ok(service, "labVersions service mounted");

			const { registered, diagnostics } = await service.bootstrapFromVendor();
			assert.equal(registered.length, 2);
			assert.deepEqual(diagnostics, []);

			const row = service.resolveNatureSkill("nature-reader");
			assert.equal(row.commitSha, SHA);
			assert.equal(row.manifestVersion, "1.0.0");
			assert.equal(row.license, "Apache-2.0");
			assert.equal(row.pythonDepsLockSha256, "ab".repeat(32));
			assert.equal(service.resolveNatureSkill("nature-unknown"), undefined);

			// an upgrade (new commit) keeps both version rows
			const NEW_SHA = "a".repeat(40);
			await service.registerNatureSkill({ ...row, commitSha: NEW_SHA, manifestVersion: "2.0.0", pinnedAt: "2026-08-18T00:00:00.000Z" });
			assert.equal(service.snapshot().length, 3);
			assert.equal(service.resolveNatureSkill("nature-reader").manifestVersion, "2.0.0");
			assert.equal(service.resolveNatureSkill("nature-reader").commitSha, NEW_SHA);

			// regression pass stamps every row
			const n = await service.markRegressionPassed({ at: "2026-08-19T00:00:00.000Z" });
			assert.equal(n, 3);
			assert.ok(service.snapshot().every(({ record }) => record.regressionPassedAt === "2026-08-19T00:00:00.000Z"));

			// python service is wired and preflight reports the missing venv
			const python = handle.ctx.labPython;
			const state = await python.preflight();
			assert.equal(state.ok, false);
			assert.ok(state.issues.some((i) => i.includes("venv")));
			assert.equal(await python.pythonVersion(), null);
		} finally {
			await handle.dispose();
		}
	} finally {
		await rm(fixture.dir, { recursive: true, force: true });
	}
});

test("labVersions rejects invalid records", async () => {
	const fixture = await makeFixture();
	try {
		const handle = await bootLite({
			storageRoot: fixture.storageRoot,
			vendorDir: fixture.vendorDir,
			lockFile: fixture.lockFile,
			includePython: false
		});
		try {
			await assert.rejects(
				handle.ctx.labVersions.registerNatureSkill({
					skillName: "Bad Name",
					repo: "r",
					commitSha: SHA,
					manifestVersion: "1",
					license: "Apache-2.0",
					pythonDepsLockSha256: "ab".repeat(32),
					pinnedAt: "2026-08-17T00:00:00.000Z"
				}),
				/skillName/
			);
		} finally {
			await handle.dispose();
		}
	} finally {
		await rm(fixture.dir, { recursive: true, force: true });
	}
});
