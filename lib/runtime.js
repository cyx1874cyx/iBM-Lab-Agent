import { Service } from "@deepseek-ai/cordis";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { SkillExecutor } from "../src/skill-executor.js";
import { venvPythonPath } from "../src/python-env.js";
import { convertWithMarkitdown, probeMarkitdown } from "../src/markitdown.js";
import { runPptxBuilder } from "../src/pptx-builder.js";
import { runtimeEnvironment } from "./runtime-tool.js";
import { applicationSpec, describeApplications } from "./applications/registry.js";

/** Managed execution boundary. Platform/native providers remain the P4 work package. */
export class IbmRuntimeService extends Service {
 static inject = ["ibmCore"];
 constructor(ctx, config = {}) { super(ctx, "ibmRuntime"); this.config = config; }
 async [Service.init]() {
  this.active = true;
  this.pending = new Set();
  this.ctx.effect(() => async () => { this.active = false; await Promise.allSettled([...this.pending]); }, "ibm-runtime.invalidate");
 }
 assertActive() { if (!this.active) throw new RemoteError("feature-unavailable", "Scientific runtime is stopped", { service: "ibmRuntime" }); }
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
  const executor = new SkillExecutor({ skillsRoot: config.skillsRoot ?? this.config.skillsRoot, venvPython: this.python(config) });
  const runtime = this;
  return new Proxy(executor, { get(target, key) {
   const value = target[key];
   return typeof value === "function" ? (...args) => runtime.track(() => value.apply(target, args)) : value;
  } });
 }
 async skillSnapshot(name) { this.assertActive(); return await this.ctx.get("labVersions")?.resolveNatureSkill(name); }
 async environment(options) { return await this.track(() => runtimeEnvironment(options)); }
 applications(options) { this.assertActive(); return describeApplications(options); }
 applicationSpec(appKey) { this.assertActive(); return applicationSpec(appKey); }
 async convert(path, options = {}) { return await this.track(() => convertWithMarkitdown(path, options)); }
 async probeConversion(options = {}) { return await this.track(() => probeMarkitdown(options)); }
 async buildPptx(args, options = {}) { return await this.track(() => runPptxBuilder(args, options)); }
}
export default IbmRuntimeService;
