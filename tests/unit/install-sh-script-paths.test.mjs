/**
 * install.sh 的脚本执行目录守卫。
 *
 * 起因（完整安装 E2E 实测抓到的真实缺陷）：`$tmp_root/source` 是 tar 复制的源码快照，
 * 按设计**排除 node_modules**；`npm ci` 只装在 `$release_dir`。而 [6/8] 的
 * `ensure-ibm-lab-profile.mjs` 曾经从 `$tmp_root/source` 执行，它经
 * `src/ibm-lab-profile.js` import `@deepseek-ai/dsh-app-boot` → 必然
 * `ERR_MODULE_NOT_FOUND`，使**一行式 Linux 安装固定卡在 [6/8]**。
 *
 * 注意不能一刀切"禁止从 source 跑脚本"：`patch-dsh-runtime.mjs` 在 [4/8] 执行，
 * 那时 `$release_dir` 尚未创建，只能从 source 跑 —— 而它只 import 本地模块，是安全的。
 * 所以本守卫只管**release_dir 创建之后**的部分。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const installSh = readFileSync(join(repoRoot, "install.sh"), "utf8");

/** release_dir 创建之后的 install.sh 正文。 */
function afterReleaseDir() {
	const marker = 'release_dir="$data_root/releases/';
	const at = installSh.indexOf(marker);
	assert.ok(at >= 0, "install.sh 里未找到 release_dir 创建处");
	return installSh.slice(at);
}

test("release_dir 创建后，不再从 $tmp_root/source 执行 node 脚本", () => {
	const tail = afterReleaseDir();
	const offenders = [];
	tail.split("\n").forEach((line, index) => {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) return; // 注释里可以提到它
		if (/\$tmp_root\/source\/scripts\//.test(line)) offenders.push(`第 ${index + 1} 行: ${trimmed}`);
	});
	assert.deepEqual(
		offenders,
		[],
		`release_dir 之后的脚本必须从 $release_dir 执行（source 快照没有 node_modules）：\n  ${offenders.join("\n  ")}`
	);
});

test("release_dir 之前允许从 source 执行（那时 release_dir 还不存在）", () => {
	// 反向确认：守卫不是恒真 —— install.sh 里确实存在一处合法的 source 调用
	const before = installSh.slice(0, installSh.indexOf('release_dir="$data_root/releases/'));
	assert.match(before, /\$tmp_root\/source\/scripts\/patch-dsh-runtime\.mjs/, "前置阶段应仍从 source 跑补丁脚本");
});

test("ensure-ibm-lab-profile 明确从 release_dir 执行", () => {
	assert.match(installSh, /node "\$release_dir\/scripts\/ensure-ibm-lab-profile\.mjs"/);
});

test("需要 node_modules 的脚本都在 release_dir 里执行", () => {
	const tail = afterReleaseDir();
	for (const script of ["ensure-ibm-lab-profile.mjs", "configure-default-preset.mjs", "lab-doctor.mjs"]) {
		assert.match(tail, new RegExp(`node "\\$release_dir/scripts/${script.replace(".", "\\.")}"`), `${script} 应从 release_dir 执行`);
	}
});
