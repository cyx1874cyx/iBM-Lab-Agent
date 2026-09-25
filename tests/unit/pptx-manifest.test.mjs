/**
 * Unit: lib/pptx-manifest.js —— pptx-cli 封装（envelope 解析 / 错误映射 / argv / 降级）。
 *
 * 硬约束：CI 环境**不装 pptx-cli**，所以这里全部用注入的假 spawn 与固定 envelope，
 * 不依赖真实安装；真实调用只在 tests/integration/pptx-cli-manifest.test.mjs（可跳过）里跑。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyExitCode,
	describeCliUnavailable,
	errorKindFromCode,
	extractPptxCliEnvelope,
	isManifestPackage,
	loadManifestPackage,
	mapCliError,
	mapCliErrors,
	runPptxCli,
	summarizeManifest
} from "../../lib/pptx-manifest.js";
import { writeManifestPackage } from "../fixtures/ppt-manifest-fixture.mjs";

/** 假子进程：可编排 stdout/stderr/退出码/kill。 */
function fakeSpawn({ stdout = "", stderr = "", code = 0, error, hang = false } = {}) {
	const calls = [];
	const impl = (command, args, options) => {
		calls.push({ command, args, options });
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.killed = false;
		child.kill = () => { child.killed = true; };
		if (!hang) {
			setImmediate(() => {
				if (stdout) child.stdout.emit("data", stdout);
				if (stderr) child.stderr.emit("data", stderr);
				if (error) child.emit("error", new Error(error));
				else child.emit("exit", code);
			});
		}
		return child;
	};
	return { impl, calls };
}

const ENVELOPE = {
	schema_version: "1.0",
	request_id: "req_test",
	ok: true,
	command: "layouts.list",
	result: { count: 1, layouts: [{ id: "item" }] },
	warnings: [],
	errors: [],
	metrics: { duration_ms: 1 }
};

test("extractPptxCliEnvelope 只认真正的 envelope，容忍前置日志行", () => {
	assert.deepEqual(extractPptxCliEnvelope(`${JSON.stringify(ENVELOPE)}\n`), ENVELOPE);
	assert.deepEqual(extractPptxCliEnvelope(`some log line\n${JSON.stringify(ENVELOPE)}\n`), ENVELOPE);
	assert.equal(extractPptxCliEnvelope("Usage: python -m pptx_cli [OPTIONS]"), undefined);
	assert.equal(extractPptxCliEnvelope('{"not":"an envelope"}'), undefined);
	assert.equal(extractPptxCliEnvelope(""), undefined);
	assert.equal(extractPptxCliEnvelope("[1,2,3]"), undefined);
});

test("退出码与错误码分类遵循 pptx-cli 的契约", () => {
	assert.equal(classifyExitCode(0).kind, "ok");
	assert.equal(classifyExitCode(10).kind, "validation");
	assert.equal(classifyExitCode(50).kind, "io");
	assert.equal(classifyExitCode(90).kind, "internal");
	assert.equal(classifyExitCode(777).kind, "internal");
	assert.equal(errorKindFromCode("ERR_VALIDATION_TABLE_PAYLOAD"), "validation");
	assert.equal(errorKindFromCode("ERR_IO_NOT_FOUND"), "io");
	assert.equal(errorKindFromCode("ERR_SCHEMA_INVALID"), "validation");
	assert.equal(errorKindFromCode("SOMETHING_ELSE"), "unknown");
});

test("mapCliError 给出 code/kind/hint，未知码不猜语义", () => {
	const known = mapCliError({ code: "ERR_IO_NOT_FOUND", message: "Deck not found: /x", retryable: true, suggested_action: "retry" });
	assert.equal(known.kind, "io");
	assert.match(known.hint, /路径不存在/);
	assert.equal(known.retryable, true);
	assert.equal(known.suggestedAction, "retry");

	const unknown = mapCliError({ code: "ERR_WEIRD", message: "boom" });
	assert.equal(unknown.kind, "unknown");
	assert.match(unknown.hint, /未知 pptx-cli 错误码/);
	assert.deepEqual(mapCliErrors(undefined), []);
	assert.equal(mapCliErrors([{ code: "ERR_IO_NOT_FOUND", message: "x" }]).length, 1);
});

test("runPptxCli 以 python -m pptx_cli 调用并解析 envelope", async () => {
	const { impl, calls } = fakeSpawn({ stdout: `${JSON.stringify(ENVELOPE)}\n` });
	const result = await runPptxCli(["layouts", "list", "--manifest", "/m", "--format", "json"], { python: "/usr/bin/python3", spawnImpl: impl });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].command, "/usr/bin/python3");
	assert.deepEqual(calls[0].args, ["-m", "pptx_cli", "layouts", "list", "--manifest", "/m", "--format", "json"]);
	assert.equal(result.available, true);
	assert.equal(result.ok, true);
	assert.equal(result.pythonSource, "explicit");
	assert.equal(result.envelope.result.count, 1);
});

test("runPptxCli：非零退出码 + errors[] → 诊断带 code/kind/hint", async () => {
	const failure = { ...ENVELOPE, ok: false, errors: [{ code: "ERR_IO_NOT_FOUND", message: "Deck not found", retryable: true }] };
	const { impl } = fakeSpawn({ stdout: `${JSON.stringify(failure)}\n`, code: 50 });
	const result = await runPptxCli(["validate", "--manifest", "/m", "--deck", "/nope"], { python: "py", spawnImpl: impl });
	assert.equal(result.ok, false);
	assert.equal(result.code, 50);
	assert.equal(result.failure, "io");
	assert.equal(result.errorCode, "ERR_IO_NOT_FOUND");
	assert.match(result.error, /Deck not found/);
});

test("runPptxCli：非 JSON 输出与缺模块都给明确诊断，不抛异常", async () => {
	const plain = fakeSpawn({ stdout: "hello\n", code: 2 });
	const plainResult = await runPptxCli(["doctor"], { python: "py", spawnImpl: plain.impl });
	assert.equal(plainResult.ok, false);
	assert.equal(plainResult.failure, "no-envelope");
	assert.match(plainResult.error, /未输出 JSON envelope/);

	const missing = fakeSpawn({ stderr: "/usr/bin/python3: No module named pptx_cli\n", code: 1 });
	const missingResult = await runPptxCli(["doctor"], { python: "python3", spawnImpl: missing.impl });
	assert.equal(missingResult.ok, false);
	assert.match(missingResult.error, /pptx-cli 不可用/);
	assert.match(missingResult.error, /No module named/);
});

test("runPptxCli：超时会杀进程并返回 timeout 诊断", async () => {
	const { impl, calls } = fakeSpawn({ hang: true });
	const result = await runPptxCli(["init", "t.pptx"], { python: "py", timeoutMs: 20, spawnImpl: impl });
	assert.equal(result.ok, false);
	assert.equal(result.failure, "timeout");
	assert.match(result.error, /超时/);
	assert.equal(calls.length, 1);
});

test("runPptxCli：没有可用解释器时返回 available=false 的不可用说明", async () => {
	const result = await runPptxCli(["doctor"], { python: undefined, platform: "linux", venvPython: "/nonexistent/python", spawnImpl: fakeSpawn({}).impl });
	// 测试机有 python3 时这里可能是 available=true；两种都必须是"不抛异常 + 有诊断字段"。
	assert.equal(typeof result.available, "boolean");
	if (!result.available) {
		assert.equal(result.failure, "unavailable");
		assert.match(result.hint ?? result.error, /pptx-cli/);
	}
	// 取消兼容层后，说明必须点明"该模板不能用于生成 PPT"，而不是"降级到旧路径"。
	assert.match(describeCliUnavailable({ error: "no python interpreter available" }), /不能用于生成 PPT/);
	assert.match(describeCliUnavailable({ error: "no python interpreter available" }), /重新导入/);
});

test("命令封装拼出正确的 argv（init/layouts/placeholders/theme/validate/diff/doctor）", async () => {
	const cases = [
		["initTemplateManifest", { pptxPath: "t.pptx", outDir: "/out" }, ["init", "t.pptx", "--out", "/out", "--format", "json"]],
		["listLayouts", { manifestDir: "/m" }, ["layouts", "list", "--manifest", "/m", "--format", "json"]],
		["listPlaceholders", { manifestDir: "/m", layoutId: "fig1" }, ["placeholders", "list", "fig1", "--manifest", "/m", "--format", "json"]],
		["showTheme", { manifestDir: "/m" }, ["theme", "show", "--manifest", "/m", "--format", "json"]],
		["validateDeck", { manifestDir: "/m", deckPath: "/d.pptx", strict: true }, ["validate", "--manifest", "/m", "--deck", "/d.pptx", "--format", "json", "--strict"]],
		["diffManifests", { leftDir: "/a", rightDir: "/b" }, ["manifest", "diff", "/a", "/b", "--format", "json"]],
		["doctorReport", { manifestDir: "/m" }, ["doctor", "--manifest", "/m", "--format", "json"]]
	];
	const module = await import("../../lib/pptx-manifest.js");
	for (const [fn, args, expected] of cases) {
		const { impl, calls } = fakeSpawn({ stdout: `${JSON.stringify(ENVELOPE)}\n` });
		await module[fn]({ ...args, python: "py", spawnImpl: impl });
		assert.deepEqual(calls[0].args.slice(2), expected, `${fn} argv`);
	}
});

test("loadManifestPackage：缺失目录给出 ok=false，不抛", async () => {
	const result = await loadManifestPackage("/definitely/not/here");
	assert.equal(result.ok, false);
	assert.equal(result.findings[0].code, "manifest_missing");
	assert.equal(isManifestPackage("/definitely/not/here"), false);
});

test("loadManifestPackage + summarizeManifest：读夹具包并归一化槽位结构", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ppt-manifest-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	await writeManifestPackage(dir);
	assert.equal(isManifestPackage(dir), true);
	const pkg = await loadManifestPackage(dir);
	assert.equal(pkg.ok, true);
	assert.equal(pkg.findings.length, 0);
	assert.equal(pkg.manifest.layouts.length, 7);

	const summary = summarizeManifest(pkg.manifest);
	assert.equal(summary.pageSize.widthEmu, 12192000);
	assert.equal(summary.layouts.length, 7);
	const fig1 = summary.layouts.find((layout) => layout.id === "fig1");
	assert.equal(fig1.protectedElements.length, 3);
	assert.equal(fig1.placeholders.find((placeholder) => placeholder.idx === 12).capacity.font_size_pt, 14);
	assert.equal(fig1.placeholders.find((placeholder) => placeholder.idx === 10).supportedContentTypes.join(","), "image");
});

test("夹具包缺源模板副本时给出 warning（XML 级检查不可用的显式信号）", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ppt-manifest-nosrc-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	await writeManifestPackage(dir, { skipSourceTemplate: true });
	const pkg = await loadManifestPackage(dir);
	assert.equal(pkg.ok, true);
	assert.deepEqual(pkg.findings.map((finding) => finding.code), ["source_template_missing"]);
	assert.equal(pkg.sourceTemplate, undefined);
});

