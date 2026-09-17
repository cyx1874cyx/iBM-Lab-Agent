import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, isAbsolute, parse } from "node:path";
import { resolveToolProjectId } from "./project-context.js";
import { cleanJson } from "../src/json-boundary.js";
import { pythonCandidates, bundledPythonFromEnv } from "../src/python-env.js";
import { venvPython } from "../src/paths.js";
export const name = "characterization-tool";
export const inject = ["tools", "labTasks", "labCharacterization"];

const NMR_PREFLIGHT_SCRIPT = String.raw`
import importlib, json, pathlib, sys
required = ["numpy", "scipy", "matplotlib", "nmrglue"]
versions = {}
for name in required:
    module = importlib.import_module(name)
    versions[name] = getattr(module, "__version__", "available")
root = pathlib.Path(sys.argv[1])
if root.is_file():
    root = root.parent
result = {"python": sys.executable, "version": sys.version.split()[0], "packages": versions, "vendor": "unknown"}
def proc_value(procpar, name):
    row = procpar.get(name, {})
    values = row.get("values", []) if isinstance(row, dict) else []
    return values[0] if values else None
if root.is_dir() and (root / "fid").exists() and (root / "procpar").exists():
    import nmrglue as ng
    dic, data = ng.varian.read(str(root))
    procpar = dic.get("procpar", {})
    result.update({"vendor": "varian-agilent", "data_shape": list(data.shape), "metadata": {key: proc_value(procpar, key) for key in ["np", "sw", "sfrq", "at", "d1", "nt", "tn", "solvent"]}})
elif root.is_dir() and ((root / "fid").exists() or (root / "ser").exists()) and (root / "acqus").exists():
    import nmrglue as ng
    dic, data = ng.bruker.read(str(root))
    acqus = dic.get("acqus", {})
    result.update({"vendor": "bruker", "data_shape": list(data.shape), "metadata": {key: acqus.get(key) for key in ["SW_h", "SFO1", "AQ", "D", "NS", "NUC1", "SOLVENT"]}})
print(json.dumps(result, ensure_ascii=False, default=str))
`;

function runProbe(command, inputPath, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(command[0], [...command.slice(1), "-I", "-c", NMR_PREFLIGHT_SCRIPT, inputPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok: false, error: `探测超时（${timeoutMs} ms）` }); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("exit", (code) => {
      if (code !== 0) return finish({ ok: false, error: (stderr || stdout || `退出码 ${code}`).trim().slice(0, 1200) });
      try { finish({ ok: true, value: JSON.parse(stdout) }); }
      catch { finish({ ok: false, error: `探测输出不是 JSON：${(stdout || stderr).trim().slice(0, 1200)}` }); }
    });
  });
}

function pathInside(root, path) {
  if (!root || !path) return false;
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function datasetVenvCandidates(inputPath) {
  const suffix = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
  const found = [];
  let cursor = existsSync(inputPath) && statSync(inputPath).isFile() ? dirname(inputPath) : inputPath;
  const filesystemRoot = parse(cursor).root;
  while (cursor && cursor !== filesystemRoot) {
    for (const name of [".venv", "venv", ".nmr_env"]) {
      const executable = join(cursor, name, ...suffix);
      if (existsSync(executable)) found.push({ command: [executable], source: `dataset-${name}` });
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return found;
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "lab_characterization_submit",
    description: "用户在对话中交付 FID/ZIP 与 MOL 等结构文件时先调用：把会话附件安全导入当前课题，自动提取可用元数据并创建核磁任务。无需用户先去面板建任务。",
    parameters: {
      projectId: { type: "string" },
      taskId: { type: "string" },
      kind: { type: "string", enum: ["nmr", "plot"] },
      inputPath: { type: "string", required: true },
      structurePath: { type: "string" },
      title: { type: "string" },
      date: { type: "string" },
      nucleus: { type: "string" },
      deuteratedSolvent: { type: "string" },
      instructions: { type: "string" },
      compound: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, smiles: { type: "string" }, casNumber: { type: "string" } } }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(args, value) {
        if (!value.ok) return [{ type: "text", text: `表征任务创建失败：${value.error ?? "未知错误"}` }];
        return [{ type: "text", text: `核磁任务 ${value.taskId} 已创建并归入课题；FID 与结构文件已绑定。下一步调用 lab_characterization_preflight。` }];
      }
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      try {
        const resolved = resolveToolProjectId(ctx, args, exec);
        if (resolved.error) throw new Error(resolved.error);
        const kind = args.kind || "nmr";
        if (kind === "nmr" && !args.structurePath) throw new Error("核磁任务必须提供 structurePath（MOL/CDX 等）");
        const id = args.taskId || `${kind}-${randomUUID()}`;
        const result = await ctx.labCharacterization.submit({
          ...args,
          id,
          projectId: resolved.projectId,
          kind,
          importExternal: true
        });
        return cleanJson({ ok: true, taskId: result.task.id, attempt: result.task.attempt, status: result.task.status, inputPath: result.task.inputPath, structurePath: result.task.structurePath, title: result.task.title, date: result.task.date, nucleus: result.task.nucleus, deuteratedSolvent: result.task.deuteratedSolvent, compound: result.task.compound, prompt: result.prompt });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
  }));

  ctx.tools.register(defineTool({
    name: "lab_characterization_preflight",
    description: "核磁任务开始前执行一次：定位同时具备 numpy/scipy/matplotlib/nmrglue 的 Python，读取厂商数据形状与关键采集参数，并核对 Mnova 工作区路径。只读，不修改原始数据。",
    parameters: {
      projectId: { type: "string" },
      taskId: { type: "string", required: true }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render(args, value) {
        if (!value.ok) return [{ type: "text", text: `核磁环境预检失败：${value.error ?? "未知错误"}` }];
        const p = value.python;
        const meta = value.dataset?.metadata ?? {};
        return [{ type: "text", text: `核磁环境预检通过：${p.version}（${p.source}）\n解释器：${p.executable}\n数据：${value.dataset?.vendor ?? "unknown"} ${JSON.stringify(value.dataset?.dataShape ?? [])}\n结构：${value.structurePath}\n采集参数：${JSON.stringify(meta)}\nMnova 路径：FID ${value.pathAccessibleToMnova ? "可直接访问" : "不可直接访问"}；结构 ${value.structureAccessibleToMnova ? "可直接访问" : "不可直接访问"}` }];
      }
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      try {
        const resolved = resolveToolProjectId(ctx, args, exec);
        if (resolved.error) throw new Error(resolved.error);
        const task = ctx.labCharacterization.get(args.taskId, resolved.projectId);
        if (task.kind !== "nmr") throw new Error("该任务不是核磁任务");
        const workspace = await ctx.labTasks.ensureProjectWorkspace(resolved.projectId);
        const attempts = [];
        let selected;
        const candidates = [
          ...datasetVenvCandidates(task.inputPath),
          ...pythonCandidates({ venvPython: venvPython(), bundledPython: bundledPythonFromEnv() })
        ].filter((candidate, index, all) => all.findIndex((item) => item.command.join("\0") === candidate.command.join("\0")) === index);
        for (const candidate of candidates) {
          const result = await runProbe(candidate.command, task.inputPath);
          attempts.push({ source: candidate.source, command: candidate.command, ok: result.ok, error: result.error });
          if (result.ok) { selected = { candidate, value: result.value }; break; }
        }
        if (!selected) return cleanJson({ ok: false, error: "未找到同时具备 numpy、scipy、matplotlib、nmrglue 的 Python", attempts });
        const mnovaWorkspace = process.env.IBM_LAB_MNOVA_WORKSPACE || null;
        return cleanJson({
          ok: true,
          taskId: task.id,
          projectWorkspace: workspace.path,
          inputPath: task.inputPath,
          structurePath: task.structurePath,
          python: { source: selected.candidate.source, command: selected.candidate.command, executable: selected.value.python, version: selected.value.version, packages: selected.value.packages },
          dataset: { vendor: selected.value.vendor, dataShape: selected.value.data_shape, metadata: selected.value.metadata },
          mnovaWorkspace,
          pathAccessibleToMnova: pathInside(mnovaWorkspace, task.inputPath),
          structureAccessibleToMnova: pathInside(mnovaWorkspace, task.structurePath),
          attempts
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
  }));

  for (const action of ["update", "complete", "recomplete"]) {
    ctx.tools.register(defineTool({
      name: `lab_characterization_${action}`,
      description: action === "complete" ? "核磁/Mnova 或 Origin 绘图任务完成后必须调用：验证真实产物并自动归档回填课题条目。核磁必须同时提交结构吻合结论与 high/medium/low 置信度；报告可传 .md，系统自动生成 DOCX。" : action === "recomplete" ? "已完成的核磁或绘图产物返工后重新登记：保存旧版产物记录，重算哈希并用新产物和核磁判断更新条目。" : "更新核磁/绘图任务状态为 running 或 failed；失败必须记录原因。",
      parameters: { projectId: { type: "string" }, taskId: { type: "string", required: true }, attempt: { type: "number", required: true }, status: { type: "string" }, error: { type: "string" }, spectrumPath: { type: "string" }, reportPath: { type: "string" }, originPath: { type: "string" }, nucleus: { type: "string" }, deuteratedSolvent: { type: "string" }, date: { type: "string" }, assessment: { type: "object", additionalProperties: false, properties: { verdict: { type: "string", enum: ["match", "mismatch", "inconclusive"] }, confidence: { type: "string", enum: ["high", "medium", "low"] }, summary: { type: "string" } } }, compound: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, smiles: { type: "string" }, casNumber: { type: "string" } } } },
      output: {
        schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean", required: true }, error: { type: "string" }, taskId: { type: "string" }, status: { type: "string" } } },
        render(args, value) {
          if (!value.ok) return [{ type: "text", text: `表征任务${action === "update" ? "状态更新" : action === "complete" ? "完成登记" : "重新登记"}失败：${value.error ?? "未知错误"}` }];
          return [{ type: "text", text: `表征任务 ${value.taskId} 已${action === "update" ? `更新为 ${value.status}` : action === "complete" ? "完成并登记产物" : "重新登记产物并保留旧版记录"}。` }];
        }
      },
      async execute(args, exec) {
        try {
          const resolved = resolveToolProjectId(ctx, args, exec);
          if (resolved.error) throw new Error(resolved.error);
          const task = await ctx.labCharacterization[action](args.taskId, resolved.projectId, { ...args, sessionId: exec?.agent?.session?.id });
          return cleanJson({ ok: true, taskId: task.id, status: task.status });
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }
    }));
  }
}
