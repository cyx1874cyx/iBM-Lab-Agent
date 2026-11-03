import { Service } from "@deepseek-ai/cordis";

import { cp, mkdir, readFile, readdir, realpath, stat, writeFile, unlink, rmdir, lstat } from "node:fs/promises";
import { resolve, relative, isAbsolute, basename, extname, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {randomUUID} from 'node:crypto';
import {simulationParameters} from '../src/nmr/simulation.js';
import { taskSchema, taskPrompt } from "../src/characterization.js";
import { todayLocal } from "../src/plot/models.js";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {saveNmrDraft,nmrStructureSource,nmrOpenPath,nmrFolderPath,NMR_STRUCTURE_EXTENSIONS,NMR_DATA_EXTENSIONS} from './nmr-intake.js';
import {createNmrSimulation,listNmrSimulations,registerSimulationMnova,simulationStructure} from './nmr-simulation.js';
export { characterizationDomain };
import { characterizationDomain } from '../src/characterization-domain.js';
const STRUCTURE_EXTENSIONS = NMR_STRUCTURE_EXTENSIONS;
export class LabCharacterizationService extends Service {
  static inject = ["storageDomain", "ibmCore", "labNmr", "labPlotRecords"];
  constructor(ctx, config = {}) {
    super(ctx, "labCharacterization");
    this.config = config;
    this.locks = /* @__PURE__ */ new Map();
  }
  async [Service.init]() {
    this.domain = await this.ctx.storageDomain.open(characterizationDomain);
    if (this.ctx.ibmCore.projectFiles) this.domain = await this.ctx.ibmCore.projectFiles.attachDomain(characterizationDomain, this.domain);
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
  /** 迁移辅助：插件启动时用它读取历史任务（避免两个服务同时 open 同一域）。 */
  allTasks() {
    return [...this.table.keys()].map((key) => this.table.get(key));
  }

  list(projectId) {
    return [...this.table.keys()].map((id) => this.table.get(id)).filter((row) => row.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  saveNmrDraft(fields){return saveNmrDraft(this,fields);}
  simulateNmr(fields){return createNmrSimulation(this,fields);}
  async simulationStructure(projectId,taskId,jobId){
    const row=this.get(taskId,projectId);if(!row.simulationJob||row.simulationJob.id!==jobId||!['queued','failed'].includes(row.simulationJob.status))throw Error('模拟任务不存在或状态不允许读取');
    const {result}=await simulationStructure(this,{projectId,taskId,parameters:row.simulationJob.parameters});return result;
  }
  registerSimulationMnova(projectId,taskId,result,path){return registerSimulationMnova(this,projectId,taskId,result,path);}
  listNmrSimulations(projectId){return listNmrSimulations(this,projectId);}
  async startSimulation(projectId,taskId,parameters){return this.serial(taskId,async()=>{
    const row=this.get(taskId,projectId);if(row.kind!=='nmr'||!row.structurePath)throw Error('请先提供分子结构');
    if(['queued','running'].includes(row.simulationJob?.status))throw Error('该条目的模拟任务正在运行');
    const old=row.simulationJob;
    const history=old?.status==='failed'?[...(old.history||[]),{attempt:old.attempt||1,error:old.error||'任务失败',retriedAt:new Date().toISOString()}]:old?.history;
    const job={id:randomUUID(),status:'queued',attempt:1,parameters:simulationParameters(parameters),history};
    await this.table.put(taskId,taskSchema.parse({...row,simulationJob:job,updatedAt:new Date().toISOString()}));
    return {job,prompt:`请执行核磁模拟任务。先调用 lab_nmr_simulation_structure（projectId=${projectId}，taskId=${taskId}，jobId=${job.id}），读取结构和可区分的原子环境。使用 nmr-analyze-simulate 技能，基于分子结构、化学位移规律、可核实的文献或用户明确提供的峰数据建立峰模型；尽可能覆盖所有符合设置的原子环境，对缺少精确数据的位点给出合理近似，并在 evidence 中说明是估计及其不确定性。不要调用旧自动预测器，不要将估计当作实测或伪造来源。每个可建模环境提供 environmentId、ppm、multiplicity（s/d/t/q/dd/quintet/sextet/septet）、jHz 和 evidence；dd 需额外提供 extraJHz，s 的 jHz 为 0。随后调用 lab_nmr_simulation_run，传入同一 projectId、taskId、jobId 和 peakModel（包含 provenance 与 peaks）。工具负责运行技能脚本生成合成 FID、在 Mnova 标峰并登记。若结构与现有实测谱相同，未经用户明确要求不得用实测峰冒充结构预测。结果标明模拟与峰模型依据；失败时如实报告。`};
  });}
  async updateSimulation(projectId,taskId,jobId,status,error,assignmentSummary){return this.serial(taskId,async()=>{
    const row=this.get(taskId,projectId),job=row.simulationJob;
    if(!job||job.id!==jobId)throw Error('模拟任务已过期');
    if(status==='running'&&!['queued','failed'].includes(job.status)||status!=='running'&&job.status!=='running')throw Error('模拟任务状态不允许此操作');
    const attempt=(job.attempt||1)+(status==='running'&&job.status==='failed'?1:0);
    const history=status==='running'&&job.status==='failed'?[...(job.history||[]),{attempt:job.attempt||1,error:job.error||'任务失败',retriedAt:new Date().toISOString()}]:job.history;
    const next=taskSchema.parse({...row,simulationJob:{...job,status,attempt,history,error:error?String(error).slice(0,1000):undefined,...(assignmentSummary?{assignmentSummary}:status==='running'?{assignmentSummary:undefined}:{})},updatedAt:new Date().toISOString()});
    await this.table.put(taskId,next);return next;
  });}
  async simulationDispatchFailed(projectId,taskId,jobId,error){return this.serial(taskId,async()=>{
    const row=this.get(taskId,projectId),job=row.simulationJob;
    if(!job||job.id!==jobId||job.status!=='queued')return row;
    const next=taskSchema.parse({...row,simulationJob:{...job,status:'failed',error:String(error||'任务派发失败').slice(0,1000)},updatedAt:new Date().toISOString()});await this.table.put(taskId,next);return next;
  });}
  nmrStructureSource(id,projectId){return nmrStructureSource(this,id,projectId);}
  nmrOpenPath(id,projectId,slot){return nmrOpenPath(this,id,projectId,slot);}
  nmrFolderPath(id,projectId){return nmrFolderPath(this,id,projectId);}
  async startNmr(id,projectId){
    const row=this.get(id,projectId);
    if(row.kind==='nmr'&&row.status==='failed')return this.retry(id,projectId);
    if(row.kind!=='nmr'||row.status!=='draft')throw Error('仅待补全的核磁条目可启动分析');
    if(!row.inputPath||!row.structurePath)throw Error('请同时提供核磁数据和目标结构');
    return this.submit({...row},{draftAttempt:row.attempt});
  }
  async bindSession(id,projectId,attempt,sessionId){
    return this.serial(id,async()=>{
      const row=this.get(id,projectId);
      if(row.attempt!==attempt)throw Error('过期的任务尝试');
      if(!['queued','running'].includes(row.status))throw Error('任务未在分析中');
      if(!sessionId||!(this.ctx.ibmCore.getProjectSession(projectId)?.sessionIds||[]).includes(sessionId))throw Error('分析会话不属于当前课题');
      if(row.sessionId&&row.sessionId!==sessionId)throw Error('任务已绑定其他分析会话');
      if(this.list(projectId).some(other=>other.id!==id&&other.sessionId===sessionId))throw Error('每个分析任务必须使用独立对话');
      const next=taskSchema.parse({...row,sessionId,conversationSessionId:sessionId,updatedAt:new Date().toISOString()});
      await this.table.put(id,next);return next;
    });
  }
  async cancelNmr(id,projectId,attempt){
    return this.serial(id,async()=>{
      const row=this.get(id,projectId);
      if(row.attempt!==attempt)throw Error('过期的任务尝试');
      if(row.kind!=='nmr')throw Error('该任务不是核磁任务');
      if(!['queued','running'].includes(row.status))return row;
      // Cancel only this task's bound session. Never stop the project's latest chat.
      const agent=row.sessionId?this.ctx.get('agents')?.get(row.sessionId):undefined;
      agent?.cancel({kind:'user'});
      // Fence late tool callbacks before another analysis can start.
      const next=taskSchema.parse({...row,status:'draft',attempt:row.attempt+1,conversationSessionId:row.sessionId||row.conversationSessionId,sessionId:undefined,error:undefined,updatedAt:new Date().toISOString()});
      await this.table.put(id,next);return next;
    });
  }
  async filePath(projectId, path, directory = false) {
    if (!this.ctx.ibmCore.getProject(projectId)) throw new Error("课题不存在");
    const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
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
    const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
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
    if (NMR_DATA_EXTENSIONS.has(extname(inputPath).toLowerCase())&&extname(inputPath).toLowerCase()!=='.zip'){
      if(!info.size)throw Error('核磁数据文件为空');
      return inputPath;
    }
    if (extname(inputPath).toLowerCase() !== ".zip") throw new Error("核磁原始数据必须是 FID 目录或包含 FID 目录的 ZIP 文件");
    const zipBuffer = await readFile(inputPath);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.values(zip.files);
    if (!entries.length || entries.length > 5000) throw new Error("FID ZIP 为空或文件数量过多");
    const digest = createHash("sha256").update(zipBuffer).digest("hex").slice(0, 12);
    const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
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
  async submit(fields,{draftAttempt}={}) {
    return this.serial(fields.id, async () => {
      if(draftAttempt!==undefined){const current=this.get(fields.id,fields.projectId);if(current.status!=='draft'||current.attempt!==draftAttempt)throw Error('该条目状态已改变，请刷新后重试');}
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const prepared = { ...fields };
      if(!prepared.inputPath)throw Error('核磁任务缺少输入数据');
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
      const previous=this.table.get(prepared.id);
      const row = taskSchema.parse({ ...prepared, date: prepared.date || todayLocal(), status: "queued", artifacts: {}, artifactHistory: [], attempt: previous?.attempt||1, sessionId: void 0, error: void 0, createdAt: now, updatedAt: now });
      const old = this.table.get(row.id);
      if (old) {
        if(old.projectId===row.projectId&&old.kind==='nmr'&&old.status==='draft'){
          await this.table.put(row.id,{...row,createdAt:old.createdAt});
          return {task:this.get(row.id),prompt:taskPrompt(row)};
        }
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
      if(row.sessionId&&patch.sessionId&&row.sessionId!==patch.sessionId)throw Error('任务不属于当前分析会话');
      if (row.status === "completed") return row;
      if (row.status === "draft") throw new Error('请先启动核磁分析');
      if (row.status === "failed" && patch.status !== "failed") throw new Error("失败任务须先重试");
      if (!["running", "failed"].includes(patch.status)) throw new Error("无效任务状态");
      const next = taskSchema.parse({ ...row, status: patch.status, sessionId: patch.sessionId || row.sessionId, conversationSessionId:patch.sessionId||row.sessionId||row.conversationSessionId, error: patch.status === "failed" ? String(patch.error || "任务执行失败") : void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
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
      const next = { ...row, status: "queued", attempt: row.attempt + 1, error: void 0, conversationSessionId:row.sessionId||row.conversationSessionId, sessionId: void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await this.table.put(id, next);
      return { task: next, prompt: taskPrompt(next) };
    });
  }
  async remove(id, projectId, requestedKind, deleteFiles = [], mode = 'record') {
    return this.serial(id, async () => {
      if(!['record','outputs','all'].includes(mode))throw Error('无效的删除操作');
      if(!Array.isArray(deleteFiles)||deleteFiles.some(slot=>!['simulation','spectrum','report'].includes(slot)))throw Error('无效的删除选项');
      const task = this.table.get(id);
      if (task && task.projectId !== projectId) throw new Error("任务不存在或不属于当前课题");
      const kind = task?.kind || requestedKind;
      if (!["nmr", "plot"].includes(kind)) throw new Error("删除登记时必须指定 nmr 或 plot");
      const linked = kind === "nmr"
        ? this.ctx.labNmr.listDatasets().find((row) => row.id === id)
        : await this.ctx.labPlotRecords.get(id);
      if (linked && linked.projectId !== projectId) throw new Error(`${kind === "nmr" ? "核磁" : "绘图"}记录不属于当前课题`);
      if (!task && !linked) throw new Error("登记条目不存在或不属于当前课题");
      if(mode!=='record'&&kind!=='nmr')throw Error('该删除操作仅适用于核磁条目');
      if(mode==='outputs'&&!deleteFiles.length)throw Error('请至少选择一种产出文件');
      if(mode==='all')deleteFiles=['simulation','spectrum','report'].filter(slot=>slot==='simulation'?task?.simulationArtifact:task?.artifacts?.[slot]||(task?.artifactHistory||[]).some(h=>h.artifacts?.[slot]));
      if(deleteFiles.length&&kind!=='nmr')throw Error('文件删除选项仅适用于核磁条目');
      if(task&&(['queued','running'].includes(task.status)||['queued','running'].includes(task.simulationJob?.status)))throw Error('任务正在运行，请等待结束或先停止分析');

      // Delete only recorded outputs, never input files or a directory tree.
      // Check every selection before deleting anything; shared or modified files are retained.
      const candidates=[];
      if(deleteFiles.includes('simulation')&&task?.simulationArtifact)candidates.push({slot:'simulation',artifact:task.simulationArtifact});
      for(const slot of ['spectrum','report'])if(deleteFiles.includes(slot)){
        if(task?.artifacts?.[slot])candidates.push({slot,artifact:task.artifacts[slot]});
        for(const history of task?.artifactHistory||[])if(history.artifacts?.[slot])candidates.push({slot,artifact:history.artifacts[slot]});
      }
      for(const slot of deleteFiles)if(!candidates.some(candidate=>candidate.slot===slot))throw Error('所选文件没有可校验的登记记录：'+slot);
      const workspace=deleteFiles.length||mode==='all'?await this.ctx.ibmCore.ensureProjectWorkspace(projectId):null;
      const key=path=>process.platform==='win32'?path.toLowerCase():path;
      const protectedPaths=new Set();
      const isShared=path=>[...protectedPaths].some(ref=>{const target=key(path),sep=process.platform==='win32'?'\\':'/';return ref===target||ref.startsWith(target+sep)||target.startsWith(ref+sep);});
      const protect=async path=>{if(!path)return;try{protectedPaths.add(key(await realpath(resolve(workspace.path,path))));}catch(error){if(error.code!=='ENOENT')throw error;}};
      if(workspace){
        if(mode!=='all')for(const path of [task?.inputPath,task?.rawInputPath,task?.structurePath,linked?.fidPath,linked?.structurePath])await protect(path);
        if(!deleteFiles.includes('simulation'))await protect(task?.simulationArtifact?.path);
        for(const slot of ['spectrum','report'])if(!deleteFiles.includes(slot)){
          await protect(task?.artifacts?.[slot]?.path);await protect(linked?.[slot==='spectrum'?'spectrumPath':'reportPath']);
          for(const history of task?.artifactHistory||[])await protect(history.artifacts?.[slot]?.path);
        }
        for(const other of this.list(projectId).filter(row=>row.id!==id)){
          for(const path of [other.inputPath,other.rawInputPath,other.structurePath,other.simulationArtifact?.path,...Object.values(other.artifacts||{}).map(a=>a.path),...(other.artifactHistory||[]).flatMap(h=>Object.values(h.artifacts||{}).map(a=>a.path))])await protect(path);
        }
        for(const other of this.ctx.labNmr.listDatasets().filter(row=>row.projectId===projectId&&row.id!==id))for(const path of [other.fidPath,other.structurePath,other.spectrumPath,other.reportPath])await protect(path);
      }
      const files=[],seen=new Set(),missing=[];
      for(const {slot,artifact} of candidates){
        let path;try{path=await this.filePath(projectId,artifact.path);}catch(error){if(error.code==='ENOENT'){missing.push({slot,fileName:artifact.fileName});continue;}throw error;}
        if(isShared(path))throw Error(`文件被输入或其他条目使用，不能删除：${artifact.fileName}`);
        if(createHash('sha256').update(await readFile(path)).digest('hex')!==artifact.sha256)throw Error(`文件内容已改变，不能删除：${artifact.fileName}`);
        if(!seen.has(key(path))){seen.add(key(path));files.push({slot,path,fileName:artifact.fileName});}
      }
      const dirs=[];
      if(mode==='all'){
        const root=await realpath(workspace.path);
        const inside=path=>{const rel=relative(root,path);return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);};
        const collect=async(raw,slot)=>{
          if(!raw)return;const absolute=resolve(root,raw);let info;try{info=await lstat(absolute);}catch(error){if(error.code==='ENOENT')return;throw error;}
          if(info.isSymbolicLink())throw Error('原始文件包含符号链接，无法安全删除：'+basename(absolute));
          const path=await realpath(absolute);if(!inside(path))throw Error('删除路径必须位于当前课题内');
          if(isShared(path))throw Error('文件或目录被其他条目引用，不能删除：'+basename(path));
          if(info.isDirectory()){
            for(const child of await readdir(path))await collect(join(path,child),slot);
            dirs.push(path);
          }else if(info.isFile()&&!seen.has(key(path))){seen.add(key(path));files.push({slot,path,fileName:basename(path)});}
        };
        for(const raw of [task?.inputPath,task?.rawInputPath,task?.structurePath,linked?.fidPath,linked?.structurePath])await collect(raw,'input');
        if(!task)for(const raw of [linked?.spectrumPath,linked?.reportPath])await collect(raw,'output');
        const simulationRoot=join(root,'nmr-simulations');let entries=[];try{entries=await readdir(simulationRoot);}catch(error){if(error.code!=='ENOENT')throw error;}
        for(const entry of entries.filter(name=>/^synthetic-[a-f0-9-]{36}$/.test(name))){
          const folder=join(simulationRoot,entry);let model;
          try{const modelPath=await this.filePath(projectId,join(folder,'synthetic-model.json'));model=JSON.parse(await readFile(modelPath,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
          if(model.projectId===projectId&&model.taskId===id&&model.synthetic===true)await collect(folder,'simulation');
        }
      }
      const deleted=[];
      try{for(const file of files){await unlink(file.path);deleted.push(file.fileName);}for(const dir of [...new Set(dirs)])await rmdir(dir);}
      catch(error){throw Error(`删除文件失败，条目仍保留；已删除：${deleted.join('、')||'无'}。${error.message}`);}

      if(mode==='outputs'){
        if(task){
          const artifacts={...task.artifacts},history=(task.artifactHistory||[]).map(item=>{const entries={...item.artifacts};for(const slot of deleteFiles)delete entries[slot];return {...item,artifacts:entries};});
          for(const slot of deleteFiles)delete artifacts[slot];
          const next=taskSchema.parse({...task,artifacts,artifactHistory:history,...(deleteFiles.includes('simulation')?{simulationArtifact:undefined,simulationId:undefined,simulationJob:undefined}:{}),updatedAt:new Date().toISOString()});
          await this.table.put(id,next);
        }
        if(linked)await this.ctx.labNmr.persist({...linked,...(deleteFiles.includes('spectrum')?{spectrumPath:undefined}:{}),...(deleteFiles.includes('report')?{reportPath:undefined}:{})});
        return {id,kind,entryPreserved:true,deletedFiles:files.map(({slot,fileName})=>({slot,fileName})),missingFiles:missing};
      }

      if (task) await this.table.delete(id);
      try {
        if (linked && kind === "nmr") await this.ctx.labNmr.removeDataset(id, projectId);
        if (linked && kind === "plot") await this.ctx.labPlotRecords.remove(id);
      } catch (error) {
        if (task) await this.table.put(id, task);
        throw error;
      }
      return deleteFiles.length||mode==='all'?{ id, kind, filesPreserved: files.length===0, deletedFiles:files.map(({slot,fileName})=>({slot,fileName})), missingFiles:missing }:{id,kind,filesPreserved:true};
    });
  }
  async complete(id, projectId, fields) {
    return this.serial(id, async () => {
      let row = this.get(id, projectId);
      if (fields.attempt !== row.attempt) throw new Error("过期的任务尝试");
      if (row.status === "completed") return row;
      if (row.status === "draft") throw new Error('请先启动核磁分析');
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
        const documents = this.ctx.get("ibmDocuments");
        if (!documents) throw new RemoteError("feature-unavailable", "Document export is stopped", { service: "ibmDocuments" });
        await writeFile(generatedPath, await documents.markdownToDocx(markdown, { title: row.title }));
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
      const workspace = await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
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
