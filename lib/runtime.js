import { Service } from "@deepseek-ai/cordis";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { SkillExecutor } from "../src/skill-executor.js";
import { venvPythonPath, bundledPythonFromEnv, resolvePythonExecutable } from "../src/python-env.js";
import { ProcessSupervisor } from "../src/runtime/process-supervisor.js";
import { nativeMcpConfig } from "../src/runtime/native-applications.js";
import { convertWithMarkitdown, probeMarkitdown } from "../src/markitdown.js";
import { runPptxBuilder } from "../src/pptx-builder.js";
import { runtimeEnvironment } from "./runtime-tool.js";
import { renderDeckJob } from "../src/deck-render-job.js";
import { applicationSpec, describeApplications } from "./applications/registry.js";
import {runMnovaJob} from '../src/runtime/mnova-job.js';
import {runSyntheticFid} from '../src/runtime/nmr-synthetic-fid.js';
import {runPlotJob} from '../src/runtime/plot-job.js';
import {createPlotSession} from '../src/runtime/plot-session.js';

/** Scientific execution ownership; desktop capabilities are explicit providers. */
export class IbmRuntimeService extends Service {
 static inject = ["ibmCore"];
 constructor(ctx, config = {}) { super(ctx, "ibmRuntime"); this.config = config; }
 async [Service.init]() {
  this.active = true;
  this.pending = new Set();
  this.resources = new Set();
  this.controller = new AbortController();
  const resolved = await resolvePythonExecutable({ venvPython: this.python(), bundledPython: bundledPythonFromEnv() });
  this.processes = new ProcessSupervisor(resolved.command);
  this.ctx.effect(() => async () => { this.active = false; this.controller.abort(new Error("Scientific runtime stopped")); await Promise.allSettled([...this.resources].map(close => close())); this.resources.clear(); await this.processes.dispose(); await Promise.allSettled([...this.pending]); }, "ibm-runtime.invalidate");
 }
 assertActive() { if (!this.active) throw new RemoteError("feature-unavailable", "Scientific runtime is stopped", { service: "ibmRuntime" }); }
 ownResource(close) { this.assertActive(); this.resources.add(close); return () => this.resources.delete(close); }
 track(work) {
  this.assertActive();
  const result = work();
  if (!result || typeof result.then !== "function") return result;
  this.pending.add(result);
  return result.finally(() => this.pending.delete(result));
 }
 python(config = {}) { return (config.venvDir ?? this.config.venvDir) ? venvPythonPath(config.venvDir ?? this.config.venvDir) : undefined; }
 createExecutor(config = {}) {
  this.assertActive();
  const executor = new SkillExecutor({ skillsRoot: config.skillsRoot ?? this.config.skillsRoot, venvPython: this.python(config), spawnImpl: this.processes.spawn, signal: this.controller.signal });
  const runtime = this;
  return new Proxy(executor, { get(target, key) {
   const value = target[key];
   return typeof value === "function" ? (...args) => runtime.track(() => value.apply(target, args)) : value;
  } });
 }
 async skillSnapshot(name) { this.assertActive(); return await this.ctx.get("labVersions")?.resolveNatureSkill(name); }
 async mnova(projectId,tool,args,options={}){
  if(!['mnova_status','mnova_probe_runtime','mnova_process_1d','mnova_prepare_structure_1d','mnova_apply_assignments_1d'].includes(tool))throw Error('不支持的 Mnova 操作');
  const workspace=await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
  const config=this.mcpConfig('mnova',{projectId});config.cwd=workspace.path;
  return this.track(()=>runMnovaJob(config,tool,args,{spawnImpl:this.processes.spawn,signal:options.signal?AbortSignal.any([options.signal,this.controller.signal]):this.controller.signal}));
 }
 async syntheticNmrFid(modelPath,outputDir,options={}){
  return this.track(()=>runSyntheticFid(this.processes.python,modelPath,outputDir,{spawnImpl:this.processes.spawn,signal:options.signal?AbortSignal.any([options.signal,this.controller.signal]):this.controller.signal}));
 }
 async environment(options) { return await this.track(() => runtimeEnvironment(options)); }
 async plot(projectId,action,args,options={}){
  if(!['inspect','prepare','render','status','image','layout'].includes(action))throw Error('不支持的绘图操作');
  if(action==='render'&&args.tier!=='preview'&&!args.layoutMode&&process.env.IBM_PLOT_FIXED_PAGE_MARGIN==='true')args={...args,layoutMode:'fixed'};
  const workspace=await this.ctx.ibmCore.ensureProjectWorkspace(projectId);
  const config=this.mcpConfig('origin',{projectId});config.cwd=workspace.path;
  if(action==='render'&&!args.referenceSpec){
   if(!this.plotSession||this.plotSession.closed){const session=createPlotSession(config,this.processes.spawn);this.plotSession=session;this.ownResource(()=>session.close());}
   return this.track(()=>this.plotSession.run(args,{signal:options.signal?AbortSignal.any([options.signal,this.controller.signal]):this.controller.signal}));
  }
  return this.track(()=>runPlotJob(config,action,args,{spawnImpl:this.processes.spawn,onProgress:options.onProgress,timeoutMs:action==='status'?8000:undefined,signal:options.signal?AbortSignal.any([options.signal,this.controller.signal]):this.controller.signal}));
 }
 async renderDeck(args,options={}) { return await this.track(()=>renderDeckJob(args,{spawnImpl:this.processes.spawn,signal:options.signal?AbortSignal.any([options.signal,this.controller.signal]):this.controller.signal})); }
 applications(options) { this.assertActive(); return describeApplications(options); }
 applicationSpec(appKey) { this.assertActive(); return applicationSpec(appKey); }
 mcpConfig(appKey, options = {}) {
  this.assertActive();
  const project = options.projectId ? this.ctx.ibmCore.requireProject(options.projectId) : undefined;
  return nativeMcpConfig(appKey, { python: bundledPythonFromEnv() ?? this.python(), toolProfile: options.toolProfile, workspaceRoot: project?.workspacePath ?? this.ctx.ibmCore.projectsRoot });
 }
 async convert(path, options = {}) { return await this.track(() => convertWithMarkitdown(path, { ...options, spawnImpl: this.processes.spawn })); }
 async probeConversion(options = {}) { return await this.track(() => probeMarkitdown({ ...options, spawnImpl: this.processes.spawn })); }
 async buildPptx(args, options = {}) { return await this.track(() => runPptxBuilder(args, { ...options, spawnImpl: this.processes.spawn })); }
}
export default IbmRuntimeService;
