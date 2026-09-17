#!/usr/bin/env node

import { chmod, copyFile, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	applyDshWebFrontendPatch,
	inspectDshWebFrontendPatch,
	revertDshWebFrontendPatch
} from "../src/dsh-web-frontend-patch.js";

function parseArgs(argv) {
	const command = argv[0] ?? "verify";
	const rootIndex = argv.indexOf("--root");
	if (rootIndex < 0 || !argv[rootIndex + 1]) throw new Error("--root <@deepseek-ai/dsh-web-frontend> is required");
	return { command, root: resolve(argv[rootIndex + 1]) };
}

async function findMainAsset(root) {
	const assets = join(root, "dist", "assets");
	const candidates = (await readdir(assets)).filter((name) => /^index-[\w-]+\.js$/.test(name));
	for (const name of candidates) {
		const path = join(assets, name);
		const source = await readFile(path, "utf8");
		const state = inspectDshWebFrontendPatch(source);
		if (state.pristineAnchors || state.patchedAnchors || state.patched) return { path, source, state };
	}
	throw new Error(`DSH web frontend main asset with clipboard anchors not found below ${assets}`);
}

async function atomicWrite(path, content) {
	const info = await stat(path);
	const temporary = `${path}.ibm-lab-agent-${process.pid}.tmp`;
	await writeFile(temporary, content, "utf8");
	await chmod(temporary, info.mode);
	await rename(temporary, path);
}

function assertJavaScriptSyntax(path) {
	const checked = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
	if (checked.status !== 0) {
		throw new Error(`patched DSH web frontend is invalid JavaScript: ${path}\n${checked.stderr || checked.stdout}`);
	}
}

const { command, root } = parseArgs(process.argv.slice(2));
const { path, source, state } = await findMainAsset(root);
if (command === "verify") {
	if (!state.patchedAnchors) throw new Error(`DSH web frontend patch absent or incomplete: ${path}`);
	console.log(`DSH web frontend patch present: ${path}`);
} else if (command === "patch") {
	if (!state.patchedAnchors) {
		await copyFile(path, `${path}.ibm-lab-agent.bak`);
		await atomicWrite(path, applyDshWebFrontendPatch(source));
	}
	console.log(`patched DSH web frontend clipboard fallback: ${path}`);
} else if (command === "revert") {
	await atomicWrite(path, revertDshWebFrontendPatch(source));
	console.log(`reverted DSH web frontend clipboard fallback: ${path}`);
} else {
	throw new Error(`unknown command: ${command}`);
}
assertJavaScriptSyntax(path);
