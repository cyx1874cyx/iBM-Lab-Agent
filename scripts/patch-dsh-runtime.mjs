#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
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

async function atomicWrite(path, content, mode) {
	const temporary = `${path}.ibm-lab-agent-${process.pid}.tmp`;
	await writeFile(temporary, content, "utf8");
	await chmod(temporary, mode);
	await rename(temporary, path);
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
		await copyFile(target, `${target}.ibm-lab-agent.bak`);
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
