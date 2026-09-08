import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { taskSchema, taskPrompt } from "../src/characterization.js";
import { todayLocal } from "../src/plot/models.js";
export const characterizationDomain = defineDomain({ name: "lab_characterization", version: 0, tables: { tasks: domainTable(taskSchema) } });
export class LabCharacterizationService extends Service {
  static inject = ["storageDomain", "labTasks", "labNmr", "labPlotRecords"];
  constructor(ctx, config = {}) {
    super(ctx, "labCharacterization");
    this.config = config;
    this.locks = /* @__PURE__ */ new Map();
  }
  async [Service.init]() {
    this.domain = await this.ctx.storageDomain.open(characterizationDomain);
    this.ctx.effect(() => () => this.domain.close(), "lab.characterization.close");
    this.table = this.domain.table("tasks");
  }
  async serial(id, work) {
    const prior = this.locks.get(id) || Promise.resolve();
    const next = prior.catch(() => {
    }).then(work);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  get(id, projectId) {
    const row = this.table.get(id);
    if (!row || projectId && row.projectId !== projectId) throw new Error("任务不存在或不属于当前课题");
    return row;
  }
  list(projectId) {
    return [...this.table.keys()].map((id) => this.table.get(id)).filter((row) => row.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async filePath(projectId, path, directory = false) {
    if (!this.ctx.labTasks.getProject(projectId)) throw new Error("课题不存在");
    const workspace = await this.ctx.labTasks.ensureProjectWorkspace(projectId);
    const root = await realpath(workspace.path);
    const target = await realpath(resolve(root, path));
    const rel = relative(root, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("文件必须位于当前课题工作目录");
    const info = await stat(target);
    if (!info.isFile() && !(directory && info.isDirectory())) throw new Error("输入不是可读取的文件");
    return target;
  }
  async submit(fields) {
    return this.serial(fields.id, async () => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const row = taskSchema.parse({ ...fields, date: fields.date || todayLocal(), status: "queued", artifacts: {}, attempt: 1, sessionId: void 0, error: void 0, createdAt: now, updatedAt: now });
      row.inputPath = await this.filePath(row.projectId, row.inputPath, row.kind === "nmr");
      const old = this.table.get(row.id);
      if (old) {
        if (old.projectId !== row.projectId || old.kind !== row.kind || old.inputPath !== row.inputPath || old.title !== row.title || old.instructions !== row.instructions || old.date !== row.date || old.nucleus !== row.nucleus || old.deuteratedSolvent !== row.deuteratedSolvent || JSON.stringify(old.compound) !== JSON.stringify(row.compound)) throw new Error("请求 ID 已用于另一任务");
        return { task: old, prompt: taskPrompt(old) };
      }
      await this.table.put(row.id, row);
      return { task: row, prompt: taskPrompt(row) };
    });
  }
  async update(id, projectId, patch) {
    return this.serial(id, async () => {
      const row = this.get(id, projectId);
      if (patch.attempt !== row.attempt) throw new Error("过期的任务尝试");
      if (row.status === "completed") return row;
      if (row.status === "failed" && patch.status !== "failed") throw new Error("失败任务须先重试");
      if (!["running", "failed"].includes(patch.status)) throw new Error("无效任务状态");
      const next = taskSchema.parse({ ...row, status: patch.status, sessionId: patch.sessionId || row.sessionId, error: patch.status === "failed" ? String(patch.error || "任务执行失败") : void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      await this.table.put(id, next);
      return next;
    });
  }
  async retry(id, projectId) {
    return this.serial(id, async () => {
      const row = this.get(id, projectId);
      if (row.status !== "failed") throw new Error("仅失败任务可重试");
      await this.filePath(row.projectId, row.inputPath, row.kind === "nmr");
      const next = { ...row, status: "queued", attempt: row.attempt + 1, error: void 0, sessionId: void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await this.table.put(id, next);
      return { task: next, prompt: taskPrompt(next) };
    });
  }
  async complete(id, projectId, fields) {
    return this.serial(id, async () => {
      const row = this.get(id, projectId);
      if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
      if (row.status === "completed") return row;
      if (row.status === "failed") throw new Error("失败任务须先重试");
      const slots = row.kind === "nmr" ? { spectrum: [fields.spectrumPath, [".mnova"]], report: [fields.reportPath, [".docx"]] } : { origin: [fields.originPath, [".opju", ".opj"]] };
      const artifacts = {};
      for (const [slot, [raw, extensions]] of Object.entries(slots)) {
        if (!raw) throw new Error(`缺少 ${slot} 文件`);
        const path = await this.filePath(row.projectId, raw);
        if (!extensions.includes(extname(path).toLowerCase())) throw new Error(`${slot} 文件格式不正确`);
        const info = await stat(path);
        if (info.size === 0 || info.size > 256 * 1024 * 1024) throw new Error("产物为空或超过 256 MB");
        const buffer = await readFile(path);
        if (slot === "report") {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(buffer);
          if (!zip.file("word/document.xml")) throw new Error("报告不是有效 Word 文档");
        }
        artifacts[slot] = { path, fileName: basename(path), byteLength: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
      }
      if (row.kind === "nmr") {
        let dataset = this.ctx.labNmr.listDatasets().find((x) => x.id === id);
        if (dataset && dataset.projectId !== row.projectId) throw new Error("核磁记录课题不匹配");
        if (!dataset) dataset = await this.ctx.labNmr.createDataset({ id, projectId: row.projectId, name: row.title, fidPath: row.inputPath, compound: row.compound, nucleus: row.nucleus, deuteratedSolvent: row.deuteratedSolvent, date: row.date });
        await this.ctx.labNmr.persist({ ...dataset, taskId: id, date: row.date, spectrumPath: artifacts.spectrum.path, reportPath: artifacts.report.path });
      } else {
        const old = await this.ctx.labPlotRecords.get(id);
        if (old && old.projectId !== row.projectId) throw new Error("绘图记录课题不匹配");
        const fields2 = { taskId: id, artifactPath: artifacts.origin.path };
        if (old) await this.ctx.labPlotRecords.update(id, fields2);
        else await this.ctx.labPlotRecords.create({ id, projectId: row.projectId, topic: row.title, date: row.date, source: "agent", ...fields2 });
      }
      const next = { ...row, status: "completed", artifacts, error: void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await this.table.put(id, next);
      return next;
    });
  }
  async artifactFile(id, projectId, slot) {
    let row = this.table.get(id);
    if (!row) {
      const legacy = slot === "origin" ? await this.ctx.labPlotRecords.get(id) : this.ctx.labNmr.listDatasets().find((entry) => entry.id === id);
      if (!legacy || legacy.projectId !== projectId) throw new Error("记录不存在或不属于当前课题");
      const raw = slot === "origin" ? legacy.artifactPath : slot === "spectrum" ? legacy.spectrumPath : slot === "report" ? legacy.reportPath : undefined;
      if (!raw) throw new Error("文件尚未就绪");
      const path = await this.filePath(projectId, raw);
      const extensions = slot === "origin" ? [".opju", ".opj"] : slot === "spectrum" ? [".mnova"] : [".docx"];
      if (!extensions.includes(extname(path).toLowerCase())) throw new Error("文件格式不正确");
      const info = await stat(path);
      if (!info.size || info.size > 256 * 1024 * 1024) throw new Error("产物为空或超过 256 MB");
      const buffer = await readFile(path);
      return { buffer, fileName: basename(path), byteLength: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), mime: slot === "report" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream" };
    }
    row = this.get(id, projectId);
    const artifact = row.artifacts[slot];
    if (!artifact) throw new Error("文件尚未就绪");
    const path = await this.filePath(row.projectId, artifact.path);
    if ((await stat(path)).size > 256 * 1024 * 1024) throw new Error("产物超过 256 MB");
    const buffer = await readFile(path);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== artifact.sha256) throw new Error("产物已改变，请重新登记后打开");
    return { ...artifact, buffer, sha256, mime: slot === "report" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream" };
  }
}
export default LabCharacterizationService;
