/**
 * desktop/ 依赖锁一致性守卫。
 *
 * 背景：`desktop/` 是**独立的 npm 单元**（自带 `package-lock.json`，依赖
 * `@tauri-apps/cli`），不在根 pnpm workspace 内，必须单独 `npm ci`。Windows 发布
 * 流水线用它跑 `tauri build`；`npm ci` 是**严格按锁安装**，只要 `package.json` 与
 * `package-lock.json` 不一致就直接失败。
 *
 * 如果有人在 Linux 上改了 `desktop/package.json`（例如升级 Tauri CLI）却没更新锁文件，
 * 本地 5 道闸门全绿、毫无征兆，直到 Windows 出包跑到 tauri-nsis 才炸 —— 而且报的是
 * npm 的锁不一致错误，很难一眼看出根因。所以在 Linux 侧静态校验两者一致。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "desktop", "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(repoRoot, "desktop", "package-lock.json"), "utf8"));

test("desktop/package.json 的 devDependencies 与 package-lock.json 根节点一致", () => {
	const declared = pkg.devDependencies ?? {};
	const locked = lock.packages?.[""]?.devDependencies ?? {};
	assert.deepEqual(
		locked,
		declared,
		"desktop 的 package.json 与 package-lock.json 根 devDependencies 不一致；" +
		"`npm ci --prefix desktop` 在 Windows 出包时会因此失败（本地 Linux 闸门看不到）"
	);
});

test("每个声明的依赖都在锁里解析出确切版本，且与声明范围相容", () => {
	const declared = pkg.devDependencies ?? {};
	for (const [name, range] of Object.entries(declared)) {
		const resolved = lock.packages?.[`node_modules/${name}`]?.version;
		assert.ok(resolved, `锁文件里没有解析 ${name}`);
		// 项目的 desktop 依赖都用精确版本（如 "2.11.1"），此时必须逐字相等
		if (/^\d+\.\d+\.\d+$/.test(range)) {
			assert.equal(resolved, range, `${name}: 锁里是 ${resolved}，声明是 ${range}`);
		}
	}
});

test("Tauri CLI 的平台包在锁里齐备（Windows 出包需要 win32-x64-msvc）", () => {
	const cliVersion = lock.packages?.["node_modules/@tauri-apps/cli"]?.version;
	assert.ok(cliVersion, "锁里缺少 @tauri-apps/cli");
	const winPkg = lock.packages?.["node_modules/@tauri-apps/cli-win32-x64-msvc"]?.version;
	assert.ok(winPkg, "锁里缺少 @tauri-apps/cli-win32-x64-msvc（Windows 构建必需的平台包）");
	assert.equal(winPkg, cliVersion, "平台包版本与主包不一致");
});

test("发布脚本在预检期就检查 Tauri CLI（而不是等到 tauri-nsis 之前）", () => {
	const source = readFileSync(join(repoRoot, "desktop", "scripts", "build-windows-release.ps1"), "utf8");
	const early = source.indexOf("Tauri CLI is missing");
	assert.ok(early >= 0, "发布脚本里没有 Tauri CLI 的存在性检查");
	// 该检查必须出现在 bundled-python / prepare-runtime 等阶段**之前**
	const firstPhase = source.indexOf("$phases.Add");
	assert.ok(firstPhase >= 0, "未找到阶段注册代码");
	assert.ok(early < firstPhase, "Tauri CLI 检查应早于阶段注册（否则会白跑前面的阶段）");
	// 且消息里要给出可操作命令
	assert.match(source, /npm ci' inside the desktop directory/, "报错信息应指明在 desktop/ 里跑 npm ci");
});
