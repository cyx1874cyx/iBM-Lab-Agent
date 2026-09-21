/**
 * Office 预览渲染器：安装期不再阻断（路线书 4.3）。
 *
 * 背景：`apt-packages.txt` 原本写着 "Office preview is intentionally
 * hard-required: no text-only fallback"，`install.mjs` 缺 soffice 直接 throw，
 * `install.sh --skip-system-deps` 也直接 exit 1。结果是「形态① 即插即用」在没装
 * LibreOffice 的机器上**完全无法安装**。
 *
 * 改成警告是安全的，因为运行期本来就不静默降级：lib/office-preview.js 的注释写明
 * "a missing renderer is an environment error"，lib/artifact-download.js 在缺渲染器
 * 时明确返回 503。安装期只负责给可操作提示。
 *
 * 这些断言是源码级的：它们描述的是"安装器会不会中止"，而完整跑一遍安装器的代价
 * （下 Node、装 pnpm 运行时、建 profile）不适合放进单元测试 —— 那部分由隔离的
 * 全量安装 E2E 覆盖（见提交信息与文档）。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/**
 * 剥离 JS 注释后再做"不该出现某调用"的断言。
 * 否则会误判：install.mjs 的文档注释里**正当**地提到了旧的
 * `soffice --headless --version` 探测（说明为什么改用解析器），
 * 直接对整个文件做正则会把它当成还在使用该方法。
 */
function stripJsComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
}

/** 取出 install.mjs 里 office 探测函数的正文，用于确认它不会 throw。 */
function officeProbeBody() {
	const source = read("scripts/install.mjs");
	const start = source.indexOf("async function probeOfficePreviewRuntime()");
	assert.ok(start >= 0, "install.mjs 里未找到 probeOfficePreviewRuntime");
	// 到下一个顶层 `async function` / `function` 声明为止
	const rest = source.slice(start + 1);
	const next = rest.search(/\n(async )?function /);
	return next >= 0 ? rest.slice(0, next) : rest;
}

test("install.mjs 复用 lib/office-preview.js 的解析器，而不是自己跑 soffice 探测", () => {
	const source = read("scripts/install.mjs");
	assert.match(source, /import \{ resolveSofficeExecutable \} from "\.\.\/lib\/office-preview\.js"/);
	// 旧的私有探测在 Windows 上会误判（soffice.exe 管道化时不输出版本，需 soffice.com）
	const code = stripJsComments(source);
	assert.equal(/execFile\(/.test(code), false, "install.mjs 不应再自行 execFile 探测渲染器");
	assert.equal(/--headless/.test(code), false, "install.mjs 不应再自行拼 soffice 参数");
});

test("office 探测函数不抛错（缺失渲染器只警告）", () => {
	const body = officeProbeBody();
	assert.equal(/throw /.test(body), false, "探测函数里不应有 throw —— 否则又会阻断安装");
	assert.match(body, /console\.warn/, "缺失渲染器必须给出警告，而不是静默");
	// 警告必须可操作：说明后果 + 给出安装命令
	assert.match(body, /不可用/);
	assert.match(body, /apt-get install/, "警告里应给出安装命令");
});

test("install.sh --skip-system-deps 不再因缺 soffice 中止", () => {
	const source = read("install.sh");
	const start = source.indexOf("跳过系统包安装");
	assert.ok(start >= 0, "install.sh 里未找到「跳过系统包安装」分支");
	const branch = source.slice(start, source.indexOf("mkdir -p \"$data_root/runtime\"", start));
	assert.equal(/exit 1/.test(branch), false, "该分支不应再 exit 1");
	assert.match(branch, /警告/, "应在缺 soffice 时给出警告");
});

test("apt-packages.txt 不再声明 soffice 是硬依赖，但仍默认安装 LibreOffice", () => {
	const text = read("runtime/apt-packages.txt");
	assert.equal(/intentionally hard-required/.test(text), false, "旧注释会误导：它已不再是硬依赖");
	assert.match(text, /不再阻断安装/, "应说明新策略");
	// 默认仍然安装：它是唯一的渲染器
	for (const pkg of ["libreoffice-core", "libreoffice-writer", "libreoffice-impress"]) {
		assert.ok(text.split("\n").includes(pkg), `应仍然默认安装 ${pkg}`);
	}
});
