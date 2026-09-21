#!/usr/bin/env node
/**
 * dsh-lab-agent: 给已安装的 markitdown 打「magika 可选化」补丁。
 *
 * 用法（install.sh 与手工部署都用它）：
 *   node scripts/patch-markitdown.mjs patch  --target <site-packages>/markitdown/_markitdown.py
 *   node scripts/patch-markitdown.mjs verify --target <...>
 *   node scripts/patch-markitdown.mjs revert --target <...>
 *
 * 目标文件必须是**未经改动**的 markitdown 0.1.7；补丁前强制核对 sha256，
 * 不认识的文件一律拒绝修改（与 patch-dsh-runtime.mjs 同一纪律）。
 * 补丁旁另存 .ibm-lab-agent.bak 便于人工回退。
 */

import { createHash } from "node:crypto";
import { chmod, copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	applyMarkitdownPatch,
	inspectMarkitdownPatch,
	MARKITDOWN_PATCH_VERSION,
	MARKITDOWN_PRISTINE_SHA256,
	revertMarkitdownPatch
} from "../src/markitdown-patch.js";

function parseArgs(argv) {
	const command = argv[0] ?? "verify";
	const options = {};
	for (let i = 1; i < argv.length; i++) {
		if (argv[i] === "--target") options.target = argv[++i];
		else if (argv[i] === "--expect-sha256") options.expectSha256 = argv[++i]?.toLowerCase();
		else throw new Error(`unknown argument: ${argv[i]}`);
	}
	if (!options.target) throw new Error("--target <.../markitdown/_markitdown.py> is required");
	return { command, ...options, target: resolve(options.target) };
}

function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

function describeWriteFailure(path, error) {
	const code = error?.code ?? error?.message ?? "unknown";
	return `无法写入 ${path}（${code}）。打包/全局安装的 site-packages 常为只读；` +
		"请指向用户目录内可写的 venv（install.sh 用的是 $DSH_HOME/lab-agent/.venv）。";
}

async function atomicWrite(path, content, mode) {
	const temporary = `${path}.ibm-lab-agent-${process.pid}.tmp`;
	try {
		await writeFile(temporary, content, "utf8");
		await chmod(temporary, mode);
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw new Error(describeWriteFailure(path, error));
	}
}

async function main() {
	const { command, target, expectSha256 } = parseArgs(process.argv.slice(2));
	const source = await readFile(target, "utf8");
	const state = inspectMarkitdownPatch(source);

	if (command === "verify") {
		const ok = state.patched && state.patchedAnchors;
		console.log(ok ? `markitdown patch present: ${target}` : `markitdown patch absent: ${target}`);
		process.exitCode = ok ? 0 : 1;
		return;
	}

	if (command === "patch") {
		if (state.patched && state.patchedAnchors) {
			console.log(`markitdown patch already present: ${target}`);
			return;
		}
		if (!state.pristineAnchors) {
			throw new Error(
				`拒绝修改：${target} 不是预期的 markitdown ${MARKITDOWN_PATCH_VERSION} 源码` +
				`（锚点不匹配）。若上游已把 magika 转为可选，本补丁即可退役。`
			);
		}
		const actual = sha256(source);
		const expected = (expectSha256 ?? MARKITDOWN_PRISTINE_SHA256).toLowerCase();
		if (actual !== expected) {
			throw new Error(`拒绝修改：sha256=${actual}，期望 ${expected}（未知的 markitdown 构建）`);
		}
		const info = await stat(target);
		try {
			await copyFile(target, `${target}.ibm-lab-agent.bak`);
		} catch (error) {
			throw new Error(describeWriteFailure(`${target}.ibm-lab-agent.bak`, error));
		}
		await atomicWrite(target, applyMarkitdownPatch(source), info.mode);
		console.log(`patched markitdown ${MARKITDOWN_PATCH_VERSION}: magika 变为可选`);
		return;
	}

	if (command === "revert") {
		if (!state.patched) {
			console.log(`markitdown patch not present: ${target}`);
			return;
		}
		const info = await stat(target);
		await atomicWrite(target, revertMarkitdownPatch(source), info.mode);
		console.log(`reverted markitdown patch: ${target}`);
		return;
	}

	throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
	console.error(`patch-markitdown failed: ${error.message}`);
	process.exit(1);
});
