/**
 * WSL → Windows 出包驱动脚本的不变量守卫。
 *
 * `scripts/windows-release-from-wsl.sh` 在 WSL 里驱动 Windows 侧的原生工具链出
 * Windows 安装包（与"在 Linux 上交叉编译"相对：交叉编译的产物无法在 Linux 验证，
 * 而这个架构能真正跑 verify-package.ps1 -WebSmokeTest）。
 *
 * 本文件钉住的是**实际踩过的坑**，都是"改脚本时很容易退化、且退化了只有真出包才发现"
 * 的那一类：
 *   1. 生成的 .ps1 含非 ASCII → PowerShell 5.1 按 ANSI 码页解析无 BOM 的 UTF-8，
 *      中文/emoji 会破坏字符串终止符，报 ParserError: TerminatorExpectedAtEndOfString。
 *   2. cwd 在 UNC 路径（\\wsl.localhost\...）时 powershell.exe 直接拒绝执行 →
 *      脚本必须先 cd 到 Windows 盘再调用。
 *   3. desktop/ 是独立 npm 单元，缺 Tauri CLI 会让出包跑到 tauri-nsis 之前才失败 →
 *      驱动脚本应当自动补。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = readFileSync(join(repoRoot, "scripts", "windows-release-from-wsl.sh"), "utf8");

/** 取出生成 .ps1 的 heredoc 正文（`<<PS1` 到行首 `PS1`）。 */
function ps1Heredoc() {
	const start = script.indexOf('<<PS1\n');
	assert.ok(start >= 0, "未找到生成 ps1 的 heredoc");
	const bodyStart = start + '<<PS1\n'.length;
	const end = script.indexOf("\nPS1\n", bodyStart);
	assert.ok(end > bodyStart, "heredoc 没有结束标记");
	return script.slice(bodyStart, end);
}

test("生成的 .ps1 必须是纯 ASCII（PowerShell 5.1 无 BOM 时按 ANSI 解析）", () => {
	const body = ps1Heredoc();
	const offenders = body
		.split("\n")
		.map((line, index) => ({ line, index: index + 1 }))
		.filter(({ line }) => [...line].some((ch) => ch.codePointAt(0) > 127));
	assert.deepEqual(
		offenders.map((o) => `第 ${o.index} 行: ${o.line.trim().slice(0, 60)}`),
		[],
		"ps1 heredoc 里出现非 ASCII，会让 PowerShell 报 TerminatorExpectedAtEndOfString"
	);
});

test("脚本先做 interop 前置检查再调用 Windows 可执行文件", () => {
	assert.match(script, /\[\[ -d \/mnt\/c \]\]/, "应先确认 /mnt/c 存在（interop 可用）");
	assert.match(script, /command -v powershell\.exe/, "应先确认 powershell.exe 可达");
});

test("调用前会把 cwd 切到 Windows 盘（规避 UNC 路径限制）", () => {
	// 关键：调用 powershell.exe 之前必须 cd 到 /mnt/<盘>/ 下
	const callAt = script.indexOf('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1_win"');
	assert.ok(callAt >= 0, "未找到 powershell.exe 调用");
	const before = script.slice(0, callAt);
	assert.match(before, /cd "\$work_mnt"/, "调用前应先 cd 到 Windows 盘上的工作副本");
});

test("缺 Tauri CLI 时自动补 desktop 依赖（不再晚到 tauri-nsis 才失败）", () => {
	assert.match(script, /desktop\\node_modules\\@tauri-apps\\cli\\tauri\.js/, "应检查 Tauri CLI 是否存在");
	assert.match(script, /npm ci/, "缺失时应自动执行 npm ci");
});

test("只通过 NTFS 裸仓库传输 git 对象（不在 drvfs 上构建）", () => {
	assert.match(script, /clone --bare/, "应在 NTFS 上建裸仓库作为传输通道");
	assert.match(script, /push --quiet "\$bare"/, "应把当前分支推到裸仓库");
	// 默认路径必须在 /mnt/ 下的 Windows 盘，而不是 WSL 内部文件系统
	assert.match(script, /IBM_LAB_WSL_BARE:-/);
	const bareDefault = /IBM_LAB_WSL_BARE:-([^}]+)\}/.exec(script)?.[1] ?? "";
	assert.match(bareDefault, /^\/mnt\/[a-z]\//, `默认传输路径应在 Windows 盘上，实际为 ${bareDefault}`);
});
