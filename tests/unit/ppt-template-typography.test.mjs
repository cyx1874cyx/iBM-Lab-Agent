/**
 * 端到端断言：**CLI 生产路径**必须把模板真实排版接进 slots.json，且解析不到时不许静默退化。
 *
 * 为什么要单独立这条：0.5.4 试用复盘后修容量模型时踩过一次"测试全绿但生产路径退化"——
 * `deriveSlotSpec` 拿不到 typography 就退回默认 1.2 倍行距模型，算出的容量与 pptx-cli 的
 * `max_lines` 等价（本模板实测 19 vs 19），**修复等于没生效而且不报错**。当时 18 个单测全过，
 * 因为单元测试都是直接给 `deriveSlotSpec` 传 typography 的，绕过了 CLI 那一段接线。
 * 所以这里真的起一个进程跑 `scripts/lint-ppt-template.mjs --write-slots`，只看落盘结果。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { writeManifestPackage } from "../fixtures/ppt-manifest-fixture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = join(repoRoot, "scripts", "lint-ppt-template.mjs");
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";

/** 合成一个只含"版式 XML + 母版"的最小 pptx，版式里带指定的行距/段间距。 */
function layoutXml({ name, idx, lineSpacingPts, spaceBeforePts, spaceAfterPts }) {
	const spacing = [
		lineSpacingPts ? `<a:lnSpc><a:spcPts val="${lineSpacingPts * 100}"/></a:lnSpc>` : "",
		spaceBeforePts ? `<a:spcBef><a:spcPts val="${spaceBeforePts * 100}"/></a:spcBef>` : "",
		spaceAfterPts ? `<a:spcAft><a:spcPts val="${spaceAfterPts * 100}"/></a:spcAft>` : ""
	].join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A}" xmlns:p="${P}"><p:cSld name="${name}"><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="10" name="文本占位符 20"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="${idx}"/></p:nvPr></p:nvSpPr>
<p:spPr><a:bodyPr/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr>${spacing}<a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle>
<a:p><a:r><a:t>正文</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sldLayout>`;
}

async function writeSyntheticTemplate(path, options) {
	const zip = new JSZip();
	zip.file("ppt/slideLayouts/slideLayout3.xml", layoutXml(options));
	zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A}" xmlns:p="${P}"><p:txStyles><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle></p:txStyles></p:sldMaster>`);
	await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

/** 跑真实 CLI，返回 {status, stdout, stderr, outDir}。 */
function runCli(targetDir, outDir) {
	const result = spawnSync(process.execPath, [CLI, targetDir, "--no-cli", "--write-slots", "--json", "--out", outDir], {
		cwd: repoRoot,
		encoding: "utf8"
	});
	return { ...result, outDir };
}

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const slotOf = (spec, layoutId, key) => spec.layouts.find((layout) => layout.layoutId === layoutId).slots.find((slot) => slot.key === key);

test("CLI --write-slots（裸 manifest 目录形态）：模板真实行距/段间距必须落进 slots.json", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-cli-wiring-"));
	try {
		const pkgDir = join(dir, "manifest");
		await writeManifestPackage(pkgDir, { skipSourceTemplate: true });
		await writeSyntheticTemplate(join(pkgDir, "assets", "source-template.pptx"), { name: "Fig1", idx: 15, lineSpacingPts: 30, spaceBeforePts: 10, spaceAfterPts: 14 });
		const outDir = join(dir, "out");
		const { stderr } = runCli(pkgDir, outDir);
		// 退出码只反映体检门控（夹具 manifest 自带 1 个 blocking error，与本用例无关）；
		// --write-slots 在返回码之前完成，这里只认落盘结果。
		const spec = await readJson(join(outDir, "slots.json"));
		assert.ok(stderr !== undefined);
		assert.equal(spec.capacityModel.source, "template-xml", "CLI 必须把模板排版接上，否则容量退化成 pptx-cli 等价");
		const analysis = slotOf(spec, "fig1", "analysis");
		assert.equal(analysis.lineHeightPt, 30, "模板写的是固定 30pt 行距");
		assert.equal(analysis.spaceBeforePt, 10);
		assert.equal(analysis.spaceAfterPt, 14);
		assert.equal(analysis.capacitySource, "computed-template");
		assert.equal(analysis.lineHeightSource, "template-lnSpc");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI --write-slots（版本目录形态 <vN>/manifest + source.pptx）：同样解析到模板排版", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-cli-verdir-"));
	try {
		const versionDir = join(dir, "tpl-fixture", "v1");
		const pkgDir = join(versionDir, "manifest");
		await writeManifestPackage(pkgDir, { skipSourceTemplate: true });
		// 生产形态：版本目录下有 source.pptx，manifest 包里有 assets 副本（pptx-cli init 的产物）。
		await writeSyntheticTemplate(join(versionDir, "source.pptx"), { name: "Fig1", idx: 15, lineSpacingPts: 30, spaceBeforePts: 10, spaceAfterPts: 14 });
		await writeSyntheticTemplate(join(pkgDir, "assets", "source-template.pptx"), { name: "Fig1", idx: 15, lineSpacingPts: 30, spaceBeforePts: 10, spaceAfterPts: 14 });
		const outDir = join(dir, "out");
		runCli(versionDir, outDir);
		const spec = await readJson(join(outDir, "slots.json"));
		assert.equal(spec.capacityModel.source, "template-xml");
		assert.equal(slotOf(spec, "fig1", "analysis").lineHeightPt, 30);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("模板 pptx 缺失时**不许静默退化**：报 capacity-typography-unresolved，且 slots.json 标 defaults", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ppt-cli-nodoc-"));
	try {
		const pkgDir = join(dir, "manifest");
		await writeManifestPackage(pkgDir, { skipSourceTemplate: true });
		const outDir = join(dir, "out");
		const { stdout } = runCli(pkgDir, outDir);
		const report = JSON.parse(stdout);
		const finding = report.findings.find((row) => row.code === "capacity-typography-unresolved");
		assert.ok(finding, "拿不到模板排版时必须显式报警，而不是只留一个字段");
		assert.equal(finding.severity, "warning");
		assert.match(finding.message, /不优于/);
		assert.match(finding.hint, /source-template\.pptx/);
		const spec = await readJson(join(outDir, "slots.json"));
		assert.equal(spec.capacityModel.source, "defaults", "退化要如实标注来源");
		assert.equal(slotOf(spec, "fig1", "analysis").capacitySource, "computed-default-typography");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("真实模板（本机有 /tmp/pcinit 时才跑）：fig1/analysis 自算 15 行 vs pptx-cli 19 行", async (t) => {
	if (!existsSync("/tmp/pcinit/manifest.yaml") || !existsSync("/tmp/pcinit/assets/source-template.pptx")) {
		t.skip("本机没有 /tmp/pcinit（真实模板的 manifest 包），跳过");
		return;
	}
	const dir = await mkdtemp(join(tmpdir(), "ppt-cli-real-"));
	try {
		const outDir = join(dir, "out");
		runCli("/tmp/pcinit", outDir);
		const spec = await readJson(join(outDir, "slots.json"));
		assert.equal(spec.capacityModel.source, "template-xml");
		const analysis = slotOf(spec, "fig1", "analysis");
		assert.equal(analysis.lineHeightPt, 30, "真实模板正文是固定 30pt 行距");
		assert.equal(analysis.capacityLines, 15);
		assert.equal(analysis.cliCapacityLines, 19, "pptx-cli 只按高度、硬编码 1.22 倍");
		assert.equal(analysis.capacityOptimistic, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
