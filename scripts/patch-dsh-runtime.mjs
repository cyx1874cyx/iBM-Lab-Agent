#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	applyFakeInvokePatch,
	inspectFakeInvokePatch,
	revertFakeInvokePatch
} from "../src/dsh-runtime-patch.js";

function parseArgs(argv) {
	const command = argv[0] ?? "verify";
	const options = {};
	for (let i = 1; i < argv.length; i++) {
		if (argv[i] === "--target") options.target = argv[++i];
		else if (argv[i] === "--expect-sha256") options.expectSha256 = argv[++i]?.toLowerCase();
		else throw new Error(`unknown argument: ${argv[i]}`);
	}
	if (!options.target) throw new Error("--target <dsh-agent-loop/lib/index.js> is required");
	return { command, ...options, target: resolve(options.target) };
}

function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * 写失败时的可操作报错（路线书 3.2 的假设①：脚本隐含假设目标 node_modules 可写）。
 *
 * DSH 兼容补丁必须就地改写 dsh-agent-loop，因此目标目录只读、来自容器镜像或位于
 * 全局安装目录时会失败。裸 EACCES/EROFS 对使用者没有任何指引，这里统一转成
 * 带原因与出路的提示。
 */
function describeWriteFailure(path, error) {
	const code = error?.code ?? error?.message ?? "unknown";
	return `无法写入 ${path}（${code}）。DSH 兼容补丁要求目标 node_modules 可写：` +
		"只读挂载、容器镜像或全局安装目录下会失败。请改用用户目录内的可写安装" +
		"（install.sh 会把运行时放在用户目录），或用 --no-dsh-patch 跳过该补丁。";
}

async function atomicWrite(path, content, mode) {
	const temporary = `${path}.ibm-lab-agent-${process.pid}.tmp`;
	try {
		await writeFile(temporary, content, "utf8");
		await chmod(temporary, mode);
		await rename(temporary, path);
	} catch (error) {
		// 失败时不要留下半成品临时文件
		await rm(temporary, { force: true }).catch(() => {});
		throw new Error(describeWriteFailure(path, error));
	}
}

async function main() {
	const { command, target, expectSha256 } = parseArgs(process.argv.slice(2));
	const source = await readFile(target, "utf8");
	const state = inspectFakeInvokePatch(source);
	if (command === "verify") {
		console.log(state.patched && state.patchedAnchors ? `patch present: ${target}` : `patch absent: ${target}`);
		process.exitCode = state.patched && state.patchedAnchors ? 0 : 1;
		return;
	}
	if (command === "patch") {
		if (state.patched && state.patchedAnchors) {
			console.log(`patch already present: ${target}`);
			return;
		}
		const actual = sha256(source);
		if (expectSha256 && actual !== expectSha256) {
			throw new Error(`refusing to patch unknown DSH file: sha256=${actual}, expected=${expectSha256}`);
		}
		const info = await stat(target);
		// 备份与就地改写都在同一可写性假设下；两者都要给出可操作报错。
		try {
			await copyFile(target, `${target}.ibm-lab-agent.bak`);
		} catch (error) {
			throw new Error(describeWriteFailure(`${target}.ibm-lab-agent.bak`, error));
		}
		await atomicWrite(target, applyFakeInvokePatch(source), info.mode);
		console.log(`patched DSH tool-call compatibility: ${target}`);
		return;
	}
	if (command === "revert") {
		const info = await stat(target);
		await atomicWrite(target, revertFakeInvokePatch(source), info.mode);
		console.log(`reverted DSH tool-call compatibility: ${target}`);
		return;
	}
	throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
	console.error(`patch-dsh-runtime failed: ${error.message}`);
	process.exit(1);
});
