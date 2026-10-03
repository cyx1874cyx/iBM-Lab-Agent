import { Service } from "@deepseek-ai/cordis";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { markdownToDocx } from "./md2docx.js";
import { inspectOfficePackage } from "../src/office-package.js";
import { literatureEntryLayout, entryFileName } from "./entry-layout.js";
import { atomicWrite } from "./tasks/shared.js";

/** Explicit files and immutable snapshots in; artifacts out. No literature service/table access. */
export class IbmDocumentsService extends Service {
 static inject = ["ibmCore", "ibmRuntime"];
 constructor(ctx) { super(ctx, "ibmDocuments"); }
 async markdownToDocx(markdown, options) { return await markdownToDocx(markdown, options); }
 async renderReadingDocx({ report, bundle, workspacePath, providedPath }) {
  const layout = literatureEntryLayout(workspacePath, bundle, report);
  const buffer = providedPath ? await readFile(providedPath) : await markdownToDocx(await readFile(report.paperCardPath, "utf8"), { title: report.titleZh || report.shortCitation || report.id });
  const integrity = await inspectOfficePackage(buffer, "docx");
  const docxPath = await atomicWrite(join(layout.entryDir, entryFileName(layout.entryStem, "report-docx")), buffer);
  return { docxPath, buffer, integrity };
 }
 async auditPaperCard(input, executor) { return await executor.auditPaperCard(input); }
 async auditPptx(input, executor) { return await executor.auditPptx(input); }
 async buildPptx(args, options) { return await this.ctx.ibmRuntime.buildPptx(args, options); }
}
export default IbmDocumentsService;
