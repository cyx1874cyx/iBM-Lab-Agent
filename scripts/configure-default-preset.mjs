#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { resolveDshHome } from "../src/paths.js";

function settingsPath(argv) {
	const index = argv.indexOf("--dsh-home");
	const dshHome = index >= 0 ? resolve(argv[index + 1]) : resolveDshHome();
	return resolve(dshHome, "settings.yaml");
}

function updateText(source) {
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : [];
	const section = lines.findIndex((line) => /^agent-presets:\s*$/.test(line));
	if (section < 0) {
		const separator = lines.length && lines.at(-1) !== "" ? [""] : [];
		return [...lines, ...separator, "agent-presets:", "  default: lab-research", ""].join(newline);
	}
	let end = section + 1;
	while (end < lines.length && (/^\s/.test(lines[end]) || lines[end] === "")) end++;
	const defaultLine = lines.slice(section + 1, end).findIndex((line) => /^\s+default:\s*/.test(line));
	if (defaultLine >= 0) lines[section + 1 + defaultLine] = "  default: lab-research";
	else lines.splice(section + 1, 0, "  default: lab-research");
	return lines.join(newline);
}

async function main() {
	const path = settingsPath(process.argv.slice(2));
	const source = existsSync(path) ? await readFile(path, "utf8") : "";
	const updated = updateText(source);
	const parsed = yaml.load(updated) ?? {};
	if (parsed?.["agent-presets"]?.default !== "lab-research") {
		throw new Error("generated settings did not validate");
	}
	if (updated === source) {
		console.log(`default preset already configured: ${path}`);
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	if (existsSync(path) && !existsSync(`${path}.ibm-lab-agent.bak`)) {
		await copyFile(path, `${path}.ibm-lab-agent.bak`);
	}
	const mode = existsSync(path) ? (await stat(path)).mode : 0o600;
	const temporary = `${path}.ibm-lab-agent-${process.pid}.tmp`;
	await writeFile(temporary, updated, "utf8");
	await chmod(temporary, mode);
	await rename(temporary, path);
	console.log(`default preset -> lab-research (${path})`);
}

main().catch((error) => {
	console.error(`configure-default-preset failed: ${error.message}`);
	process.exit(1);
});
