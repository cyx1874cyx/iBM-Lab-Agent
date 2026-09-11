/**
 * dsh-lab-agent: minimal boot helper for integration tests and the install
 * script. Boots a leaf Cordis tree with exactly the rows the plugin needs
 * (storage → storage-json → storage-domain → lab rows), against the repo's
 * dev-linked node_modules as the bare-module base.
 */

import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { boot } from "@deepseek-ai/dsh-app-boot";

export const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** `bootLite` 在 profile 目录里建立的链接；清理前必须逐个解除。 */
function profileLinks(dir) {
	return [
		join(dir, "node_modules", "@deepseek-ai"),
		join(dir, "node_modules", "dsh-lab-agent")
	];
}

/**
 * 安全删除一个 boot profile 目录。
 *
 * Windows 上 `rm(dir, { recursive: true })` 会**顺着 junction 遍历到仓库的
 * node_modules**（实测目标树有 240 个条目），既可能误删依赖树，也会触发宿主
 * 环境的批量删除保护，使整套集成测试以「清理失败」而非「断言失败」告负。
 *
 * `rm(link, { recursive: false })` 只摘除链接本身，目标树不受影响——已实测确认。
 * 因此顺序固定为：先解链接，再删剩余目录。
 *
 * 清理失败只告警，不向上抛：环境限制不应该让测试看起来像代码坏了。
 */
export async function removeBootDir(dir) {
	for (const link of profileLinks(dir)) {
		try {
			await rm(link, { recursive: false, force: true });
		} catch (error) {
			console.warn(`boot-lite: 解除链接失败 ${link}: ${error?.code ?? error}`);
		}
	}
	try {
		await rm(dir, { recursive: true, force: true, maxRetries: 2 });
	} catch (error) {
		console.warn(`boot-lite: 清理临时目录失败 ${dir}: ${error?.code ?? error}`);
	}
}

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
	// DSH 0.1.5 preset discovery checks disk packages relative to the profile,
	// independently of the loader's bare-module fallback. Model a real profile.
	await mkdir(join(dir, "node_modules"));
	const linkType = process.platform === "win32" ? "junction" : "dir";
	await symlink(join(repoRoot, "node_modules", "@deepseek-ai"), join(dir, "node_modules", "@deepseek-ai"), linkType);
	await symlink(repoRoot, join(dir, "node_modules", "dsh-lab-agent"), linkType);
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
		// Keep the minimal test profile aligned with the shipped bundle: remote
		// and task services now depend on the experiment-plan template registry.
		{ id: "lab-experiment-plan-templates", name: "dsh-lab-agent/experiment-plan-templates", inject: ["storageDomain"] },
		{ id: "lab-plot-records", name: "dsh-lab-agent/plot-records", inject: ["storageDomain"] },
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
	// Resolve this checkout explicitly: shared dependency stores can otherwise load a sibling worktree.
 const localRows=rows.map(row=>row.name.startsWith("dsh-lab-agent/")?{...row,name:pathToFileURL(join(repoRoot,"lib",row.name.slice("dsh-lab-agent/".length)+".js")).href}:row);
 await writeFile(configPath, renderYaml(localRows), "utf8");
	const ctx = await boot("dsh-lab-agent-test", configPath, [], undefined, pathToFileURL(join(repoRoot, "node_modules") + "/").href);
	return {
		ctx,
		dir,
		dispose: async () => {
			// fiber.dispose 的异常代表真实的插件拆除缺陷，仍然向上抛；
			// 但目录清理放在 finally 里，保证一定执行且不覆盖原始错误。
			try {
				await ctx.fiber.dispose();
			} finally {
				await removeBootDir(dir);
			}
		}
	};
}
