/**
 * 安装器的下载源一致性（Linux ↔ Windows）。
 *
 * 背景：Linux 的 install.sh 此前**没有任何 pip 镜像**，而从 PyPI 直连实测只有
 * ~30 KB/s —— 600 MB 依赖要跑一个多小时（校内部署尤其明显，本机实测卡在这里）。
 * 与此同时 Windows 构建脚本早已默认用清华源，Node 走 mirrors.ustc.edu.cn、
 * pnpm 走 registry.npmmirror.com。补齐镜像属于对齐既有约定，不是新增策略。
 *
 * 关键实现细节也在这里钉住：必须用 `export PIP_INDEX_URL`（pip 自身读取该环境变量），
 * 而不是只给自己的 pip 调用加 `-i` —— 基础锁是在嵌套的
 * `node scripts/install.mjs`（labPython.bootstrap）里用 pip 装的，只加 `-i` 会漏掉它。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const installSh = readFileSync(join(repoRoot, "install.sh"), "utf8");
const windowsBuilder = readFileSync(join(repoRoot, "desktop", "scripts", "build-bundled-python.ps1"), "utf8");

/** 取出 install.sh 里 pip 索引的默认值。 */
function linuxDefaultIndex() {
	const match = /pip_index_url="\$\{IBM_LAB_AGENT_PIP_INDEX_URL:-([^}]+)\}"/.exec(installSh);
	assert.ok(match, "install.sh 里未找到 pip 索引默认值");
	return match[1];
}

/** 取出 Windows 构建脚本里 pip 索引的默认值。 */
function windowsDefaultIndex() {
	const match = /\$IndexUrl\s*=\s*'([^']+)'/.exec(windowsBuilder);
	assert.ok(match, "build-bundled-python.ps1 里未找到 \$IndexUrl 默认值");
	return match[1];
}

test("install.sh 通过 export PIP_INDEX_URL 提供 pip 镜像（可覆盖嵌套 pip 调用）", () => {
	assert.match(installSh, /pip_index_url="\$\{IBM_LAB_AGENT_PIP_INDEX_URL:-/, "默认值必须可由环境变量覆盖");
	// 必须是 export：基础锁由嵌套的 node scripts/install.mjs 用 pip 安装
	assert.match(installSh, /export PIP_INDEX_URL="\$pip_index_url"/, "必须 export，否则 install.mjs 的 pip 调用继承不到");
});

test("Linux 与 Windows 的 pip 索引默认值保持一致（跨平台漂移守卫）", () => {
	assert.equal(linuxDefaultIndex(), windowsDefaultIndex(), "两侧 pip 镜像默认值已漂移");
	assert.match(linuxDefaultIndex(), /^https:\/\//);
});

test("帮助文本说明该环境变量（否则用户不知道可覆盖）", () => {
	const usage = installSh.slice(installSh.indexOf("usage()"), installSh.indexOf("USAGE\n}"));
	assert.match(usage, /IBM_LAB_AGENT_PIP_INDEX_URL/);
});

test("其它下载源也保持既有约定（Node 走 USTC、pnpm 走 npmmirror）", () => {
	// 这不是新增要求，而是防止后续有人把镜像改回直连
	assert.match(installSh, /mirrors\.ustc\.edu\.cn\/node/);
	assert.match(installSh, /registry\.npmmirror\.com\/pnpm/);
});
