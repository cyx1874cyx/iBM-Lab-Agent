import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * DSH「打开方式」关联枚举的降级补丁（2026-09-27 实测缺失）。
 *
 * 该补丁只在 Windows 打包阶段应用，但脚本本身必须可校验、幂等，并且**上游一改就拒绝**
 * —— 否则会把一段猜出来的代码写进发布产物。
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repoRoot, "scripts", "patch-dsh-native-file-associations.mjs");
const original = join(repoRoot, "node_modules", "@deepseek-ai", "dsh-native-command", "lib", "index.js");
const targetRelative = join("@deepseek-ai", "dsh-native-command", "lib", "index.js");

const run = (command, root) =>
	spawnSync(process.execPath, [script, command, "--root", root], { encoding: "utf8" });

/** 建一个和发布树同形的临时 root，并放入原始（未打补丁）文件。 */
async function makeRoot({ mutate } = {}) {
	const root = await mkdtemp(join(tmpdir(), "dsh-native-patch-"));
	const target = join(root, targetRelative);
	await mkdir(dirname(target), { recursive: true });
	const text = await readFile(original, "utf8");
	await writeFile(target, mutate ? mutate(text) : text, "utf8");
	return { root, target };
}

test("关联枚举降级补丁：verify 能识别未打补丁 / 已打补丁", async () => {
	const { root, target } = await makeRoot();
	try {
		assert.equal(run("verify", root).status, 1, "未打补丁时 verify 必须失败");
		assert.equal(run("patch", root).status, 0, "patch 必须成功");
		const patched = await readFile(target, "utf8");
		assert.match(patched, /PreserveSig = true/, "必须改成读返回值");
		assert.match(patched, /handlers == null\) return;/, "枚举失败必须降级返回");
		assert.match(patched, /if \(result < 0\) break;/, "循环内不得再抛异常");
		assert.equal(run("verify", root).status, 0, "已打补丁时 verify 必须通过");
		assert.equal(run("patch", root).status, 0, "重复 patch 必须幂等");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("关联枚举降级补丁：锚点被上游改动时拒绝修改", async () => {
	// 锚点出现两次 = 上游已改过这段代码，脚本必须拒绝而不是猜。
	const { root, target } = await makeRoot({
		mutate: (text) => text.replace("    SHAssocEnumHandlers(extension, 0, out handlers);", "    SHAssocEnumHandlers(extension, 0, out handlers);\n    SHAssocEnumHandlers(extension, 0, out handlers);")
	});
	try {
		const before = await readFile(target, "utf8");
		const result = run("patch", root);
		assert.equal(result.status, 1, "必须拒绝修改");
		assert.match(result.stderr, /拒绝修改/, "必须给出拒绝原因");
		assert.equal(await readFile(target, "utf8"), before, "拒绝时不得写入");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("关联枚举降级补丁：目标缺失时给出可诊断退出码", async () => {
	const root = await mkdtemp(join(tmpdir(), "dsh-native-missing-"));
	try {
		assert.equal(existsSync(join(root, targetRelative)), false);
		const result = run("verify", root);
		assert.equal(result.status, 2, "找不到目标必须是 2（与「内容不匹配」区分）");
		assert.match(result.stderr, /找不到目标文件/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
