#!/usr/bin/env node
/**
 * iBM Lab Agent: make `lab-research` the default preset for new sessions.
 *
 * DSH 0.1.7 derives the default preset from the `agent-preset-registry` row's
 * `config.default` (or the runtime-editable `selectedDefault`), not from
 * `$DSH_HOME/settings.yaml`:
 *
 *   * `@deepseek-ai/dsh-settings` renames `settings.yaml` to
 *     `settings.yaml.imported` on first start and only dispatches the legacy
 *     sections listed in `LEGACY_SECTION_ENTRIES` (`ui-developer-tools`,
 *     `ui-onboarding`, `shell`). An `agent-presets:` section has no mapping,
 *     so it is dropped with a warning.
 *   * `dsh-agent-preset-registry` names its row `agent-preset-registry`, so
 *     the old section name could never reach it anyway.
 *
 * The supported seam is the PROFILE patch layer
 * (`$DSH_HOME/profiles/ibm-lab/cordis.patch.yml`), which is applied after the
 * `dsh-web-app` bundle declares `agent-preset-registry` and after the
 * `dsh-lab-agent` bundle declares `preset-lab-research`. This script owns
 * exactly one row there and leaves every other row (for example the
 * `preset-<id>` overrides the Web editor writes) untouched.
 *
 * Usage: node scripts/configure-default-preset.mjs [--dsh-home <path>]
 */

import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import yaml from "js-yaml";
import { resolveDshHome } from "../src/paths.js";

const PROFILE_ID = "ibm-lab";
const PROFILE_PATCH = "cordis.patch.yml";
const REGISTRY_ROW_ID = "agent-preset-registry";
const DEFAULT_PRESET = "lab-research";

/** `!!js` is a Loader expression; parse it as an opaque scalar for validation. */
const jsExpressionType = new yaml.Type("tag:yaml.org,2002:js", {
	kind: "scalar",
	construct: (value) => ({ __jsExpression: value })
});
const schema = yaml.DEFAULT_SCHEMA.extend([jsExpressionType]);

function profilePatchPath(argv) {
	const index = argv.indexOf("--dsh-home");
	const dshHome = index >= 0 ? resolve(argv[index + 1]) : resolveDshHome();
	return join(dshHome, "profiles", PROFILE_ID, PROFILE_PATCH);
}

const canonicalEntry = [
	`- id: ${REGISTRY_ROW_ID}`,
	"  config:",
	`    default: ${DEFAULT_PRESET}`
];

const canonicalDocument = [
	"# iBM Lab Agent profile patch.",
	"#",
	"# Written by scripts/configure-default-preset.mjs: new sessions in this",
	`# profile start in the \`${DEFAULT_PRESET}\` preset. The row below overrides the`,
	"# declaration shipped by the @deepseek-ai/dsh-web-app bundle. Delete this",
	"# entry (or run the installer with --keep-default-preset) to fall back to",
	"# the shipped default.",
	...canonicalEntry,
	""
].join("\n");

const isTopLevelRow = (line) => /^-\s/.test(line);
const isRegistryRow = (line) => /^- id:\s*agent-preset-registry\s*$/.test(line);

/** Locate the `[start, end)` half-open range of the registry row's block. */
function findRegistryBlock(lines) {
	const start = lines.findIndex(isRegistryRow);
	if (start < 0) return undefined;
	let end = start + 1;
	while (end < lines.length && !isTopLevelRow(lines[end])) end++;
	return { start, end };
}

/**
 * Set `config.default` inside the registry row, creating the row when absent.
 * The replacement is line-scoped so unrelated rows and comments survive.
 */
function updateText(source) {
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	const trimmed = source.replace(/\r\n/g, "\n").replace(/\s+$/, "");
	if (trimmed === "" || trimmed === "[]") return canonicalDocument.replace(/\n/g, newline);

	const lines = trimmed.split("\n");
	const block = findRegistryBlock(lines);
	if (!block) {
		const separator = lines.at(-1) === "" ? [] : [""];
		return [...lines, ...separator, ...canonicalEntry, ""].join(newline);
	}

	const configIndex = lines.findIndex(
		(line, index) => index > block.start && index < block.end && /^(\s*)config:\s*$/.test(line)
	);
	if (configIndex < 0) {
		lines.splice(block.end, 0, "  config:", `    default: ${DEFAULT_PRESET}`);
	} else {
		const indent = `${lines[configIndex].match(/^(\s*)/)[1]}  `;
		const defaultPattern = new RegExp(`^${indent}default:\\s`);
		const defaultIndex = lines.findIndex(
			(line, index) => index > configIndex && index < block.end && defaultPattern.test(line)
		);
		if (defaultIndex < 0) lines.splice(configIndex + 1, 0, `${indent}default: ${DEFAULT_PRESET}`);
		else lines[defaultIndex] = `${indent}default: ${DEFAULT_PRESET}`;
	}
	return `${lines.join(newline).replace(/\s+$/, "")}${newline}`;
}

function assertConfigured(updated) {
	const parsed = yaml.load(updated, { schema });
	if (!Array.isArray(parsed)) throw new Error("profile patch must be a top-level list of rows");
	const registry = parsed.find((row) => row && typeof row === "object" && row.id === REGISTRY_ROW_ID);
	if (!registry) throw new Error(`profile patch has no ${REGISTRY_ROW_ID} row`);
	if (registry.config?.default !== DEFAULT_PRESET) {
		throw new Error(`generated profile patch does not default to ${DEFAULT_PRESET}`);
	}
}

async function main() {
	const path = profilePatchPath(process.argv.slice(2));
	const source = existsSync(path) ? await readFile(path, "utf8") : "";
	const updated = updateText(source);
	assertConfigured(updated);
	if (updated === source) {
		console.log(`default preset already configured: ${path}`);
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	const mode = existsSync(path) ? (await stat(path)).mode : 0o600;
	const temporary = `${path}.ibm-lab-agent-${process.pid}.tmp`;
	await writeFile(temporary, updated, "utf8");
	await chmod(temporary, mode);
	await rename(temporary, path);
	console.log(`default preset -> ${DEFAULT_PRESET} (${path})`);
}

main().catch((error) => {
	console.error(`configure-default-preset failed: ${error.message}`);
	process.exit(1);
});
