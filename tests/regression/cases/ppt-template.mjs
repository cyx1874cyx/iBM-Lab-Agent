/**
 * Regression case: PptTemplateProfile.
 *
 * §八 PPT 模板测试：三种课题组模板导入正确识别比例/主题/布局/占位符；
 * 11 个版式角色均可填充（建议映射覆盖且布局存在）；无效映射在生成前拒绝；
 * nature-default 内置模板可用。
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { buildThreeTemplates } from "../../../tests/fixtures/pptx-builder.mjs";
import { LAYOUT_ROLES } from "../../../src/ppt-template.js";

export default {
	name: "ppt-template",
	description: "三种模板导入识别正确；11 角色均可填充；无效映射拒绝",
	tags: ["templates"],
	required: [],
	async run() {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-tpl-"));
		const templatesDir = join(dir, "templates");
		await mkdir(templatesDir, { recursive: true });
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [
				{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir } }
			]
		});
		try {
			const templates = handle.ctx.labTemplates;
			const problems = [];

			if (!(await templates.list()).some((t) => t.id === "nature-default")) problems.push("nature-default not seeded");

			const presets = await buildThreeTemplates();
			for (let i = 0; i < presets.length; i++) {
				const path = join(dir, `t${i}.pptx`);
				await writeFile(path, presets[i].buffer);
				const { profile, parsed, suggestions } = await templates.importPptx(`reg-template-${i + 1}`, { pptxPath: path, meta: { name: `模板${i + 1}` } });
				if (!profile.pageSize.ratio) problems.push(`template ${i + 1}: missing ratio`);
				if (parsed.layouts.length === 0) problems.push(`template ${i + 1}: no layouts`);
				if (profile.theme.colors.accent1 === undefined) problems.push(`template ${i + 1}: theme colors missing`);
				if (Object.keys(suggestions).length !== LAYOUT_ROLES.length) problems.push(`template ${i + 1}: suggestions incomplete`);

				// 每角色均可填充：建议映射覆盖全部角色且布局存在
				const layoutIds = new Set(parsed.layouts.map((l) => l.id));
				for (const role of LAYOUT_ROLES) {
					if (!suggestions[role] || !layoutIds.has(suggestions[role].layoutId)) {
						problems.push(`template ${i + 1}: role '${role}' not fillable`);
					}
				}
			}

			// 无效映射拒绝（确认不发布）
			const preview = await templates.preview("reg-template-1");
			const mapping = Object.fromEntries(preview.roles.map((r) => [r.role, { layoutId: r.layoutId }]));
			const rejected = await templates.confirmMapping("reg-template-1", "1", { ...mapping, cover: { layoutId: "missing-layout" } });
			if (rejected.ok) problems.push("invalid mapping accepted");
			if ((await templates.resolve("reg-template-1")).status !== "draft") problems.push("invalid mapping published");

			return { pass: problems.length === 0, details: problems.length === 0 ? "3 templates imported, roles fillable, invalid mapping rejected" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
