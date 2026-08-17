/**
 * dsh-lab-agent: minimal boot helper for integration tests and the install
 * script. Boots a leaf Cordis tree with exactly the rows the plugin needs
 * (storage → storage-json → storage-domain → lab rows), against the repo's
 * dev-linked node_modules as the bare-module base.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { boot } from "@deepseek-ai/dsh-app-boot";

export const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Tiny YAML emitter for the constrained row shapes used here. */
function renderScalar(value, indent) {
	if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		if (value.every((v) => typeof v !== "object")) return `[${value.map((v) => renderScalar(v, indent)).join(", ")}]`;
		const lines = [];
		for (const item of value) {
			if (typeof item === "object" && item !== null) {
				lines.push(`${" ".repeat(indent)}-`);
				for (const [k, v] of Object.entries(item)) lines.push(`${" ".repeat(indent + 2)}${k}: ${renderScalar(v, indent + 2)}`);
			} else lines.push(`${" ".repeat(indent)}- ${renderScalar(item, indent)}`);
		}
		return `\n${lines.join("\n")}`;
	}
	if (value !== null && typeof value === "object") {
		const lines = [];
		for (const [k, v] of Object.entries(value)) lines.push(`${" ".repeat(indent)}${k}: ${renderScalar(v, indent + 2)}`);
		return `\n${lines.join("\n")}`;
	}
	return String(value);
}

function renderYaml(rows) {
	const lines = [];
	for (const row of rows) {
		lines.push(`- id: ${row.id}`);
		lines.push(`  name: '${row.name}'`);
		if (row.inject) lines.push(`  inject: [${row.inject.map((s) => `'${s}'`).join(", ")}]`);
		if (row.disabled !== undefined) lines.push(`  disabled: ${row.disabled}`);
		if (row.config && Object.keys(row.config).length > 0) {
			lines.push("  config:");
			for (const [key, value] of Object.entries(row.config)) {
				lines.push(`    ${key}: ${renderScalar(value, 6)}`);
			}
		}
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Boot the lab rows in isolation.
 * @param options {{ storageRoot: string, vendorDir: string, lockFile: string, venvDir?: string, requirementsLock?: string, includePython?: boolean, extraRows?: Array }}
 * @returns {{ ctx, dir, dispose(): Promise<void> }}
 */
export async function bootLite(options) {
	const { storageRoot, vendorDir, lockFile, venvDir, requirementsLock, includePython = true, extraRows = [] } = options;
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-boot-"));
	const rows = [
		{ id: "storage", name: "@deepseek-ai/dsh-storage" },
		{ id: "storage-json", name: "@deepseek-ai/dsh-storage-json", config: { root: storageRoot } },
		{ id: "storage-domain", name: "@deepseek-ai/dsh-storage-domain", config: { backend: "json" } },
		{
			id: "lab-version-registry",
			name: "dsh-lab-agent/version-registry",
			inject: ["storageDomain"],
			config: { vendorDir, lockFile }
		},
		...extraRows
	];
	if (includePython) {
		rows.push({
			id: "lab-python-env",
			name: "dsh-lab-agent/python-env",
			config: { venvDir, lockFile: requirementsLock }
		});
	}
	const configPath = join(dir, "cordis.yml");
	await writeFile(configPath, renderYaml(rows), "utf8");
	const ctx = await boot("dsh-lab-agent-test", configPath, [], undefined, pathToFileURL(join(repoRoot, "node_modules") + "/").href);
	return {
		ctx,
		dir,
		dispose: async () => {
			await ctx.fiber.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	};
}
