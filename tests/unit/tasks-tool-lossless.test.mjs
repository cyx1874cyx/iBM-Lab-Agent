import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../../lib/tasks-tool.js";

function hasUndefinedValue(value) {
	if (Array.isArray(value)) return value.some(hasUndefinedValue);
	if (value !== null && typeof value === "object") {
		return Object.values(value).some((child) => child === undefined || hasUndefinedValue(child));
	}
	return false;
}

function doiTool(resolveWechatPaperDoi) {
	const registered = [];
	apply({
		tools: { register: (tool) => registered.push(tool) },
		labTasks: {
			getProject: () => ({ id: "proj-test" }),
			resolveWechatPaperDoi
		}
	});
	const tool = registered.find((item) => item.name === "lab_tasks_resolve_wechat_doi");
	assert.ok(tool);
	return tool;
}

test("lab_tasks_resolve_wechat_doi returns lossless JSON when optional metadata is absent", async () => {
	const tool = doiTool(async () => ({
		title: "TRI-611, a selective molecular glue degrader of ALK",
		candidates: [{
			doi: "10.1038/s41586-026-10998-3",
			title: "TRI-611, a selective molecular glue degrader of ALK",
			authors: [],
			volume: undefined,
			issue: undefined,
			pages: undefined,
			yearMatch: undefined,
			confidence: "high",
			titleScore: 1,
			matchedAuthors: []
		}]
	}));
	const output = await tool.execute({ projectId: "proj-test", title: "TRI-611" }, {});
	assert.equal(output.ok, true);
	assert.equal(hasUndefinedValue(output), false);
	assert.deepEqual(Object.keys(output.candidates[0]).sort(), ["authors", "confidence", "doi", "matchedAuthors", "title", "titleScore"].sort());
});

test("lab_tasks_resolve_wechat_doi reports an empty-candidate error as normal JSON", async () => {
	const tool = doiTool(async () => { throw new Error("no DOI candidate passed verification for TRI-611"); });
	const output = await tool.execute({ projectId: "proj-test", title: "TRI-611" }, {});
	assert.deepEqual(output, { ok: false, error: "no DOI candidate passed verification for TRI-611" });
});
