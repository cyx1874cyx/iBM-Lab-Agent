import { test } from "node:test";
import assert from "node:assert/strict";
import {
	LAYOUT_ROLES,
	createNatureDefaultTemplate,
	suggestRoleMapping,
	validateTemplate,
	nextTemplateVersion,
	templateKey
} from "../../src/ppt-template.js";
import { parsePptx } from "../../src/pptx-parse.js";
import { buildPptx } from "../fixtures/pptx-builder.mjs";

test("LAYOUT_ROLES matches the plan's unified roles", () => {
	assert.deepEqual(LAYOUT_ROLES, [
		"cover", "background", "research-gap", "design-workflow", "full-figure",
		"figure-with-analysis", "comparison", "mechanism", "limitations", "summary", "appendix"
	]);
});

test("nature-default template is ready and self-consistent", () => {
	const t = createNatureDefaultTemplate();
	assert.equal(t.id, "nature-default");
	assert.equal(t.status, "ready");
	assert.equal(Object.keys(t.layoutRoleMapping).length, LAYOUT_ROLES.length);
	assert.equal(t.pageSize.ratio, "16:9");
});

test("suggestRoleMapping proposes layouts that exist and a sensible cover", async () => {
	const { buffer } = await buildPptx({ name: "lab-test", accent: "#1F4E79" });
	const parsed = await parsePptx(buffer);
	const layoutIds = new Set(parsed.layouts.map((l) => l.id));
	const suggestions = suggestRoleMapping(parsed.layouts, parsed.page);
	assert.equal(Object.keys(suggestions).length, LAYOUT_ROLES.length);
	for (const [role, s] of Object.entries(suggestions)) {
		assert.ok(layoutIds.has(s.layoutId), `${role} -> ${s.layoutId} must exist`);
	}
	// cover should prefer the title-only layout (slideLayout1)
	assert.equal(suggestions.cover.layoutId, "slideLayout1");
	// background should prefer the empty layout (slideLayout3)
	assert.equal(suggestions.background.layoutId, "slideLayout3");
	// full-figure should prefer the picture layout
	assert.equal(suggestions["full-figure"].layoutId, "slideLayout4");
});

test("validateTemplate rejects unknown layout ids and missing roles when ready", async () => {
	const { buffer } = await buildPptx({ name: "lab-test" });
	const parsed = await parsePptx(buffer);
	const layoutIds = parsed.layouts.map((l) => l.id);
	const mapping = Object.fromEntries(LAYOUT_ROLES.map((r) => [r, { layoutId: layoutIds[0] }]));

	const bad = {
		id: "t", version: "1", name: "t", purpose: "", audience: "",
		pageSize: { ratio: "16:9" }, theme: {}, logo: undefined, footerRules: "",
		layoutRoleMapping: { ...mapping, cover: { layoutId: "nope" } },
		requiredPages: [], optionalPages: [], maxPages: 10, notesRequirement: "",
		placeholderRules: {}, source: { file: "x", sha256: "y" }, status: "ready",
		createdAt: "now", updatedAt: "now"
	};
	const result = validateTemplate(bad, parsed);
	assert.equal(result.ok, false);
	assert.ok(result.problems.some((p) => p.includes("cover")));

	// missing roles when ready
	const missing = { ...bad, layoutRoleMapping: { cover: { layoutId: layoutIds[0] } } };
	const r2 = validateTemplate(missing, parsed);
	assert.equal(r2.ok, false);
	assert.ok(r2.problems.some((p) => p.includes("unmapped")));

	// draft with partial mapping is allowed
	const draft = { ...bad, layoutRoleMapping: { cover: { layoutId: layoutIds[0] } }, status: "draft" };
	assert.equal(validateTemplate(draft, parsed).ok, true);

	// fully mapped ready passes
	const full = { ...bad, layoutRoleMapping: mapping };
	assert.deepEqual(validateTemplate(full, parsed), { ok: true, problems: [] });
});

test("nextTemplateVersion and templateKey", () => {
	assert.equal(nextTemplateVersion(["1", "2"]), "3");
	assert.equal(templateKey("t", "5"), "t@5");
});
