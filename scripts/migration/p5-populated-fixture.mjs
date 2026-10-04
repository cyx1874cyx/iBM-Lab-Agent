/** Explicitly inserted only by the isolated verifier; never part of a product bundle. */
import { Service } from "@deepseek-ai/cordis";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildDocx } from "../../tests/fixtures/office-builder.mjs";

export default class PopulatedFixture extends Service {
 static inject = ["ibmCore", "labTasks", "labGoals", "labTemplates"];
 constructor(ctx, config) { super(ctx, "labP5Fixture"); this.config = config; }
 async [Service.init]() {
  const core = this.ctx.ibmCore, projectId = "p5-composition", now = "2026-10-04T00:00:00.000Z";
  if (core.getProject(projectId)) return;
  const goals = await this.ctx.labGoals.list(), templates = await this.ctx.labTemplates.list();
  await this.ctx.labTasks.createProject({ id: projectId, name: "P5 可选科研课题", coreMarkdown: "# P5 核心记忆", goalProfileId: goals[0].id, templateId: templates[0].id });
  const root = core.requireProject(projectId).workspacePath;
  const bytes = await readFile(this.config.pdf), pdfPath = join(root, "fixture.pdf"); await writeFile(pdfPath, bytes);
  await core.commitSourceBundle({ id: "p5-source", projectId, title: "隔离验收文献（非真实科研结果）", doi: "10.1000/fixture", year: 2026, pdfPath, pdfSha256: createHash("sha256").update(bytes).digest("hex"), status: "succeeded", createdAt: now, updatedAt: now });
  await core.table("searches").put("p5-search", { id: "p5-search", projectId, title: "P5 隔离检索记录", query: "isolated fixture", status: "succeeded", results: [{ title: "隔离验收文献", doi: "10.1000/fixture", source: "fixture" }], createdAt: now, updatedAt: now });
  const docx = await buildDocx({ title: "P5 ISOLATED SOFTWARE FIXTURE", paragraphs: ["Not scientific evidence. Not approved for export."] });
  const docxPath = join(root, "fixture-report.docx"); await writeFile(docxPath, docx.buffer);
  for (const [index, status, titleZh] of [[1, "under-review", "P5 待审核精读"], [2, "running", "P5 进行中精读"], [3, "failed", "P5 失败精读"]]) {
   const id = `p5-report-${index}`;
   await core.table("reports").put(id, { id, projectId, bundleId: "p5-source", goalSnapshot: {}, paperCardRequirements: {}, titleZh, shortCitation: `P5 FIXTURE ${index}`, summary: "软件迁移隔离样例，不构成真实文献或科研结论。", status, ...(index === 1 ? { docxPath, artifactSha256: createHash("sha256").update(docx.buffer).digest("hex") } : {}), ...(status === "failed" ? { error: "隔离样例：生成失败" } : {}), createdAt: now, updatedAt: now });
   await core.table("presentations").put(`p5-ppt-${index}`, { id: `p5-ppt-${index}`, projectId, reportId: id, templateSnapshot: {}, status: index === 1 ? "failed" : "pending", ...(index === 1 ? { error: "隔离样例：PPT 失败，不影响精读" } : {}), createdAt: now, updatedAt: now });
  }
 }
}
