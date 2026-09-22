/**
 * Windows 捆绑 Python 的装法守卫（把 Linux 侧已验证的 S2/L2 同步到 Windows 线）。
 *
 * 背景：Windows 线原先用 `markitdown[pdf,docx,pptx,xls,xlsx]` 装 markitdown，于是把
 * magika 与 onnxruntime（Windows 实测 33 MB）一并拉进捆绑 Python；`tests` 树也从未剥离
 * （129 个目录 ≈ 40 MB）。Linux 线已在 install.sh 里做了这两件事，这里守住 Windows 线
 * 采用同一套方案，且**固定版本与 Linux 锁一致**（否则两条线会悄悄分叉）。
 *
 * 这些断言只能在 Linux 上静态校验 —— 真正的验证靠 Windows 出包：bundled-python 阶段会
 * 断言 magika/onnxruntime 不存在，并做 pdf/docx/pptx/xlsx/html 五种格式的真实转换。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const bundledPython = read("desktop/scripts/build-bundled-python.ps1");
const release = read("desktop/scripts/build-windows-release.ps1");
const linuxLock = read("python/requirements-linux.lock");

/** 取出 build-bundled-python.ps1 里 markitdown 依赖数组的固定项。 */
function windowsMarkitdownPins() {
	const match = /\$markitdownDependencies = @\(([\s\S]*?)\)/.exec(bundledPython);
	assert.ok(match, "未找到 $markitdownDependencies 数组");
	return [...match[1].matchAll(/'([A-Za-z0-9_.-]+)==([^']+)'/g)].map((m) => `${m[1]}==${m[2]}`);
}

/** Linux 锁里的 name==version 映射（canonical 名）。 */
function linuxLockPins() {
	const canon = (n) => n.trim().toLowerCase().replace(/[-_.]+/g, "-");
	const pins = new Map();
	for (const line of linuxLock.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const m = /^([A-Za-z0-9._-]+)==([^\s]+)$/.exec(trimmed);
		if (m) pins.set(canon(m[1]), m[2]);
	}
	return pins;
}

test("Windows 线不再用会连带 magika/onnxruntime 的 markitdown extras", () => {
	const code = bundledPython
		.split("\n")
		.filter((line) => !line.trim().startsWith("#"))
		.join("\n");
	assert.equal(/markitdown\[/.test(code), false, "不应再出现 markitdown[pdf,docx,...]（会拉入 magika→onnxruntime）");
	assert.match(code, /--no-deps[^\n]*markitdown==0\.1\.7/, "markitdown 本体必须用 --no-deps 安装");
});

test("Windows 线会打 magika 可选化补丁，并从此前的 NodeExe 运行", () => {
	assert.match(bundledPython, /patch-markitdown\.mjs', 'patch'|patch-markitdown\.mjs" patch|patch-markitdown\.mjs.*patch/s, "应调用 patch-markitdown.mjs");
	assert.match(bundledPython, /\[string\]\$NodeExe/, "应接受 -NodeExe 参数");
	assert.match(bundledPython, /Node\.js is required to patch markitdown/, "缺 Node 时应提前失败并说明用途");
	assert.match(release, /'bundled-python'[\s\S]{0,400}'-NodeExe', \$NodeExe/, "发布脚本应把 -NodeExe 传给 bundled-python 阶段");
});

test("Windows 线会剥离第三方 tests 树，且保留 numpy/testing 这类公共 API", () => {
	const code = bundledPython
		.split("\n")
		.filter((line) => !line.trim().startsWith("#"))
		.join("\n");
	assert.match(code, /-eq 'tests' -or \$_.Name -eq 'test'/, "只应删除名字恰为 tests / test 的目录");
	assert.match(code, /numpy\\testing/, "应显式检查 numpy/testing 仍在（公共 API）");
	assert.match(code, /test_\*\.py|conftest\.py/, "应同时清理 test_*.py / conftest.py");
});

test("Windows 线自检会断言 magika/onnxruntime 不存在，并做真实转换", () => {
	assert.match(bundledPython, /magika chain is back/, "自检必须能发现链条回归");
	assert.match(bundledPython, /markitdown conversion self-check/, "自检必须做真实转换，而不是只 import");
	// 覆盖要求：pdf / docx / pptx / xlsx / html 各有样本
	for (const ext of ["sample.pdf", "sample.docx", "sample.pptx", "sample.xlsx", "sample.html"]) {
		assert.ok(bundledPython.includes(ext), `转换自检缺少 ${ext} 样本`);
	}
});

test("Windows 与 Linux 两条线的固定版本一致（防分叉）", () => {
	const linux = linuxLockPins();
	const pins = windowsMarkitdownPins();
	assert.ok(pins.length >= 6, `markitdown 依赖固定项过少：${pins.length}`);
	for (const pin of pins) {
		const [name, version] = pin.split("==");
		const canon = name.toLowerCase().replace(/[-_.]+/g, "-");
		const linuxVersion = linux.get(canon);
		// 只要 Linux 锁里也列了这一项，版本就必须逐字一致。
		// 注意 XlsxWriter 不在 Linux 锁文件里 —— 它是 python-pptx 声明依赖
		// （`XlsxWriter >=0.5.7`），在 Linux venv 里以 3.2.9 传递装入，与这里的
		// 显式 pin 同版本（已用 `pip show python-pptx` 与 venv 实测核对）。
		if (linuxVersion) {
			assert.equal(version, linuxVersion, `${name}: Windows=${version} 与 Linux=${linuxVersion} 不一致`);
		}
	}
	// 关键几项必须在 Linux 锁里能找到（证明是同一套版本，而不是各写各的）
	for (const name of ["beautifulsoup4", "cobble", "defusedxml", "mammoth", "markdownify", "soupsieve", "python-pptx"]) {
		const canon = name.toLowerCase().replace(/[-_.]+/g, "-");
		assert.ok(linux.has(canon), `Linux 锁里缺少 ${name}，两条线的依赖集已分叉`);
	}
});
