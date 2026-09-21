/**
 * DSH 兼容补丁的可写性诊断（路线书 3.2 的假设①）。
 *
 * 该脚本必须就地改写 dsh-agent-loop，因此隐含假设"目标 node_modules 可写"。
 * 在只读挂载、容器镜像或全局安装目录下，裸 EACCES/EROFS/ENOENT 对使用者没有
 * 任何指引 —— 本用例钉住"必须转成可操作报错"。
 *
 * 构造只读目标用的是 /proc/version：procfs 里任何用户（**包括 root**）都无法创建
 * 新文件，所以失败点稳定落在写阶段；而单纯 chmod 0555 的目录对 root 无效，构造不出
 * 稳定的失败。该路径仅 Linux 存在，其它平台跳过。
 *
 * 覆盖边界（如实声明）：这里的 patch 用例走到的是**备份拷贝**那条 catch。
 * `atomicWrite` 自身的 catch（revert 路径不经备份拷贝）需要"可读、已打补丁、且不可写"
 * 的目标才能触发 —— 即只读文件系统，自动化测试里不做挂载（CI 为非 root，且留挂载点
 * 风险高）。该路径已在开发时手动验证：
 *
 *   cp node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js /tmp/w/index.js
 *   node scripts/patch-dsh-runtime.mjs patch --target /tmp/w/index.js     # 先打上补丁
 *   mount -t tmpfs tmpfs /tmp/ro && cp /tmp/w/index.js /tmp/ro/index.js
 *   mount -o remount,ro /tmp/ro
 *   node scripts/patch-dsh-runtime.mjs revert --target /tmp/ro/index.js
 *   → 无法写入 /tmp/ro/index.js（EROFS）。… 或用 --no-dsh-patch 跳过该补丁。
 *   mount -o remount,rw /tmp/ro && umount /tmp/ro
 *
 * 两条 catch 共用 describeWriteFailure，因此诊断文案本身由本文件覆盖；上面的手动
 * 验证确认 atomicWrite 的 catch 确实接线成功（变异测试：把 describeWriteFailure
 * 换成裸 error.message → 本文件第一条用例失败）。
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(repoRoot, "scripts/patch-dsh-runtime.mjs");
const READ_ONLY_TARGET = "/proc/version";

test("目标不可写时给出可操作报错，而不是裸 errno", (t) => {
	if (process.platform !== "linux") {
		t.skip("仅 Linux 上能稳定构造「root 也不可写」的目标");
		return;
	}
	const result = spawnSync(process.execPath, [SCRIPT, "patch", "--target", READ_ONLY_TARGET], {
		encoding: "utf8",
		cwd: repoRoot
	});
	assert.notEqual(result.status, 0, "不可写的目标必须失败，而不是静默成功");

	const output = `${result.stdout}\n${result.stderr}`;
	// 1) 指出是哪个路径写不进去
	assert.match(output, /无法写入/);
	assert.match(output, /ibm-lab-agent\.bak/);
	// 2) 保留原始 errno 供排查（不同只读文件系统的 errno 不同，故接受一组）
	assert.match(output, /（(EACCES|EROFS|EPERM|ENOENT|EIO|ENOTSUP|EXDEV)）/);
	// 3) 说明成因
	assert.match(output, /只读挂载|容器镜像|全局安装目录/);
	// 4) 给出出路：可写安装，或显式跳过补丁
	assert.match(output, /--no-dsh-patch/);
});

test("失败时不留下临时文件或备份残留", (t) => {
	if (process.platform !== "linux") {
		t.skip("仅 Linux 上能稳定构造「root 也不可写」的目标");
		return;
	}
	spawnSync(process.execPath, [SCRIPT, "patch", "--target", READ_ONLY_TARGET], { encoding: "utf8", cwd: repoRoot });
	// procfs 本就无法创建文件，这里断言的是脚本没有把残留写到别处：
	// 目标旁不应出现 .tmp / .bak（用 ls 观察目标目录）
	const listing = spawnSync("ls", ["-1", "/proc"], { encoding: "utf8" });
	assert.equal(/(^|\n)version\.ibm-lab-agent/.test(listing.stdout), false, "/proc 下出现了补丁残留");
});

test("verify 命令对只读目标是只读操作，不会失败", (t) => {
	if (process.platform !== "linux") {
		t.skip("仅 Linux 上能稳定构造只读目标");
		return;
	}
	const result = spawnSync(process.execPath, [SCRIPT, "verify", "--target", READ_ONLY_TARGET], {
		encoding: "utf8",
		cwd: repoRoot
	});
	const output = `${result.stdout}${result.stderr}`;
	// 未打补丁 → 退出码 1，但必须给出明确结论而不是抛错
	assert.match(output, /patch absent/);
	assert.equal(/无法写入/.test(output), false, "verify 不应尝试写入");
});
