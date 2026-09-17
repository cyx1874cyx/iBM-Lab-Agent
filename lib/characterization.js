import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, basename, extname, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { taskSchema, taskPrompt } from "../src/characterization.js";
import { todayLocal } from "../src/plot/models.js";
import { markdownToDocx } from "./md2docx.js";
export const characterizationDomain = defineDomain({ name: "lab_characterization", version: 0, tables: { tasks: domainTable(taskSchema) } });
const STRUCTURE_EXTENSIONS = new Set([".mol", ".sdf", ".cdx", ".cdxml", ".mrv", ".cml", ".smi", ".inchi"]);
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
  pathInside(root, target) {
    const rel = relative(root, target);
    return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
  }
  async importExternalPath(projectId, taskId, sourcePath, label) {
    const workspace = await this.ctx.labTasks.ensureProjectWorkspace(projectId);
    const workspaceRoot = await realpath(workspace.path);
    const source = await realpath(resolve(sourcePath));
    if (this.pathInside(workspaceRoot, source)) return source;
    const configured = Array.isArray(this.config.allowedImportRoots) ? this.config.allowedImportRoots : [];
    const candidates = [
      process.env.IBM_LAB_MNOVA_WORKSPACE,
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "iBM-Lab-Agent") : undefined,
      process.env.USERPROFILE ? join(process.env.USERPROFILE, ".codex", "attachments") : undefined,
      ...configured
    ].filter(Boolean);
    let allowed = false;
    for (const candidate of candidates) {
      try { if (this.pathInside(await realpath(candidate), source)) { allowed = true; break; } }
      catch { /* optional root is absent */ }
    }
    if (!allowed) throw new Error("外部输入必须来自 iBM Lab Agent/Codex 附件目录；请先作为会话附件上传");
    const info = await stat(source);
    const fingerprint = createHash("sha256").update(`${source}\0${info.size}\0${info.mtimeMs}`).digest("hex").slice(0, 12);
    const destination = join(workspaceRoot, "imports", taskId, `${label}-${fingerprint}-${basename(source)}`);
    try { await stat(destination); return destination; } catch { /* first import */ }
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: info.isDirectory(), errorOnExist: true, force: false });
    return destination;
  }
  procparValue(text, key) {
    const lines = String(text).split(/\r?\n/);
    const index = lines.findIndex((line) => line.startsWith(`${key} `));
    if (index < 0 || index + 1 >= lines.length) return undefined;
    const valueLine = lines[index + 1].trim().replace(/^\d+\s+/, "");
    const quoted = valueLine.match(/^"([\s\S]*?)"/);
    return quoted ? quoted[1] : valueLine.split(/\s+/)[0];
  }
  normalizeRunDate(value) {
    if (!value) return undefined;
    const compact = String(value).match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const timestamp = Number(value);
    if (Number.isFinite(timestamp) && timestamp > 1e8) return new Date(timestamp * 1000).toISOString().slice(0, 10);
    return undefined;
  }
  async inferNmrMetadata(datasetRoot, structurePath) {
    let nucleus, deuteratedSolvent, date;
    try {
      const procpar = await readFile(join(datasetRoot, "procpar"), "utf8");
      nucleus = this.procparValue(procpar, "tn");
      deuteratedSolvent = this.procparValue(procpar, "solvent");
      date = this.normalizeRunDate(this.procparValue(procpar, "time_run"));
    } catch {
      try {
        const acqus = await readFile(join(datasetRoot, "acqus"), "utf8");
        const value = (key) => acqus.match(new RegExp(`^##\\$${key}=\\s*(?:<([^>]+)>|([^\\r\\n]+))`, "m"))?.slice(1).find(Boolean)?.trim();
        nucleus = value("NUC1");
        deuteratedSolvent = value("SOLVENT");
        date = this.normalizeRunDate(value("DATE"));
      } catch { /* metadata stays optional */ }
    }
    let name;
    try {
      const firstLine = (await readFile(structurePath, "utf8")).split(/\r?\n/, 1)[0]?.trim();
      if (firstLine) name = firstLine;
    } catch { /* binary structure formats need Mnova */ }
    return { name, nucleus, deuteratedSolvent, date };
  }
  async findNmrDatasetRoot(root, depth = 0) {
    const names = new Set(await readdir(root));
    if (names.has("fid") && (names.has("procpar") || names.has("acqus")) || names.has("ser") && names.has("acqus")) return root;
    if (depth >= 5) return undefined;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const found = await this.findNmrDatasetRoot(join(root, entry.name), depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  async materializeNmrInput(projectId, taskId, inputPath) {
    const info = await stat(inputPath);
    if (info.isDirectory()) {
      const root = await this.findNmrDatasetRoot(inputPath);
      if (!root) throw new Error("FID 目录缺少 fid+procpar（Varian/Agilent）或 fid/ser+acqus（Bruker）");
      return root;
    }
    if (extname(inputPath).toLowerCase() !== ".zip") throw new Error("核磁原始数据必须是 FID 目录或包含 FID 目录的 ZIP 文件");
    const zipBuffer = await readFile(inputPath);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.values(zip.files);
    if (!entries.length || entries.length > 5000) throw new Error("FID ZIP 为空或文件数量过多");
    const digest = createHash("sha256").update(zipBuffer).digest("hex").slice(0, 12);
    const workspace = await this.ctx.labTasks.ensureProjectWorkspace(projectId);
    const outputRoot = join(workspace.path, "nmr-inputs", `${taskId}-${digest}`);
    await mkdir(outputRoot, { recursive: true });
    let total = 0;
    for (const entry of entries) {
      const normalized = entry.name.replaceAll("\\", "/");
      const parts = normalized.split("/").filter(Boolean);
      if (!parts.length || normalized.startsWith("/") || parts.some((part) => part === ".." || part.includes(":"))) throw new Error("FID ZIP 含有不安全路径");
      const target = join(outputRoot, ...parts);
      const rel = relative(outputRoot, target);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("FID ZIP 含有越界路径");
      if (entry.dir) { await mkdir(target, { recursive: true }); continue; }
      const buffer = await entry.async("nodebuffer");
      total += buffer.length;
      if (buffer.length > 256 * 1024 * 1024 || total > 512 * 1024 * 1024) throw new Error("解压后的 FID 数据超过 512 MB");
      await mkdir(resolve(target, ".."), { recursive: true });
      try { await writeFile(target, buffer, { flag: "wx" }); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
    }
    const root = await this.findNmrDatasetRoot(outputRoot);
    if (!root) throw new Error("ZIP 中未找到可识别的 FID 目录（需要 fid+procpar 或 fid/ser+acqus）");
    return root;
  }
  async submit(fields) {
    return this.serial(fields.id, async () => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const prepared = { ...fields };
      if (fields.importExternal) {
        prepared.inputPath = await this.importExternalPath(fields.projectId, fields.id, fields.inputPath, "fid");
        if (fields.structurePath) prepared.structurePath = await this.importExternalPath(fields.projectId, fields.id, fields.structurePath, "structure");
      }
      prepared.inputPath = await this.filePath(prepared.projectId, prepared.inputPath, prepared.kind === "nmr");
      if (prepared.kind === "nmr") {
        if (!prepared.structurePath) throw new Error("核磁任务必须同时提供 MOL 或其他机器可读结构文件");
        prepared.structurePath = await this.filePath(prepared.projectId, prepared.structurePath);
        prepared.structureSha256 = createHash("sha256").update(await readFile(prepared.structurePath)).digest("hex");
        if (!STRUCTURE_EXTENSIONS.has(extname(prepared.structurePath).toLowerCase())) throw new Error("结构文件格式不支持，请使用 MOL、SDF、CDX、CDXML、MRV、CML、SMI 或 InChI");
        prepared.inputPath = await this.materializeNmrInput(prepared.projectId, prepared.id, prepared.inputPath);
        const inferred = await this.inferNmrMetadata(prepared.inputPath, prepared.structurePath);
        prepared.title ||= inferred.name || basename(prepared.structurePath, extname(prepared.structurePath));
        prepared.nucleus ||= inferred.nucleus || "1H";
        prepared.deuteratedSolvent ||= inferred.deuteratedSolvent;
        prepared.date ||= inferred.date;
        prepared.instructions ||= `根据 ${basename(prepared.structurePath)} 对 ${basename(prepared.inputPath)} 完成 Mnova 自动处理、峰归属和归档。`;
        if (!prepared.compound && inferred.name) prepared.compound = { name: inferred.name };
      }
      const row = taskSchema.parse({ ...prepared, date: prepared.date || todayLocal(), status: "queued", artifacts: {}, artifactHistory: [], attempt: 1, sessionId: void 0, error: void 0, createdAt: now, updatedAt: now });
      const old = this.table.get(row.id);
      if (old) {
        if (old.projectId !== row.projectId || old.kind !== row.kind || old.inputPath !== row.inputPath || old.structurePath !== row.structurePath || old.title !== row.title || old.instructions !== row.instructions || old.date !== row.date || old.nucleus !== row.nucleus || old.deuteratedSolvent !== row.deuteratedSolvent || JSON.stringify(old.compound) !== JSON.stringify(row.compound)) throw new Error("请求 ID 已用于另一任务");
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
      if (row.kind === "nmr") {
        if (!row.structurePath) throw new Error("旧核磁任务缺少结构文件，请重新提交 FID + MOL");
        await this.filePath(row.projectId, row.structurePath);
      }
      const next = { ...row, status: "queued", attempt: row.attempt + 1, error: void 0, sessionId: void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await this.table.put(id, next);
      return { task: next, prompt: taskPrompt(next) };
    });
  }
  async complete(id, projectId, fields) {
    return this.serial(id, async () => {
      let row = this.get(id, projectId);
      if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
      if (row.status === "completed") return row;
      if (row.status === "failed") throw new Error("失败任务须先重试");
      if (row.kind === "nmr" && !fields.assessment && !row.assessment) throw new Error("核磁完成登记必须包含 assessment：verdict、confidence 和 summary");
      if (row.kind === "nmr" && (fields.compound || fields.nucleus || fields.deuteratedSolvent || fields.date || fields.assessment)) {
        row = taskSchema.parse({
          ...row,
          compound: fields.compound ? { ...(row.compound || {}), ...fields.compound, name: fields.compound.name || row.compound?.name || row.title } : row.compound,
          nucleus: fields.nucleus || row.nucleus,
          deuteratedSolvent: fields.deuteratedSolvent || row.deuteratedSolvent,
          date: fields.date || row.date,
          assessment: fields.assessment || row.assessment
        });
      }
      let reportPath = fields.reportPath;
      if (row.kind === "nmr" && reportPath && extname(reportPath).toLowerCase() === ".md") {
        const markdownPath = await this.archiveArtifactInput(row.projectId, row.id, reportPath, "report-source");
        const markdown = await readFile(markdownPath, "utf8");
        const generatedPath = join(dirname(markdownPath), `${basename(markdownPath, extname(markdownPath))}.docx`);
        await writeFile(generatedPath, await markdownToDocx(markdown, { title: row.title }));
        reportPath = generatedPath;
      }
      const slots = row.kind === "nmr" ? { spectrum: [fields.spectrumPath, [".mnova"]], report: [reportPath, [".docx"]] } : { origin: [fields.originPath, [".opju", ".opj"]] };
      const artifacts = {};
      for (const [slot, [raw, extensions]] of Object.entries(slots)) {
        if (!raw) throw new Error(`缺少 ${slot} 文件`);
        const path = await this.archiveArtifactInput(row.projectId, row.id, raw, slot);
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
        if (!dataset) dataset = await this.ctx.labNmr.createDataset({ id, projectId: row.projectId, name: row.title, fidPath: row.inputPath, structurePath: row.structurePath, compound: row.compound, nucleus: row.nucleus, deuteratedSolvent: row.deuteratedSolvent, date: row.date });
        await this.ctx.labNmr.persist({ ...dataset, taskId: id, date: row.date, spectrumPath: artifacts.spectrum.path, reportPath: artifacts.report.path, assessment: row.assessment });
      } else {
        const old = await this.ctx.labPlotRecords.get(id);
        if (old && old.projectId !== row.projectId) throw new Error("绘图记录课题不匹配");
        const fields2 = { taskId: id, artifactPath: artifacts.origin.path };
        if (old) await this.ctx.labPlotRecords.update(id, fields2);
        else await this.ctx.labPlotRecords.create({ id, projectId: row.projectId, topic: row.title, date: row.date, source: "agent", ...fields2 });
      }
      const next = taskSchema.parse({ ...row, status: "completed", artifacts, error: void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      await this.table.put(id, next);
      return next;
    });
  }
  async archiveArtifactInput(projectId, taskId, raw, label) {
    try { return await this.filePath(projectId, raw); }
    catch (error) {
      if (!String(error?.message).includes("当前课题工作目录")) throw error;
      const imported = await this.importExternalPath(projectId, taskId, raw, `artifact-${label}`);
      return this.filePath(projectId, imported);
    }
  }
  async recomplete(id, projectId, fields) {
    let prior;
    await this.serial(id, async () => {
      const row = this.get(id, projectId);
      if (row.status !== "completed") throw new Error("仅已完成任务可重新登记；未完成任务请调用 complete");
      if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
      prior = row;
      const archivedAt = (/* @__PURE__ */ new Date()).toISOString();
      const revision = (row.artifactHistory?.length || 0) + 1;
      const workspace = await this.ctx.labTasks.ensureProjectWorkspace(projectId);
      const historyRoot = join(workspace.path, "characterization-history", id, `revision-${revision}`);
      await mkdir(historyRoot, { recursive: true });
      const historicArtifacts = {};
      for (const [slot, artifact] of Object.entries(row.artifacts || {})) {
        const source = await this.filePath(projectId, artifact.path);
        const target = join(historyRoot, `${slot}-${artifact.fileName}`);
        await cp(source, target, { force: false, errorOnExist: true });
        historicArtifacts[slot] = { ...artifact, path: target };
      }
      const history = [...(row.artifactHistory || []), { revision, archivedAt, artifacts: historicArtifacts, assessment: row.assessment }];
      const reopen = taskSchema.parse({ ...row, status: "running", artifactHistory: history, updatedAt: archivedAt });
      await this.table.put(id, reopen);
    });
    try { return await this.complete(id, projectId, fields); }
    catch (error) {
      await this.serial(id, async () => this.table.put(id, prior));
      throw error;
    }
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
