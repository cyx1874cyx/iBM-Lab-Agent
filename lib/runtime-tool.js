/**
 * dsh-lab-agent: 运行时环境工具（`lab_runtime_env`）。
 *
 * 0.5.4 现场反馈：Agent 需要在 shell 里跑 python / node / LibreOffice，但它只能靠猜 ——
 * 实际硬编码了 `C:\Program Files\iBM Lab Agent\node\node.exe`，并且因为桌面壳的沙箱
 * 拒绝写 `%LOCALAPPDATA%\Temp`，LibreOffice 建不出 user profile 时**静默不产出 PDF**。
 *
 * 本工具把「软件自带的运行时」暴露成一个可查询的事实源，让 Agent 不必猜、也不必依赖
 * 用户机器上装了什么。桌面壳已经把这些目录预置到子进程 PATH 最前面，因此 shell 里直接
 * 写 `python` / `node` 就会命中软件自带的那一份；本工具用于：
 *   - 拿绝对路径（写脚本、拼命令、排查"为什么用的是系统 python"）；
 *   - 拿**应当使用的临时目录**（工作区内的 `.lab-tmp`，一定能写）；
 *   - 拿渲染助手路径（`scripts/render-deck.mjs`，它自己处理 LibreOffice profile）。
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { fileURLToPath } from "node:url";

import { cleanJson } from "../src/json-boundary.js";
import { resolveAgentRuntime } from "../src/lab-runtime.js";
import { resolveSofficeExecutable } from "./office-preview.js";

export const name = "runtime-tool";
export const inject = ["tools", "ibmRuntime"];

/** 渲染助手（随插件一起分发）。 */
function renderHelperPath() {
	return fileURLToPath(new URL("../scripts/render-deck.mjs", import.meta.url));
}

/** 成品体检器（随插件一起分发）。 */
function inspectorPath() {
	return fileURLToPath(new URL("../scripts/pptx/inspect_deck.py", import.meta.url));
}

/** 运行时事实源：三个可执行文件 + 临时目录，字段与 output schema 严格对应。 */
export async function runtimeEnvironment({ env = process.env, platform = process.platform, cwd } = {}) {
	const runtime = await resolveAgentRuntime({ env, platform, cwd });
	const soffice = await resolveSofficeExecutable({ explicit: env.LAB_OFFICE_RENDERER, platform });
	const notes = [
		"shell 里直接写 python / node 即可：桌面壳已把软件自带运行时的目录放在子进程 PATH 最前面，不要硬编码 C:\\Program Files\\... 这类安装路径。",
		`临时文件一律放在 tempDir（${runtime.tempDir}）下：桌面壳已把子进程的 TMP/TEMP/TMPDIR 指到这里，但需要事后查看的产物仍应显式用它。`,
		`渲染 PPT/PDF 优先调用 lab_render_deck：软件宿主执行官方助手 ${renderHelperPath()}，返回逐页 PNG 和 contact sheet；不需要扩大 Agent 的沙箱权限。不要自己拼 soffice 命令，也不要为渲染申请完全访问。`,
		`核对成品先用体检器：${runtime.python.command || "python"} "${inspectorPath()}" --deck <file.pptx> --expect-latin Arial --expect-ea 微软雅黑 --expect-cs Arial；字体三槽/字号下限/图片拉伸/越界/未填占位符都能从 XML 断言，不消耗视觉 token。`,
		"上面两个路径是**绝对路径**，直接照抄使用；不要写成相对路径 —— Agent 的工作目录是课题工作区，不是插件安装目录。"
	];
	if (!soffice.command) {
		notes.push(`未找到宿主 LibreOffice：${soffice.hint}；lab_render_deck 优先使用软件自带 kit，不因此要求用户安装 LibreOffice。`);
	}
	return {
		ok: runtime.warnings.length === 0 || runtime.python.available,
		isolated: runtime.isolated,
		python: {
			available: runtime.python.available,
			command: runtime.python.command,
			argv: runtime.python.argv,
			source: runtime.python.source,
			version: runtime.python.version
		},
		node: {
			available: runtime.node.available,
			command: runtime.node.command,
			argv: runtime.node.argv,
			source: runtime.node.source,
			version: runtime.node.version
		},
		soffice: {
			available: soffice.command !== null,
			command: soffice.command ?? "",
			source: soffice.source,
			version: soffice.version ?? "",
			hint: soffice.command ? soffice.detail : soffice.hint
		},
		tempDir: runtime.tempDir,
		workspaceDir: runtime.workspaceDir ?? "",
		renderHelper: renderHelperPath(),
		inspector: inspectorPath(),
		notes,
		warnings: runtime.warnings
	};
}

export function apply(ctx) {
	ctx.tools.register(defineTool({
		name:'lab_render_deck',
		description:'用软件宿主调用官方 render-deck.mjs，渲染当前会话工作区内的 PPT/PPTX/PDF，输出逐页 PNG 和 contact sheet 供视觉核对。受限模式优先用本工具，不需要放宽权限，不接受任意命令或外部输出目录。',
		parameters:{input:{type:'string',required:true,description:'当前工作区内的 PPT/PPTX/PDF 路径'},pages:{type:'string',description:'可选：1,3,5-7；默认全部'},dpi:{type:'number',description:'50–200，默认 110'},sheetCols:{type:'number',description:'1–6，默认 3'}},
		output:{schema:{type:'object',additionalProperties:false,properties:{ok:{type:'boolean',required:true},error:{type:'string'},outDir:{type:'string'},contactSheet:{type:'string'},pages:{type:'array',items:{type:'object',additionalProperties:false,properties:{page:{type:'number'},path:{type:'string'},width:{type:'number'},height:{type:'number'}}}},renderer:{type:'string'},notes:{type:'array',items:{type:'string'}}}},render(_args,value){return [{type:'text',text:value.ok?`已渲染 ${value.pages.length} 页；先看总览图：${value.contactSheet}，必要时再看单页。`:`PPT 视觉核对未完成：${value.error}`}];}},
		timeoutMs:420000,
		async execute(args,exec){try{
			const workspace=exec?.agent?.session?.header?.cwd;
			const result=await ctx.get('ibmRuntime').renderDeck({...args,workspace},{signal:exec?.signal});return cleanJson({ok:result.ok,outDir:result.outDir,contactSheet:result.contactSheet,pages:result.pages,renderer:result.renderer,notes:result.notes});
		}catch(error){return {ok:false,error:error.message};}}
	}));
	ctx.tools.register(defineTool({
		name: "lab_runtime_env",
		description:
			"查询本软件自带的运行时环境（捆绑 Python / Node.js / LibreOffice 可执行文件绝对路径、应当使用的临时目录、渲染助手路径）。" +
			"在 shell 里跑 python、node 或渲染 PPT/PDF 之前调用它，不要靠猜或硬编码系统路径；" +
			"桌面端会把自带运行时放在 PATH 最前面，纯 CLI 端则回退到当前解释器。",
		parameters: {
			refresh: { type: "boolean", description: "可选：保留参数，当前每次调用都重新探测" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					isolated: { type: "boolean" },
					python: {
						type: "object",
						additionalProperties: false,
						properties: {
							available: { type: "boolean" },
							command: { type: "string" },
							argv: { type: "array", items: { type: "string" } },
							source: { type: "string" },
							version: { type: "string" }
						}
					},
					node: {
						type: "object",
						additionalProperties: false,
						properties: {
							available: { type: "boolean" },
							command: { type: "string" },
							argv: { type: "array", items: { type: "string" } },
							source: { type: "string" },
							version: { type: "string" }
						}
					},
					soffice: {
						type: "object",
						additionalProperties: false,
						properties: {
							available: { type: "boolean" },
							command: { type: "string" },
							source: { type: "string" },
							version: { type: "string" },
							hint: { type: "string" }
						}
					},
					tempDir: { type: "string" },
					workspaceDir: { type: "string" },
					renderHelper: { type: "string" },
					inspector: { type: "string" },
					notes: { type: "array", items: { type: "string" } },
					warnings: { type: "array", items: { type: "string" } }
				}
			},
			render(_args, value) {
				if (!value.ok) return [{ type: "text", text: `运行时环境不完整：${(value.warnings ?? []).join("；") || "未知原因"}` }];
				const lines = [
					`Python  : ${value.python.command || "（不可用）"}  [${value.python.source} ${value.python.version}]`,
					`Node.js : ${value.node.command || "（不可用）"}  [${value.node.source} ${value.node.version}]`,
					`Office  : ${value.soffice.command || "（不可用）"}  [${value.soffice.source} ${value.soffice.version}]`,
					`临时目录: ${value.tempDir}`,
					`渲染助手: ${value.renderHelper}`,
					"视觉核对: lab_render_deck（宿主执行官方助手；不需放宽 Agent 权限）",
					`成品体检: ${value.inspector}`
				];
				if (value.warnings.length > 0) lines.push(`警告：${value.warnings.join("；")}`);
				return [{ type: "text", text: lines.join("\n") }];
			}
		},
		timeoutMs: 30000,
		async execute(_args,exec) {
			try {
				const cwd=exec?.agent?.session?.header?.cwd;
				return cleanJson(await ctx.get("ibmRuntime").environment(cwd?{cwd,env:{...process.env,IBM_LAB_AGENT_WORKSPACE:cwd}}:undefined));
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}
