/**
 * bundled-python 输入指纹的守卫（路线书 §0.1，P0）。
 *
 * 被守住的行为：`Test-Path python.exe` 那种"存在即永久跳过"。这里验证指纹
 * 写/比对的全部判定分支，以及一个容易被忽略的性质 —— 指纹认的是**内容**，不是
 * 检出时的行尾/BOM 转换（否则同一份代码在 Windows 与 WSL 会得出不同指纹）。
 *
 * 这些断言能在 Linux 上跑，是刻意设计（把判定逻辑放进 Node）的直接收益：
 * 不必等一次 20 分钟的 Windows 出包才知道判定对不对。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	INPUT_FILES,
	INPUT_TREES,
	STAMP_NAME,
	STAMP_VERSION,
	checkStamp,
	computeInputs,
	writeStamp,
} from "../../scripts/bundled-python-inputs.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 造一个最小的"仓库"：内容不重要，能算指纹即可。 */
function makeFixture() {
	const root = mkdtempSync(join(tmpdir(), "bp-inputs-"));
	const put = (rel, content) => {
		mkdirSync(dirname(join(root, rel)), { recursive: true });
		writeFileSync(join(root, rel), content);
	};
	put("python/requirements.lock", "rdkit==2026.3.5\n");
	put("desktop/scripts/build-bundled-python.ps1", "param()\nWrite-Host 'x'\n");
	put("src/markitdown-patch.js", "export const MARKITDOWN_PATCH_VERSION = '0.1.7';\n");
	put("scripts/patch-markitdown.mjs", "// cli\n");
	put("runtime/versions.env", "NODE_VERSION=24.16.0\n");
	put("vendor/mnova-mcp/pyproject.toml", "[project]\nname = 'mnova-mcp'\n");
	put("vendor/mnova-mcp/src/mnova_mcp/__init__.py", "__version__ = '0.3.1'\n");
	mkdirSync(join(root, "stamp-dir"), { recursive: true });
	return { root, stampDir: join(root, "stamp-dir"), put, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("真实仓库的指纹输入全部存在（否则出包时会直接失败）", () => {
	const { missing, fingerprint } = computeInputs(repoRoot);
	assert.deepEqual(missing, [], `以下指纹输入缺失，build-windows-release.ps1 的判定会失败：${missing.join(", ")}`);
	assert.match(fingerprint, /^[0-9a-f]{64}$/);
	for (const rel of [...INPUT_FILES, ...INPUT_TREES]) {
		assert.ok(
			existsSync(join(repoRoot, rel)),
			`${rel} 是声明的指纹输入但仓库里不存在 —— 若已改名，请同步更新 INPUT_FILES/INPUT_TREES`,
		);
	}
});

test("指纹认内容而非行尾/BOM：LF、CRLF、带 BOM 三种形态指纹相同", () => {
	const fx = makeFixture();
	try {
		const lf = computeInputs(fx.root).fingerprint;
		fx.put("python/requirements.lock", "rdkit==2026.3.5\r\n");
		fx.put("desktop/scripts/build-bundled-python.ps1", "param()\r\nWrite-Host 'x'\r\n");
		const crlf = computeInputs(fx.root).fingerprint;
		assert.equal(crlf, lf, "CRLF 检出不应改变指纹（否则 Windows/WSL 会互相判为过期）");

		const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("param()\nWrite-Host 'x'\n")]);
		writeFileSync(join(fx.root, "desktop/scripts/build-bundled-python.ps1"), bom);
		assert.equal(computeInputs(fx.root).fingerprint, lf, "BOM 不应改变指纹");

		fx.put("desktop/scripts/build-bundled-python.ps1", "param()\nWrite-Host 'CHANGED'\n");
		assert.notEqual(computeInputs(fx.root).fingerprint, lf, "内容变化必须改变指纹");
	} finally {
		fx.cleanup();
	}
});

test("写指纹后判定为 current，改任一输入都会判为过期并指名", () => {
	const fx = makeFixture();
	try {
		writeStamp(fx.root, fx.stampDir);
		assert.deepEqual(checkStamp(fx.root, fx.stampDir), {
			current: true,
			reason: "fingerprint matches",
			changed: [],
		});

		// 逐个输入验证：每个都必须能独立触发重建（而不是只有 lock 有效）
		for (const rel of INPUT_FILES) {
			const original = readFileSync(join(fx.root, rel), "utf8");
			fx.put(rel, `${original}# touched\n`);
			const verdict = checkStamp(fx.root, fx.stampDir);
			assert.equal(verdict.current, false, `${rel} 变化后必须判为过期`);
			assert.ok(verdict.changed.includes(rel), `${rel} 变化后应在 changed 里被指名，实际：${verdict.changed}`);
			fx.put(rel, original);
		}

		// 目录输入的内部新增/改内容/删除
		fx.put("vendor/mnova-mcp/src/mnova_mcp/new.py", "x = 1\n");
		assert.equal(checkStamp(fx.root, fx.stampDir).current, false, "vendor 树新增文件必须判为过期");
		rmSync(join(fx.root, "vendor/mnova-mcp/src/mnova_mcp/new.py"));
		rmSync(join(fx.root, "vendor/mnova-mcp/pyproject.toml"));
		const removed = checkStamp(fx.root, fx.stampDir);
		assert.equal(removed.current, false, "vendor 树删除文件必须判为过期");
		assert.ok(removed.changed.includes("vendor/mnova-mcp/"), "应指名是 vendor 树变了");
	} finally {
		fx.cleanup();
	}
});

test("缺失/损坏/方案变更的指纹文件一律判为过期（保守方向：宁多重建，不漏重建）", () => {
	const fx = makeFixture();
	try {
		const missing = checkStamp(fx.root, fx.stampDir);
		assert.equal(missing.current, false);
		assert.match(missing.reason, /no stamp/);

		writeFileSync(join(fx.stampDir, STAMP_NAME), "{ this is not json");
		const corrupt = checkStamp(fx.root, fx.stampDir);
		assert.equal(corrupt.current, false);
		assert.match(corrupt.reason, /unreadable/);

		writeFileSync(join(fx.stampDir, STAMP_NAME), JSON.stringify({ stampVersion: STAMP_VERSION + 1 }));
		const outdated = checkStamp(fx.root, fx.stampDir);
		assert.equal(outdated.current, false);
		assert.match(outdated.reason, /scheme changed/);

		// 输入在自己这一侧缺失：必须判为过期，而不是"内容相同"
		writeStamp(fx.root, fx.stampDir);
		rmSync(join(fx.root, "runtime/versions.env"));
		const goneInput = checkStamp(fx.root, fx.stampDir);
		assert.equal(goneInput.current, false);
		assert.match(goneInput.reason, /inputs missing: runtime\/versions\.env/);
	} finally {
		fx.cleanup();
	}
});

test("捆绑解释器版本变化会触发重建（基础 Python 升级这条轴不能漏）", () => {
	const fx = makeFixture();
	try {
		// 版本用注入而非"造一个假可执行文件"：Windows 上跑不了 #!/bin/sh 脚本，
		// 之前正是因为这点在 Windows 的 tests 阶段失败、阻断了整个出包。
		writeStamp(fx.root, fx.stampDir, { pythonVersion: "3.11.9" });
		assert.equal(checkStamp(fx.root, fx.stampDir, { pythonVersion: "3.11.9" }).current, true);

		const upgraded = checkStamp(fx.root, fx.stampDir, { pythonVersion: "3.11.10" });
		assert.equal(upgraded.current, false, "解释器版本变化必须判为过期");
		assert.ok(
			upgraded.changed.some((c) => c.startsWith("pythonVersion:3.11.9->3.11.10")),
			`应指名版本变化，实际：${upgraded.changed}`,
		);

		// 读不到版本（未给 --python-exe 或可执行文件不存在）时，这条轴不参与判定，
		// 不能因为"读不到"就把新鲜产物判成过期 —— 保守方向只针对"已知变了"。
		assert.equal(
			checkStamp(fx.root, fx.stampDir, { pythonExe: join(fx.root, "nope.exe") }).current,
			true,
			"解释器不可读时不应误判过期",
		);
	} finally {
		fx.cleanup();
	}
});

test("CLI 契约：--check 以退出码 0 输出 JSON，判定结果不由退出码表达", () => {
	const fx = makeFixture();
	const cli = join(repoRoot, "scripts/bundled-python-inputs.mjs");
	const runCheck = () => execFileSync(process.execPath, [cli, "--check", fx.stampDir], { encoding: "utf8" }).trim();
	try {
		const before = JSON.parse(runCheck());
		assert.equal(before.current, false, "无指纹时应判为过期");

		execFileSync(process.execPath, [cli, "--write", fx.stampDir], { encoding: "utf8" });
		const after = JSON.parse(runCheck());
		assert.equal(after.current, true, "写入后应判为 current");

		// 未知命令必须非零退出，调用方才能把"工具坏了"与"产物过期"区分开
		assert.throws(() => execFileSync(process.execPath, [cli, "--nope"], { encoding: "utf8", stdio: "pipe" }));
	} finally {
		fx.cleanup();
	}
});
