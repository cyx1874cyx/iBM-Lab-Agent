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

test("构建失败时不把上一次的产物说成本次结果（实测踩过：失败后仍打印旧报告与旧 SHA）", () => {
	// 旧写法：无条件取 .build 下最新的 release-report.json，并列出 target 下任意 *-setup.exe
	// 及其 SHA256 —— 一个阶段失败后，屏幕上会出现一份可信的安装包与哈希，看起来像成功。
	assert.match(script, /\$startedAt\s*=\s*\(Get-Date\)/, "应记录本次构建的起始时间，用于区分新鲜产物");
	// 注意：这些片段位于 bash heredoc 内，$ 被转义成 \$，因此模式要允许一个反斜杠。
	assert.match(script, /-gt\s*\\?\$startedAt/, '报告必须按"本次构建之后生成"过滤');
	assert.match(script, /if \(\\\$rc -eq 0 -and \\\$freshReports\.Count -gt 0\)/, "只有成功且存在本次报告时才输出产物信息");
	assert.match(script, /THIS RUN PRODUCED NO ARTIFACT/, "失败时应明确说明本次没有产出");
	assert.match(script, /stale artifact from an earlier build/, "若列出既有产物，必须标注它来自更早的构建");
	// 不允许再出现“无条件哈希任意 setup.exe”的写法
	assert.doesNotMatch(
		script,
		/Get-ChildItem \(Join-Path \\\$work 'desktop\\src-tauri\\target'\) -Recurse -Filter '\*-setup\.exe'[\s\S]{0,200}Get-FileHash/,
		"不应无条件哈希 target 下的任意安装包",
	);
});

test("预检模式不产出报告是正常的，不应报 do-not-publish 警告", () => {
	// 实测：--preflight-only 退出码 0、没有 release-report.json，旧逻辑会打出
	// "WARNING: ... do not publish"，把正常的预检说成可疑。
	assert.match(script, /\\\$mode -eq 'release'/, '缺报告的警告必须只在 release 模式下出现');
	assert.match(script, /no installer is expected from this run/, '预检应给出正向说明');
});

test("--ref 支持构建任意版本（基线归因/重建历史版本），默认行为不变", () => {
	assert.match(script, /--ref\)/, "应接受 --ref 参数");
	assert.match(script, /--ref 需要一个参数/, "缺参数时应报错退出");
	// 默认必须等价于旧行为：origin/<branch>
	assert.match(script, /ref="\$\{ref_override:-origin\/\$branch\}"/, "默认 ref 应为 origin/<branch>");
	// 检出用 detached：构建副本不该停在分支上，且这样才能检出任意 SHA
	assert.match(script, /checkout -q --detach \\\$ref/, "应按 ref 做 detached 检出");
	assert.doesNotMatch(script, /reset --hard "origin\\\/\$branch"/, "不应再写死 reset 到分支");
	assert.match(script, /目标 ref: \$ref/, "应把目标 ref 打进日志");
});
