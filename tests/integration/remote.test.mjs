/**
 * Integration: ctx.lab（lab-remote bridge）经 Typert Gateway 可调用。
 *
 * 验证 host 侧 source-mode discovery：@Remote 标记（手写装饰器）的方法
 * 能被 ctx.typertGateway.invoke 解析并调用，参数按单个 request 对象传输，
 * 返回值经 { ok, value } 包装。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLite } from "../helpers/boot-lite.mjs";

const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));

async function bootRemote() {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-remote-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: vendorRoot,
		lockFile: fileURLToPath(new URL("../../vendor.lock.json", import.meta.url)),
		includePython: false,
		extraRows: [
			{ id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
			{ id: "api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"] },
			{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labTemplates", "labVersions"] },
			{ id: "lab-chemistry", name: "dsh-lab-agent/chemistry", inject: ["storageDomain"] },
			{ id: "lab-nmr", name: "dsh-lab-agent/nmr", inject: ["storageDomain"] },
			{ id: "lab-synthesis", name: "dsh-lab-agent/synthesis", inject: ["storageDomain"] },
			{ id: "lab-convert", name: "dsh-lab-agent/convert", inject: ["storageDomain"] },
			{ id: "lab-python-env", name: "dsh-lab-agent/python-env", inject: [] },
			{ id: "lab-remote", name: "dsh-lab-agent/remote", inject: ["labVersions", "labGoals", "labTemplates", "labTasks", "labChemistry", "labNmr", "labSynthesis", "labPython", "labConvert"] }
		]
	});
	await handle.ctx.labVersions.bootstrapFromVendor();
	return { handle, dir };
}

async function invoke(ctx, method, args = {}) {
	return await ctx.typertGateway.invoke({ namespace: "lab", method, args });
}

test("lab remote: gateway dispatches marked methods with request-argument contract", async () => {
	const { handle, dir } = await bootRemote();
	try {
		const ctx = handle.ctx;

		// goals_list（无参）
		const listed = await invoke(ctx, "goals_list");
		assert.ok(Array.isArray(listed.goals));
		assert.ok(listed.goals.some((g) => g.id === "default-prodrug-polymer"));

		// goals_resolve（request 对象）
		const resolved = await invoke(ctx, "goals_resolve", { request: { id: "default-prodrug-polymer", version: "1" } });
		assert.equal(resolved.goal.id, "default-prodrug-polymer");

		// goals_create + goals_delete（写路径）
		const created = await invoke(ctx, "goals_create", { request: { id: "remote-test-goal", fields: { name: "remote goal", researchQuestions: ["Q"] } } });
		assert.equal(created.goal.version, "1");
		const deleted = await invoke(ctx, "goals_delete", { request: { id: "remote-test-goal" } });
		assert.equal(deleted.ok, true);

		// versions_list
		const versions = await invoke(ctx, "versions_list");
		assert.ok(versions.rows.length >= 1);

		// 未注册方法 → 报错（无静默）
		await assert.rejects(() => invoke(ctx, "not_a_method"), /no active Remote method/);

		// 参数不匹配 → 报错
		await assert.rejects(() => invoke(ctx, "goals_resolve", { req: {} }), /args fields do not match/);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
