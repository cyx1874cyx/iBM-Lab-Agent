#!/usr/bin/env node
/**
 * dsh-lab-agent：让 DSH 的 Windows「打开方式」关联枚举**优雅降级**。
 *
 * 背景（2026-09-27 实测，0.5.5-beta10）：
 *   `@deepseek-ai/dsh-native-command` 在 Windows 上用 PowerShell 调 Shell 的
 *   `SHAssocEnumHandlers` 枚举某个扩展名的「打开方式」。它的 DllImport 是
 *   `PreserveSig = false`，所以 **Shell 一旦返回失败 HRESULT 就直接抛异常**；
 *   而这台机器上它对所有扩展名、所有路径都返回 `E_FAIL`（.md/.txt/.pdf 一样）。
 *   结果：会话远程 `session.workspacePathApplications` 抛错 → 侧栏文件预览的
 *   「打开方式」显示「无法获取应用列表」，用户连"在文件资源管理器里显示"都用不顺。
 *
 * 补丁只做降级，不改变正常路径：
 *   1. `SHAssocEnumHandlers` 改为 `PreserveSig = true`，读返回值；
 *   2. 调用处检查 HRESULT 与空指针，失败即返回（= 没有可用应用）；
 *   3. 枚举循环里 `Marshal.ThrowExceptionForHR(result)` 改为失败即 break。
 *
 * 降级后的后果是**功能性的、可接受的**：界面只剩「在文件资源管理器里显示」，
 * 而那条走 `explorer.exe /select,`，不经过 COM，本来就可用。
 *
 * 用法：
 *   node scripts/patch-dsh-native-file-associations.mjs verify --root <dsh 或 node_modules 目录>
 *   node scripts/patch-dsh-native-file-associations.mjs patch  --root <同上>
 *
 * 纪律（与 patch-dsh-runtime.mjs / patch-markitdown.mjs 一致）：先校验锚点，
 * 不认识的内容一律拒绝修改；重复执行是幂等的。
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TARGET_RELATIVE = join("@deepseek-ai", "dsh-native-command", "lib", "index.js");

/** 三处锚点：未打补丁的原文 → 补丁后的写法。 */
const EDITS = [
	{
		label: "DllImport PreserveSig",
		from: `  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHAssocEnumHandlers(string extension, uint filter, out IEnumHandlers handlers);`,
		to: `  // ibm-lab-agent patch: 失败时回传 HRESULT 而不是抛异常，由调用方降级处理。
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  static extern int SHAssocEnumHandlers(string extension, uint filter, out IEnumHandlers handlers);`
	},
	{
		label: "enumeration entry",
		from: "    SHAssocEnumHandlers(extension, 0, out handlers);",
		to: "    if (SHAssocEnumHandlers(extension, 0, out handlers) < 0 || handlers == null) return;"
	},
	{
		label: "enumeration loop",
		from: "        Marshal.ThrowExceptionForHR(result);",
		to: "        if (result < 0) break;"
	}
];

function parseArgs(argv) {
	const command = argv[0] ?? "verify";
	const options = {};
	for (let index = 1; index < argv.length; index += 1) {
		if (argv[index] === "--root") options.root = argv[++index];
		else throw new Error(`unknown argument: ${argv[index]}`);
	}
	if (!options.root) throw new Error("--root <dsh root or node_modules> is required");
	return { command, root: resolve(options.root) };
}

/** 在 root 与其 node_modules 子目录之间定位目标文件。 */
function targetPath(root) {
	const candidates = [join(root, TARGET_RELATIVE), join(root, "node_modules", TARGET_RELATIVE)];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function countOccurrences(text, needle) {
	return text.split(needle).length - 1;
}

function inspect(text) {
	const missing = EDITS.filter((edit) => !text.includes(edit.from));
	const applied = EDITS.filter((edit) => text.includes(edit.to));
	return { missing, applied, patched: applied.length === EDITS.length };
}

const { command, root } = parseArgs(process.argv.slice(2));
const target = targetPath(root);

if (!existsSync(target)) {
	console.error(`找不到目标文件：${target}`);
	process.exit(2);
}

const original = await readFile(target, "utf8");
const state = inspect(original);

if (command === "verify") {
	if (state.patched) {
		console.log(`DSH 关联枚举降级补丁已就位：${target}`);
		process.exit(0);
	}
	console.error(
		`DSH 关联枚举仍是未打补丁状态：${target}` +
			(state.missing.length ? `（缺少锚点：${state.missing.map((edit) => edit.label).join(", ")}）` : "")
	);
	process.exit(1);
}

if (command !== "patch") {
	console.error(`未知命令：${command}（可用：verify、patch）`);
	process.exit(2);
}

if (state.patched) {
	console.log(`DSH 关联枚举降级补丁已存在，跳过：${target}`);
	process.exit(0);
}

// 每个锚点都必须恰好出现一次：多一处意味着上游已经改过这段代码，宁可拒绝也不要猜。
for (const edit of EDITS) {
	const occurrences = countOccurrences(original, edit.from);
	if (occurrences !== 1) {
		console.error(
			`拒绝修改：锚点「${edit.label}」在 ${target} 中出现 ${occurrences} 次（期望 1 次）。` +
				"上游可能已经改过这段代码，请先核对 dsh-native-command 的版本。"
		);
		process.exit(1);
	}
}

let patched = original;
for (const edit of EDITS) patched = patched.replace(edit.from, edit.to);
await writeFile(target, patched, "utf8");
console.log(`已应用 DSH 关联枚举降级补丁：${target}`);
