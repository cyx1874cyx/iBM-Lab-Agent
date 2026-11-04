import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../helpers/boot-lite.mjs";

const panelPath = join(repoRoot, "plugins/literature/client/src/lit-panel.js");
const templatesPath = join(repoRoot, "client/src/components-templates.js");
const sdkPath = join(repoRoot, "client/src/sdk.js");

test("精读条目：已移除自动分类入口与提示", async () => {
	const panel = await readFile(panelPath, "utf8");
	assert.doesNotMatch(panel, /自动分类|autoOrganize|setOrganizing/);
	assert.doesNotMatch(panel, /classificationReason 自动归类|folderName 与 classificationReason/);
	assert.match(panel, /模板管理/);
});

test("精读/PPT 任务点击即发送，不再二次确认", async () => {
	const panel = await readFile(panelPath, "utf8");
	assert.match(panel, /onRequestArtifact\(readingPrompt,true,/);
	assert.match(panel, /onRequestArtifact\(pptPrompt,true,/);
	assert.doesNotMatch(panel, /onRequestArtifact\(readingPrompt,false,/);
	assert.doesNotMatch(panel, /预填精读任务/);
});

test("文献面板通过宿主模板库管理三类模板", async () => {
	const panel = await readFile(panelPath, "utf8");
	const sdk = await readFile(sdkPath, "utf8");
	const templates = await readFile(templatesPath, "utf8");
	assert.match(panel, /TemplateLibrary/);
	assert.match(panel, /sections:\['notes','reviews','ppt'\]/);
	assert.match(sdk, /Templates as TemplateLibrary/);
	assert.match(templates, /visibleTabs/);
	// 左侧纵向页签 + 模板导入入口；列表页不再有“新建”按钮。
	assert.match(templates, /flexDirection: "column"/);
	assert.match(templates, /模板导入/);
	assert.doesNotMatch(templates, /\+ 新建阅读笔记模板/);
});
