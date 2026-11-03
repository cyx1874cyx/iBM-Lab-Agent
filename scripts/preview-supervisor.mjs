#!/usr/bin/env node
/**
 * 预览守护：dev-workbench 退出后自动重启（窗口被关闭也能恢复）。
 *
 * 停止方式：在仓库根目录创建 `work/preview-stop` 文件，或结束本后台任务。
 * 用法：node scripts/preview-supervisor.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stopFile = join(repoRoot, "work", "preview-stop");
mkdirSync(dirname(stopFile), { recursive: true });

/** 清掉残留的预览 Electron 进程，避免单实例锁让新进程瞬间退出。 */
function clearStaleInstances() {
	if (process.platform !== "win32") return;
	try {
		execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*electron-next-p1*' } | Stop-Process -Force"], { stdio: "ignore", windowsHide: true });
	} catch { /* 没有残留进程时忽略 */ }
}

const node = process.execPath;
let consecutiveFastExits = 0;

for (;;) {
	if (existsSync(stopFile)) { console.log("preview supervisor: stop file found, exiting"); process.exit(0); }
	const startedAt = Date.now();
	clearStaleInstances();
	console.log(`preview supervisor: starting dev-workbench at ${new Date().toISOString()}`);
	await new Promise(done => {
		const child = spawn(node, [join(repoRoot, "scripts", "dev-workbench.mjs")], { cwd: repoRoot, stdio: "inherit", env: process.env });
		child.once("exit", code => { console.log(`preview supervisor: dev-workbench exited with ${code}`); done(); });
		child.once("error", error => { console.error("preview supervisor: spawn failed", error); done(); });
	});
	const lived = Date.now() - startedAt;
	if (lived < 20000) consecutiveFastExits += 1; else consecutiveFastExits = 0;
	if (consecutiveFastExits >= 5) { console.error("preview supervisor: too many fast exits, stop to avoid a loop"); process.exit(1); }
	await new Promise(done => setTimeout(done, 2000));
}
