/**
 * dsh-lab-agent: 渲染助手（`scripts/render-deck.mjs`）的参数解析测试。
 *
 * 只测纯函数部分：真正的渲染需要 LibreOffice + PyMuPDF，属于人工/现场验证
 * （见 docs/AGENT_RUNTIME_ENVIRONMENT.md 里的实测记录）。这里保证 Agent 常见的
 * 几种调用形态不会解析错，尤其 `--no-contact-sheet` 与页区间。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { expandPages, parseArgv, resolveOfficeKit } from "../../scripts/render-deck.mjs";

test("parseArgv：缺省开启 contact sheet（省读图次数的默认值）", () => {
	const options = parseArgv(["deck.pptx"]);
	assert.equal(options.input, "deck.pptx");
	assert.equal(options.contactSheet, true);
	assert.equal(options.dpi, 110);
	assert.equal(options.sheetCols, 3);
	assert.equal(options.json, false);
});

test("parseArgv：显式选项都被接受", () => {
	const options = parseArgv([
		"deck.pptx",
		"--out", "/tmp/out",
		"--pages", "1,3,5-7",
		"--dpi", "150",
		"--sheet-cols", "2",
		"--json"
	]);
	assert.equal(options.out, "/tmp/out");
	assert.equal(options.pages, "1,3,5-7");
	assert.equal(options.dpi, 150);
	assert.equal(options.sheetCols, 2);
	assert.equal(options.json, true);
	assert.equal(options.contactSheet, true, "--json 不应关掉总览图");
});

test("parseArgv：--no-contact-sheet 与 --help", () => {
	assert.equal(parseArgv(["a.pdf", "--no-contact-sheet"]).contactSheet, false);
	assert.equal(parseArgv(["-h"]).help, true);
	assert.equal(parseArgv(["--help"]).help, true);
});

test("parseArgv：非法输入必须报错而不是静默忽略", () => {
	assert.throws(() => parseArgv(["a.pptx", "--nope"]), /未知参数/);
	assert.throws(() => parseArgv(["a.pptx", "b.pptx"]), /只接受一个输入文件/);
});

test("expandPages：把页区间展开成 kit CLI 接受的逗号列表", () => {
	assert.equal(expandPages("1,3,5-7"), "1,3,5,6,7");
	assert.equal(expandPages("3"), "3");
	assert.equal(expandPages("7-5"), "5,6,7", "区间写反了也应当展开");
	assert.equal(expandPages(""), "", "空表示全部（调用方转成 all）");
	assert.equal(expandPages(" 1 , 2-3 "), "1,2,3", "允许空格");
});

test("parseArgv：--no-kit 走宿主兜底路径", () => {
	assert.equal(parseArgv(["a.pptx"]).noKit, false);
	assert.equal(parseArgv(["a.pptx", "--no-kit"]).noKit, true);
});

test("resolveOfficeKit：显式关闭时不探测；默认能找到就是合法的 cli.js", async () => {
	// 逃生门：用户遇到 kit 问题时用 IBM_LAB_AGENT_OFFICE_KIT=off 或 --no-kit 强制走宿主路径。
	assert.deepEqual(await resolveOfficeKit({ env: { IBM_LAB_AGENT_OFFICE_KIT: "off" } }), {
		cliPath: null,
		source: "disabled",
		backend: undefined
	});
	assert.deepEqual(await resolveOfficeKit({ env: { IBM_LAB_AGENT_OFFICE_KIT: "OFF" } }), {
		cliPath: null,
		source: "disabled",
		backend: undefined
	});

	// 默认解析：本仓库 node_modules 里就有 kit，所以应当找到；CI 上若没装则允许 unavailable，
	// 但"找到了"就必须是 cli.js 且能报出 backend（probe 用 capabilities --json 证伪）。
	const resolved = await resolveOfficeKit({ env: {} });
	if (resolved.cliPath !== null) {
		assert.match(resolved.cliPath, /libreoffice-kit[\\/]lib[\\/]cli\.js$/);
		assert.equal(typeof resolved.backend, "string", "capabilities 应当报出 backend（native/wasm）");
		assert.ok(["native", "wasm"].includes(resolved.backend), `未知 backend：${resolved.backend}`);
	} else {
		assert.equal(resolved.source, "unavailable");
	}
});
