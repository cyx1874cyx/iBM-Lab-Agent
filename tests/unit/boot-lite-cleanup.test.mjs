import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeBootDir } from "../helpers/boot-lite.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const helpersDir = await readdir(resolve(repoRoot, "tests/helpers")).catch(() => []);
const helperPath = join(repoRoot, "tests", "helpers", "boot-lite.mjs");

/** 读取 helper 源码，用于校验清理顺序契约。 */
async function readHelper() {
	const { readFile } = await import("node:fs/promises");
	return readFile(helperPath, "utf8");
}

test("boot helper exports a dedicated boot-profile cleanup", async () => {
	assert.ok(helpersDir.includes("boot-lite.mjs"), "helper 文件应存在");
	const source = await readHelper();
	assert.match(source, /export async function removeBootDir/);
	// 清理必须只告警不抛错：环境限制不该让测试看起来像代码坏了。
	assert.match(source, /boot-lite: 清理临时目录失败/);
	assert.match(source, /boot-lite: 解除链接失败/);
});

test("cleanup unlinks the profile junctions before recursing into the directory", async () => {
	const source = await readHelper();
	const unlinkAt = source.indexOf("recursive: false, force: true");
	const recurseAt = source.indexOf("recursive: true, force: true, maxRetries: 2");
	assert.notEqual(unlinkAt, -1, "必须先以非递归方式摘除链接");
	assert.notEqual(recurseAt, -1, "随后才递归删除剩余目录");
	assert.ok(
		unlinkAt < recurseAt,
		"顺序不可颠倒：递归删除若先执行，会顺着 junction 遍历到仓库的 node_modules"
	);
});

test("cleanup never destroys the tree a profile junction points at", async () => {
	// 这是本修复要守住的安全属性：仓库依赖树必须完好。
	const target = join(repoRoot, "node_modules", "@deepseek-ai");
	const before = (await readdir(target)).length;
	assert.ok(before > 100, `前置条件：目标依赖树应已安装（实测 ${before} 条）`);

	const dir = await mkdtemp(join(tmpdir(), "boot-lite-cleanup-"));
	const link = join(dir, "node_modules", "@deepseek-ai");
	await mkdir(join(dir, "node_modules"));
	await symlink(target, link, "junction");
	assert.ok((await lstat(link)).isSymbolicLink(), "前置条件：链接已建立");

	await removeBootDir(dir);

	// 无论本机是否拦截删除，目标树都不允许被破坏。
	const after = (await readdir(target)).length;
	assert.equal(after, before, "清理 profile 不得删除 junction 指向的仓库依赖树");

	// 若环境放行删除，链接与目录都应消失；若被环境拦截，允许残留但不允许报错。
	const linkGone = await lstat(link).then(() => false).catch(() => true);
	if (linkGone) {
		const dirGone = await lstat(dir).then(() => false).catch(() => true);
		assert.ok(dirGone, "链接已摘除时，目录也应一并清理");
	}
	// 兜底清理：环境拦截时上面可能什么都没删掉，这里不再断言，只尽力而为。
	await rm(dir, { recursive: true, force: true }).catch(() => {});
});
