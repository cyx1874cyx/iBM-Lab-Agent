/**
 * dsh-lab-agent: 文献产物登记模型工具（lab_tasks_register_search / _register_bundle /
 * _register_report / _register_presentation）。
 *
 * 让科研 Agent 在对话中完成文献检索/原文整理/精读/PPT 后，把产物登记到
 * 课题的 lab_tasks 域——这样课题面板「文献资料」四个板块（检索汇总/原文
 * 整理/精读报告/PPT 汇报）才会显示，而不是恒为空。
 * 优先按会话绑定反查所属课题，并以会话 cwd 匹配课题工作区作为回退；
 * 也可显式传 projectId。
 */

import { existsSync, statSync } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveToolProjectId } from "./project-context.js";
import { cleanJson } from "../src/json-boundary.js";
import { archiveSlotOf } from "../src/manual-capture.js";
import { deriveCaptureView } from "./capture-phase.js";

export const name = "tasks-tool";
export const inject = ["tools", "ibmLiteratureWorkflows"];

/** 解析目标课题：显式 projectId → 会话绑定 → 会话 cwd。 */
function resolveProjectId(ctx, args, exec) {
	return resolveToolProjectId(ctx, args, exec);
}

function summaryPaperId(paper) {
	return String(paper.doi ?? paper.pmid ?? paper.arxivId ?? paper.id ?? paper.landingUrl ?? paper.title ?? "").trim();
}

/**
 * 把前置条件类错误翻译成**可执行的下一步**。
 *
 * 真实试用：Agent 直接登记 PPT 被拒 `reading report '…' has no staged report artifact yet`，
 * 报错没说该做什么，白耗了几轮才自己猜出"得先生成并 stage 精读报告"。依赖链本身是合理的
 * （PPT 要有报告才谈得上"汇报"），但必须写清楚，而不是让调用方反推。
 */
export function withRegistrationNextStep(error) {
	const message = error?.message ?? String(error);
	if (/has no staged report artifact/.test(message)) {
		return `${message} —— 下一步：这篇论文还没有已暂存的精读报告。先用精读报告工具生成并登记该报告` +
			"（lab_tasks_register_report 会返回 reportId），再用同一个 reportId 调本工具登记 PPT。" +
			"注意：公众号/题录元数据登记（lab_tasks_register_wechat_paper、lab_tasks_register_paper_meta）" +
			"只登记条目元数据，不会自动生成精读报告。";
	}
	return message;
}

/**
 * 文献条目命名的可覆盖段（三个登记工具共用）：
 *   <期刊缩写> <年份> <通讯作者> <中文内容概括> <英文题目前段>
 * 年份取自元数据，其余四段由 Agent 提供；缺哪段就少哪段，不写占位词。
 */
const ENTRY_NAMING_PARAMETERS = {
	journalAbbrev: { type: "string", description: "可选：期刊缩写（如 JACS / ACS NANO / AFM），命名第一段。缺省按内置表查 journal" },
	correspondingAuthor: { type: "string", description: "可选：通讯作者，命名第三段。检索库不标注通讯作者，末位作者只是启发式——请从 PDF 首页脚注/星标确认后传入" },
	summaryZh: { type: "string", description: "可选：两三中文词语的内容概括（如「仿生纳米囊泡 化疗免疫」），命名第四段，同时决定条目目录名" },
	titleLead: { type: "string", description: "可选：英文题目前段，命名第五段。缺省取标题前 8 个词；命名里不允许出现标点（会被自动清除）" }
};

/** 从工具参数里挑出非空命名段；全空时返回 undefined（不覆盖已有命名）。 */
function pickEntryNaming(args) {
	const naming = {};
	for (const key of ["journalAbbrev", "correspondingAuthor", "summaryZh", "titleLead"]) {
		if (typeof args?.[key] === "string" && args[key].trim()) naming[key] = args[key];
	}
	return Object.keys(naming).length > 0 ? naming : undefined;
}

function parseSummaryText(value) {
	return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
		const match = line.match(/^(.+?)\s*(?:\t|=>|\|)\s*(.+)$/);
		return match ? { paperId: match[1].trim(), summaryZh: match[2].trim() } : { paperId: "", summaryZh: line };
	});
}

const PUBLISHER_RULES = [
	{ id: "nature", name: "Nature Portfolio", doi: /^10\.1038\//i, directSi: true },
	{ id: "springer", name: "SpringerLink", doi: /^10\.1007\//i, directSi: true },
	{ id: "science", name: "Science/AAAS", doi: /^10\.1126\//i, directSi: false },
	{ id: "elsevier", name: "Elsevier", doi: /^10\.1016\//i, directSi: false },
	{ id: "acs", name: "ACS", doi: /^10\.1021\//i, directSi: false },
	{ id: "rsc", name: "Royal Society of Chemistry", doi: /^10\.1039\//i, directSi: false },
	{ id: "ieee", name: "IEEE Xplore", doi: /^10\.1109\//i, directSi: false },
	{ id: "wiley", name: "Wiley Online Library", doi: /^10\.(?:1002|1111)\//i, directSi: false, paused: true }
];

function publisherRuleForBundle(bundle) {
	const doi = String(bundle?.doi || "").trim();
	return PUBLISHER_RULES.find((rule) => rule.doi.test(doi));
}

function registerBrowserTools(ctx) {
	const executePublisherDownload = async (args, exec, { natureOnly = false } = {}) => {
		try {
			if (!ctx.labCapture) return { ok: false, error: "当前运行环境未启用软件内文献捕获服务" };
			const resolved = resolveProjectId(ctx, args, exec);
			if (resolved.error) return { ok: false, error: resolved.error };
			const bundle = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getBundle(args.bundleId);
			if (!bundle || bundle.projectId !== resolved.projectId) return { ok: false, error: "未找到当前课题中的文献条目" };
			const publisher = publisherRuleForBundle(bundle);
			if (!publisher || (natureOnly && publisher.id !== "nature")) {
				return { ok: false, error: natureOnly ? "该工具仅支持 DOI 以 10.1038/ 开头的 Nature 文献" : "该 DOI 尚未配置出版社浏览器自动化规则" };
			}
			if (!["pdf", "si"].includes(args.kind)) return { ok: false, error: "kind 必须是 pdf 或 si" };
			const requiresVpn = args.kind === "pdf" || !publisher.directSi;
			const webvpn = ctx.labCapture.getDesktopWebVpnStatus();
			const nativeDesktop = ctx.get?.("ibmScientificDesktop")?.status().available;
			if (publisher.paused && !webvpn.iwanReady) return { ok: false, error: "Wiley Online Library 需要 iWAN 全部路由模式；当前 WebVPN 路径暂停使用" };
			if (requiresVpn && !webvpn.iwanReady && !nativeDesktop) {
				if (!webvpn.ready && !args.loginConfirmed) {
					ctx.labCapture.requestDesktopWebVpnLogin(resolved.projectId);
					return {
						ok: true, bundleId: bundle.id, kind: args.kind, publisher: publisher.name,
						status: "webvpn-login-required", code: "webvpn-login-required", taskCreated: false, requiresUserAction: true,
						question: `已在右侧打开 WebVPN。请完成登录；登录成功后选择或回复“我已登录”，我再继续访问 ${publisher.name} 并下载${args.kind === "pdf" ? "正文" : "补充材料"}。`
					};
				}
				if (!webvpn.ready && args.loginConfirmed && (webvpn.stale || !webvpn.windowOpen || webvpn.state !== "waiting-login")) {
					ctx.labCapture.requestDesktopWebVpnLogin(resolved.projectId);
					return { ok: true, bundleId: bundle.id, kind: args.kind, publisher: publisher.name, status: "webvpn-login-required", code: "webvpn-login-required", taskCreated: false, requiresUserAction: true, question: "WebVPN 窗口尚未就绪，已重新在右侧打开。请完成登录后再选择“我已登录”。" };
				}
			}
			// R3：条目已归档同类型文件时**不建任务**，先把选择权交给用户。
			// 覆盖是破坏性动作，不能因为"AI 想再抓一次"就静默发生。
			const slot = archiveSlotOf(bundle, args.kind);
			if (slot && existsSync(slot.path)) {
				let size;
				try { size = statSync(slot.path).size; } catch { size = undefined; }
				const conflict = { ...slot, size };
				ctx.labCapture.noteArchiveConflict(resolved.projectId, { bundleId: bundle.id, ...conflict });
				const label = args.kind === "si" ? "补充材料" : "正文";
				return {
					ok: true, bundleId: bundle.id, kind: args.kind, publisher: publisher.name,
					status: "already-archived", code: "already-archived", taskCreated: false,
					requiresUserAction: true, archiveConflict: conflict,
					question: `该条目已归档${label}「${conflict.fileName}」${size ? `（${Math.round(size / 1024)} KB）` : ""}。本版不会覆盖；请保留原文件，或在后续分件管理功能中由用户处理旧文件。`
				};
			}
			const task = await ctx.labCapture.createAgentCaptureTask({
				projectId: resolved.projectId,
				bundleId: bundle.id,
				kind: args.kind,
				mode: "ai",
				...(requiresVpn && args.loginConfirmed === true ? { loginConfirmedByUser: true } : {})
			});
			return { ok: true, taskId: task.id, bundleId: bundle.id, kind: task.kind, publisher: publisher.name, status: "queued", code: "task-created", taskCreated: true, accessMode: nativeDesktop ? "scientific-browser" : webvpn.iwanReady ? "iwan" : requiresVpn ? "webvpn" : "direct" };
		} catch (error) {
			return { ok: false, error: error.message };
		}
	};

	const publisherDownloadOutput = {
		schema: {
			type: "object", additionalProperties: false,
			properties: {
				ok: { type: "boolean", required: true }, error: { type: "string" }, taskId: { type: "string" },
				bundleId: { type: "string" }, kind: { type: "string" }, publisher: { type: "string" }, status: { type: "string" }, code: { type: "string" }, taskCreated: { type: "boolean" }, accessMode: { type: "string" },
				requiresUserAction: { type: "boolean" }, question: { type: "string" },
				// R3：归档冲突的现场信息（条目已有同类型文件时给出）。
				archiveConflict: { type: "object", additionalProperties: true }
			}
		},
		render(args, value) {
			if (!value.ok) return [{ type: "text", text: `出版社浏览器下载未启动：${value.error ?? "未知错误"}` }];
			if (value.requiresUserAction) return [{ type: "text", text: `尚未创建下载任务（code=${value.code || value.status}，taskCreated=false）。${value.question}` }];
			return [{ type: "text", text: `已在软件内浏览器中创建 ${value.publisher || "出版社"} ${value.kind === "pdf" ? "正文" : "补充材料"}下载任务（${value.accessMode === "scientific-browser" ? "科研浏览器" : value.accessMode === "iwan" ? "iWAN 直访" : value.accessMode === "webvpn" ? "WebVPN" : "公开直连"}）。请用浏览器观察和点击工具推进；如页面要求机构登录或验证码，请由用户完成。taskId: ${value.taskId}` }];
		}
	};

	ctx.tools.register(defineTool({
		name: "lab_publisher_browser_download",
		description: "在软件内浏览器中创建已登记论文的下载任务，由 Agent 通过 lab_browser_observe/click/wait 操作页面。iWAN 全部路由可用时直接访问出版社，否则按规则使用 WebVPN；支持 Nature Portfolio、SpringerLink、Science/AAAS、Elsevier、ACS、RSC、IEEE，以及仅在 iWAN 下启用的 Wiley。可处理正文 PDF 预览器二次保存以及 PDF/DOCX/ZIP 补充材料。任务创建后用 lab_publisher_browser_download_status 查询进度。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号" },
			bundleId: { type: "string", required: true, description: "文献资料中的 bundleId" },
			kind: { type: "string", required: true, enum: ["pdf", "si"], description: "pdf 下载正文；si 下载补充材料" },
			loginConfirmed: { type: "boolean", description: "仅当用户明确回复“我已登录”后传 true" },
		},
		output: publisherDownloadOutput,
		timeoutMs: 15000,
		execute: (args, exec) => executePublisherDownload(args, exec)
	}));

	// AI 只负责把已有 Nature 条目排入桌面捕获队列；一次性下载令牌不返回给模型，
	// 由当前课题界面在本机一次性领取后交给受限 Tauri WebVPN 命令。
	ctx.tools.register(defineTool({
		name: "lab_nature_browser_download",
		description:
			"在 iBM Lab Agent 软件内浏览器中创建已登记 Nature 文献的下载任务，由 Agent 观察并点击 PDF 或 SI 入口。正文使用用户已手动建立的 WebVPN 会话；SI 可走公开直连。" +
			"仅适用于已有 bundleId 且 DOI 以 10.1038/ 开头的条目。正文会在排队前核验桌面 WebVPN 状态；未登录时拒绝排队并提示用户先登录。" +
			"工具不读取登录凭据、Cookie 或网页正文。任务创建后用 lab_nature_browser_download_status 查询进度。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按当前会话绑定或工作目录反查" },
			bundleId: { type: "string", required: true, description: "文献资料中的 bundleId" },
			kind: { type: "string", required: true, enum: ["pdf", "si"], description: "pdf 下载正文；si 下载补充材料或补充方法" },
			loginConfirmed: { type: "boolean", description: "仅当用户在 WebVPN 完成登录并明确选择/回复“我已登录”后传 true；首次调用不要传" },
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					taskId: { type: "string" },
					bundleId: { type: "string" },
					kind: { type: "string" },
					publisher: { type: "string" },
					status: { type: "string" },
					code: { type: "string" },
					taskCreated: { type: "boolean" },
					accessMode: { type: "string" },
					requiresUserAction: { type: "boolean" },
					question: { type: "string" },
					archiveConflict: { type: "object", additionalProperties: true }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `Nature 浏览器下载未启动：${value.error ?? "未知错误"}` }];
				if (value.requiresUserAction) return [{ type: "text", text: `尚未创建下载任务（code=${value.code || value.status}，taskCreated=false）。${value.question}` }];
				return [{ type: "text", text: `已在软件内浏览器中创建 ${value.kind === "pdf" ? "正文 PDF" : "补充材料"}下载任务。请用浏览器观察和点击工具推进。taskId: ${value.taskId}` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			return executePublisherDownload(args, exec, { natureOnly: true });
		}
	}));

	const browserOperationOutput = {
		schema: {
			type: "object", additionalProperties: false,
			properties: {
				ok: { type: "boolean", required: true },
				error: { type: "string" },
				operationId: { type: "string" },
				status: { type: "string" },
				result: { type: "object", additionalProperties: true }
			}
		},
		render(args, value) {
			return [{ type: "text", text: value.ok
				? JSON.stringify({ operationId: value.operationId, status: value.status, result: value.result, error: value.error })
				: "文献浏览器操作失败：" + value.error }];
		}
	};
	const enqueueBrowserOperation = (action) => (args, exec) => {
		try {
			if (!ctx.labCapture) throw new Error("文献捕获服务不可用");
			const resolved = resolveProjectId(ctx, args, exec);
			if (resolved.error) throw new Error(resolved.error);
			const operation = ctx.labCapture.createBrowserOperation({
				projectId: resolved.projectId, taskId: args.taskId, action,
				observationId: args.observationId, elementId: args.elementId, scope: args.scope,
				routeId: args.routeId, expectedPageSeq: args.expectedPageSeq
			});
			const desktop=ctx.get?.("ibmScientificDesktop");
			if(desktop?.status().available)ctx.get("ibmRuntime").track(()=>desktop.executeBrowserOperation({...operation,projectId:resolved.projectId}));
			// 同样要过 cleanJson：status 缺失时也必须是 lossless JSON。
			return cleanJson({ ok: true, operationId: operation.id, status: operation.status });
		} catch (error) { return { ok: false, error: error.message }; }
	};
	for (const [name, action, description, parameters] of [
		["lab_browser_debug", "debug", "读取当前文献浏览器的只读调试快照：页面响应状态、最近事件，以及 WebView2 CDP Target 清单。用于区分 HTML 验证页、PDF 文档和独立查看器目标；不返回 Cookie、原始请求 URL 或响应体。返回 operationId 后查询 lab_browser_operation_status。", {
			taskId: { type: "string", required: true }, projectId: { type: "string" }
		}],
		["lab_browser_observe", "observe", "观察当前文献 WebView2 页面：scope=all 返回按下载相关性与当前视口排序的前 30 个可交互候选，scope=download 只返回下载相关入口；结果另含 candidateCount/truncated。autoDownloadable 只是入口提示，点击后仍须核对捕获状态。返回 operationId 后查询 lab_browser_operation_status。", {
			taskId: { type: "string", required: true }, projectId: { type: "string" },
			scope: { type: "string", enum: ["all", "download"], description: "all（AI 主导推荐）：整页可交互元素；download（默认）：只看下载入口" }
		}],
		["lab_browser_click", "click", "点击上次页面观察返回的短期元素引用；点击不等于下载成功。", {
			taskId: { type: "string", required: true }, projectId: { type: "string" },
			observationId: { type: "string", required: true }, elementId: { type: "string", required: true }
		}],
		["lab_browser_navigate", "navigate", "执行状态工具提供的本篇论文备用入口。只接受 routeId 和当前 pageSeq；导航成功不代表下载成功，随后调用 lab_browser_wait。", {
			taskId: { type: "string", required: true }, projectId: { type: "string" },
			routeId: { type: "string", required: true }, expectedPageSeq: { type: "number", required: true }
		}],
		["lab_browser_download_viewer_pdf", "viewer-download", "当前顶层文档确认为原生 PDF 时，让 WebView2 原生另存为当前文档并自动归档。返回 operationId 后用 lab_browser_operation_status 和 lab_publisher_browser_download_status 查看任务文件实际写入字节、归档终态；出版社 HTML 预览页请改用 lab_browser_observe/click 点击其 Download PDF 元素。", {
			taskId: { type: "string", required: true }, projectId: { type: "string" }
		}]
	]) {
		ctx.tools.register(defineTool({
			name, description, parameters, output: browserOperationOutput,
			timeoutMs: 5000,
			execute: enqueueBrowserOperation(action)
		}));
	}
	ctx.tools.register(defineTool({
		name: "lab_browser_operation_status",
		description: "查询页面观察、点击或原生 PDF 下载操作的结果；实际字节进度和最终归档仍查 lab_publisher_browser_download_status。waitMs>0 时在插件内等到操作到达终态再返回。",
		parameters: {
			projectId: { type: "string" },
			operationId: { type: "string", required: true },
			waitMs: { type: "number", description: "最长等待毫秒数（默认 0=立即返回；上限 90000）" }
		},
		output: browserOperationOutput,
		timeoutMs: 100_000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) throw new Error(resolved.error);
				const read = () => {
					const operation = ctx.labCapture?.getBrowserOperation(args.operationId, resolved.projectId);
					if (!operation) throw new Error("浏览器操作不存在或不属于当前课题");
					// 必须走 cleanJson：操作还没结束时 result/error 是 undefined，直接返回会让
					// 工具结果不是 lossless JSON（2026-09-25 实测报 "value is not lossless JSON"）。
					return cleanJson({
						ok: true, operationId: operation.id, status: operation.status,
						result: operation.result, error: operation.error
					});
				};
				const waitMs = Math.min(Math.max(Number(args.waitMs) || 0, 0), 90_000);
				const deadline = Date.now() + waitMs;
				for (;;) {
					const value = read();
					if (value.status === "completed" || value.status === "failed" || Date.now() >= deadline) return value;
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
			} catch (error) { return { ok: false, error: error.message }; }
		}
	}));

	const executePublisherDownloadStatus = async (args, exec) => {
		try {
			if (!ctx.labCapture) return { ok: false, error: "当前运行环境未启用软件内文献捕获服务" };
			const resolved = resolveProjectId(ctx, args, exec);
			if (resolved.error) return { ok: false, error: resolved.error };
			await ctx.labCapture.sweepExpired();
			const task = ctx.labCapture.getTask(args.taskId);
			if (!task || task.projectId !== resolved.projectId) return { ok: false, error: "当前课题中没有这个下载任务" };
			const desktop = ctx.labCapture.getDesktopWebVpnStatus();
			// 唯一真相（C6/C20）：工具、小球、提示条都读同一个推导结果；队列位次也由
			// 服务层统一决定（终态任务不再占位，B5），工具里不再自己算一遍 FIFO。
			let view;
			if (typeof ctx.labCapture.listTaskViews === "function") {
				const entry = ctx.labCapture.listTaskViews(resolved.projectId)
					.find((item) => item.task.id === task.id);
				view = entry?.view;
			}
			if (!view) {
				// 兼容没有 listTaskViews 的服务/测试桩：按老规则（armed 的 agent 任务
				// 按 createdAt 排序）算一次位次。正式服务总是走上面那条，位次规则只在
				// manual-capture.js 里写一份。
				const queued = typeof ctx.labCapture.listTasks === "function"
					? ctx.labCapture.listTasks(resolved.projectId)
						.filter((item) => item.requestedBy === "agent" && item.status === "armed")
						.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
					: [];
				const index = queued.findIndex((item) => item.id === task.id);
				const fallbackPosition = index >= 0 ? index + 1 : undefined;
				view = typeof ctx.labCapture.describeTask === "function"
					? ctx.labCapture.describeTask(task, fallbackPosition)
					: deriveCaptureView({ task, desktop, queuePosition: fallbackPosition });
			}
			const queuePosition = view.queuePosition;
			const phase = view.phase;
			const requiresUserAction = view.requiresUserAction;
			const nextAction = view.nextAction;
			const maxBytes = Number(desktop.maxCaptureBytes) || 0;
			const receivedBytes = Number(desktop.downloadedBytes) || Number(task.size) || 0;
			const archivedBundle = task.status === "completed" && typeof (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks)?.getBundle === "function"
				? (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getBundle(task.bundleId) : undefined;
			const archivePath = archivedBundle?.projectId === task.projectId
				? (task.kind === "pdf" ? archivedBundle.pdfPath : archivedBundle.siPath) : undefined;
			const sizeNote = maxBytes > 0 && receivedBytes > maxBytes
				? `；文件约 ${Math.round(receivedBytes / 1048576)} MB 已超过 ${Math.round(maxBytes / 1048576)} MB 捕获上限，上传会被拒（可用 lab_tasks_update_bundle_file 直接登记该文件）`
				: "";
			return cleanJson({
				ok: true,
				taskId: task.id,
				bundleId: task.bundleId,
				kind: task.kind,
				status: task.status,
				phase,
				message: `${view.message}${sizeNote}`,
				progress: view.progress,
				requiresUserAction,
				nextAction,
				reasonCode: view.reasonCode,
				access: view.access,
				archiveConflict: view.archiveConflict,
				ballState: view.ball?.state,
				question: view.question,
				alternateEntry: view.alternateEntry,
				alternateRouteId: view.alternateRouteId,
				page: view.page,
				pdf: view.pdf,
				payloadVerdict: view.payloadVerdict,
				viewerDownloadFailure: view.viewerDownloadFailure,
				stalled: view.ball?.stalled,
				downloadReady: view.nextAction === "download-viewer-pdf",
				payloadReady: Boolean(view.pdf?.ready),
				payloadComplete: Boolean(view.pdf?.complete),
				heartbeat: {
					stale: Boolean(desktop.stale),
					ageMs: desktop.ageMs,
					pendingTaskId: desktop.pendingTaskId,
					lastPendingTaskId: desktop.lastPendingTaskId,
					releaseReason: desktop.releaseReason
				},
				queuePosition,
				fileName: task.fileName,
				filePath: archivePath,
				fileSha256: task.fileSha256,
				size: task.size,
				downloadedBytes: task.status === "completed" ? task.size : view.progress.isActualDownload ? view.progress.receivedBytes : undefined,
				downloadEventBytes: desktop.pendingTaskId === task.id ? desktop.downloadEventBytes : undefined,
				downloadTotalBytes: desktop.pendingTaskId === task.id ? desktop.downloadTotalBytes : undefined,
				downloadElapsedMs: desktop.pendingTaskId === task.id ? desktop.downloadElapsedMs : undefined,
				updatedAt: task.updatedAt
			});
		} catch (error) {
			return { ok: false, error: error.message };
		}
	};
	const publisherStatusOutput = {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				ok: { type: "boolean", required: true },
				error: { type: "string" },
				taskId: { type: "string" },
				bundleId: { type: "string" },
				kind: { type: "string" },
				status: { type: "string" },
				phase: { type: "string" },
				message: { type: "string" },
				queuePosition: { type: "number" },
				fileName: { type: "string" },
				filePath: { type: "string" },
				fileSha256: { type: "string" },
				size: { type: "number" },
				downloadedBytes: { type: "number" },
				downloadEventBytes: { type: "number" },
				requiresUserAction: { type: "boolean" },
				nextAction: { type: "string" },
				reasonCode: { type: "string" },
				access: {type:'object',additionalProperties:true},
				question: { type: "string" },
				alternateEntry: { type: "string" },
				alternateRouteId: { type: "string" },
				downloadReady: { type: "boolean" },
				downloadTotalBytes: { type: "number" },
				downloadElapsedMs: { type: "number" },
				payloadReady: { type: "boolean" },
				payloadComplete: { type: "boolean" },
				payloadVerdict: { type: "string" },
				// R3/R10：归档冲突现场与小球展示态。
				archiveConflict: { type: "object", additionalProperties: true },
				ballState: { type: "string" },
				viewerDownloadFailure: { type: "object", additionalProperties: true, properties: {
					count: { type: "number" }, error: { type: "string" }, terminal: { type: "boolean" }
				} },
				stalled: { type: "boolean" },
				progress: {
					type: "object", additionalProperties: true,
					properties: {
						isActualDownload: { type: "boolean" }, note: { type: "string" },
						receivedBytes: { type: "number" },
						totalBytes: { type: "number" },
						percent: { type: "number" },
						speedBps: { type: "number" },
						etaSeconds: { type: "number" }
					}
				},
				page: {
					type: "object", additionalProperties: true,
					properties: {
						url: { type: "string" },
						documentType: { type: "string" },
						httpStatus: { type: "number" },
						readyState: { type: "string" },
						pageSeq: { type: "number" },
						contentLength: { type: "number" }
					}
				},
				pdf: {
					type: "object", additionalProperties: true,
					properties: {
						ready: { type: "boolean" },
						complete: { type: "boolean" },
						contentLength: { type: "number" },
						receivedBytes: { type: "number" },
						error: { type: "string" }
					}
				},
				heartbeat: {
					type: "object", additionalProperties: true,
					properties: {
						stale: { type: "boolean" },
						ageMs: { type: "number" },
						pendingTaskId: { type: "string" },
						lastPendingTaskId: { type: "string" },
						releaseReason: { type: "string" }
					}
				},
				updatedAt: { type: "string" }
			}
		},
		render(args, value) {
			return [{ type: "text", text: value.ok
				? JSON.stringify({ taskId: value.taskId, status: value.status, phase: value.phase,
					message: value.message, nextAction: value.nextAction, queuePosition: value.queuePosition,
					downloadedBytes: value.downloadedBytes, requiresUserAction: value.requiresUserAction,
					question: value.question, fileName: value.fileName, filePath: value.filePath,
					fileSha256: value.fileSha256, size: value.size,
					// 页面级事实（C2）与备用入口（C8）必须进模型上下文，否则 AI 还是只能猜
					page: value.page, downloadReady: value.downloadReady,
					payloadReady: value.payloadReady, payloadComplete: value.payloadComplete,
					payloadVerdict: value.payloadVerdict, viewerDownloadFailure: value.viewerDownloadFailure,
					reasonCode: value.reasonCode, archiveConflict: value.archiveConflict,
					ballState: value.ballState, stalled: value.stalled,
					progress: value.progress, downloadEventBytes: value.downloadEventBytes,
					downloadTotalBytes: value.downloadTotalBytes, downloadElapsedMs: value.downloadElapsedMs,
					alternateEntry: value.alternateEntry })
				: "出版社下载状态查询失败：" + (value.error ?? "未知错误") }];
		}
	};
	const publisherStatusParameters = {
		projectId: { type: "string", description: "可选：课题编号；缺省按当前会话绑定或工作目录反查" },
		taskId: { type: "string", required: true, description: "下载工具返回的 taskId" }
	};

	ctx.tools.register(defineTool({
		name: "lab_publisher_browser_download_status",
		description: "查询 lab_publisher_browser_download 返回的任务状态和下载字节数。",
		parameters: publisherStatusParameters,
		output: publisherStatusOutput,
		timeoutMs: 5000,
		execute: executePublisherDownloadStatus
	}));

	// C10/R1.2：任务可枚举。没有这个工具时，AI 只能记住自己创建的 taskId，
	// 一旦对话被压缩或重启就再也找不到「哪些任务还在跑、哪些已经死了」。
	ctx.tools.register(defineTool({
		name: "lab_publisher_browser_capture_list",
		description: "列出当前课题的全部文献捕获任务（id/状态/阶段/排队位次/是否需要你介入）。用于盘点任务、找回丢失的 taskId、确认队列里还有谁。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按当前会话绑定或工作目录反查" }
		},
		output: {
			schema: {
				type: "object", additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					projectId: { type: "string" },
					tasks: {
						type: "array",
						items: {
							type: "object", additionalProperties: true,
							properties: {
								taskId: { type: "string" },
								bundleId: { type: "string" },
								kind: { type: "string" },
								status: { type: "string" },
								phase: { type: "string" },
								queuePosition: { type: "number" },
								requiresUserAction: { type: "boolean" },
								nextAction: { type: "string" },
								message: { type: "string" },
								fileName: { type: "string" },
								createdAt: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `文献捕获任务列表查询失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: JSON.stringify({
					projectId: value.projectId,
					activeCount: (value.tasks ?? []).filter((item) => item.status === "armed").length,
					tasks: value.tasks
				}) }];
			}
		},
		timeoutMs: 5000,
		async execute(args, exec) {
			try {
				if (!ctx.labCapture) return { ok: false, error: "当前运行环境未启用软件内文献捕获服务" };
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				await ctx.labCapture.sweepExpired();
				const rows = typeof ctx.labCapture.listTaskViews === "function"
					? ctx.labCapture.listTaskViews(resolved.projectId)
					: ctx.labCapture.listTasks(resolved.projectId).map((task) => ({ task, view: deriveCaptureView({ task, desktop: ctx.labCapture.getDesktopWebVpnStatus() }) }));
				return cleanJson({
					ok: true,
					projectId: resolved.projectId,
					tasks: rows.map(({ task, view }) => ({
						taskId: task.id,
						bundleId: task.bundleId,
						kind: task.kind,
						status: task.status,
						phase: view.phase,
						queuePosition: view.queuePosition,
						requiresUserAction: view.requiresUserAction,
						nextAction: view.nextAction,
						message: view.message,
						fileName: task.fileName,
						createdAt: task.createdAt
					}))
				});
			} catch (error) { return { ok: false, error: error.message }; }
		}
	}));

	/**
	 * 等状态变化，而不是让调用方空转轮询。
	 *
	 * 点击入口之后页面要加载、下载要开始、任务要归档 —— 每一步都要"等"。旧做法是
	 * 反复调 lab_publisher_browser_download_status（每次一个工具往返 + 客户端 1.8 秒
	 * 轮询节拍），既慢又占上下文。这里在插件内等，状态一变就返回最新快照。
	 */
	ctx.tools.register(defineTool({
		name: "lab_browser_wait",
		description: "等文献浏览器状态发生变化（阶段 / 页面 / 已下载字节 / 任务结束）或超时，然后返回最新状态。点击入口后用它等待页面响应，不要反复轮询下载状态。",
		parameters: {
			projectId: { type: "string" },
			taskId: { type: "string", required: true, description: "下载工具返回的 taskId" },
			timeoutMs: { type: "number", description: "最长等待毫秒数，默认 8000，上限 20000" }
		},
		output: publisherStatusOutput,
		timeoutMs: 25_000,
		execute: async (args, exec) => {
			// C9：指纹必须含页面维度。旧指纹只有 [phase,status,downloadedBytes,updatedAt]，
			// 页面导航时这些一项都不变，于是「页面已经跳到 /doi/epdf」也被报成
			// 「20 秒内没有变化」，AI 只能空等。
			const fingerprint = (value) => [
				value?.phase, value?.status, value?.nextAction, value?.downloadedBytes, value?.updatedAt,
				value?.page?.url, value?.page?.documentType, value?.page?.readyState,
				value?.page?.pageSeq, value?.downloadReady, value?.stalled,
				value?.viewerDownloadFailure?.count, value?.payloadVerdict,
				value?.access?.state,
				// D7：载荷完整性也必须进指纹。少了这两项，"下载完成"那个瞬间如果不
				// 同时改变 phase/status/downloadedBytes，wait 就不会因它而返回。
				value?.pdf?.complete, value?.pdf?.contentLength, value?.progress?.receivedBytes
			].map((item) => String(item ?? "")).join("|");
			const started = Date.now();
			const before = await executePublisherDownloadStatus(args, exec);
			if (!before?.ok) return before;
			// 已经是终态就没必要再等：R3.3 要的正是「不要再等一个已经死掉的任务」。
			if (before.requiresUserAction || before.nextAction === "done") return before;
			const initial = fingerprint(before);
			const limit = Math.min(Math.max(Number(args.timeoutMs) || 8000, 500), 20000);
			while (Date.now() - started < limit) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				const now = await executePublisherDownloadStatus(args, exec);
				if (!now?.ok || fingerprint(now) !== initial) return now;
			}
			const latest = await executePublisherDownloadStatus(args, exec);
			return { ...latest, message: `${latest.message ?? ""}（${Math.round((Date.now() - started) / 1000)} 秒内没有变化）` };
		}
	}));


	ctx.tools.register(defineTool({
		name: "lab_nature_browser_download_status",
		description: "兼容旧版 Nature 流程：查询下载 taskId 的状态。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按当前会话绑定或工作目录反查" },
			taskId: { type: "string", required: true, description: "下载工具返回的 taskId" }
		},
		output: publisherStatusOutput,
		timeoutMs: 5000,
		execute: executePublisherDownloadStatus
	}));

	ctx.tools.register(defineTool({
		name: "lab_publisher_browser_download_cancel",
		description: "在用户明确确认终止后，停止一个出版社浏览器文献获取任务；也可清理已经失败或过期的任务。传 recreate=true 则终止后用同一篇文献立刻重建获取任务（用户已授权时不必再确认）。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按当前会话绑定或工作目录反查" },
			taskId: { type: "string", required: true, description: "下载工具返回的 taskId" },
			reason: { type: "string", description: "终止原因" },
			recreate: { type: "boolean", description: "终止后立刻用同一篇文献重建获取任务（默认 false）" }
		},
		output: {
			schema: {
				type: "object", additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					taskId: { type: "string" },
					status: { type: "string" },
					recreatedTaskId: { type: "string" },
					recreatedStatus: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `停止文献获取失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: value.recreatedTaskId
					? `文献获取任务 ${value.taskId} 已终止；已用同一篇文献重建为 ${value.recreatedTaskId}（status=${value.recreatedStatus}）。请用新 taskId 继续。`
					: `文献获取任务 ${value.taskId} 已终止。` }];
			}
		},
		timeoutMs: 5000,
		async execute(args, exec) {
			try {
				if (!ctx.labCapture) return { ok: false, error: "当前运行环境未启用软件内文献捕获服务" };
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const task = ctx.labCapture.getTask(args.taskId);
				if (!task || task.projectId !== resolved.projectId) return { ok: false, error: "当前课题中没有这个下载任务" };
				if (args.recreate) {
					// C11/R1.4：重建 = 作废旧任务 + 同 bundleId/kind 建新任务。
					const rebuilt = await ctx.labCapture.recreateTask(task.id, args.reason || "用户确认由 Agent 重建文献获取");
					return cleanJson({
						ok: true,
						taskId: task.id,
						status: "cancelled",
						recreatedTaskId: rebuilt.task.id,
						recreatedStatus: rebuilt.task.status
					});
				}
				const cancelled = await ctx.labCapture.cancelTask(task.id, args.reason || "用户确认由 Agent 终止文献获取");
				return cleanJson({ ok: true, taskId: cancelled.id, status: cancelled.status });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

}

export function apply(ctx) {
	// Capture is optional: the child fiber owns only browser/capture tools.
	if (typeof ctx.inject === "function") ctx.inject(["labCapture"], registerBrowserTools);
	else registerBrowserTools(ctx);
	// 文献检索登记：执行多源 OA 检索并把结果登记到课题
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_search",
		description:
			"把当前会话的文献检索登记到课题；同一会话的多轮查询自动合并为一个条目和一个 RIS。" +
			"并行检索 OpenAlex、Crossref、PubMed、arXiv，统一字段、去重排序并保存结果。" +
			"用途：完成文献调研/检索后调用，让课题面板可见检索汇总。" +
			"确认单篇文献时（用户给出 DOI/PMID/arXiv 或精确题名）：把 query 直接写成该标识" +
			"（如 10.1021/ja409686x 或 https://doi.org/10.1021/ja409686x），系统走精确命中分支并" +
			"置顶返回该条（不受 OA 过滤）；不要用标题关键词检索后再从多条噪声里人工挑。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			entryTitle: { type: "string", required: true, description: "用一句简短中文概括当前会话累计检索主题，作为面板条目标题；不要直接复制检索式" },
			query: { type: "string", required: true, description: "检索式（英文为宜），如 prodrug polymer drug delivery" },
			limit: { type: "number", description: "返回条数（默认 10）" },
			sort: { type: "string", description: "排序（默认 relevance_score）" },
			yearFrom: { type: "number", description: "起始年份（可选）" },
			oaOnly: { type: "boolean", description: "主题检索是否只返回开放获取文献（默认 true；精确 DOI 查询仍显示关闭状态）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					status: { type: "string" },
					title: { type: "string" },
					count: { type: "number" },
					papers: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								paperId: { type: "string" },
								title: { type: "string" },
								abstract: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `检索登记失败：${value.error ?? "未知错误"}` }];
				const ids = (value.papers ?? []).map((paper) => `- ${paper.paperId} | ${paper.title}`).join("\n");
				return [{ type: "text", text: `已更新本会话检索「${value.title}」（${value.count} 条去重文献）。\nrunId: ${value.runId}${ids ? `\n待提炼论文（paperId 可直接使用）：\n${ids}\n请调用 lab_tasks_get_search_summary_inputs 读取摘要，再调用 lab_tasks_update_search_summaries。` : "\n摘要核心内容均已登记。"}` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const run = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).searchLiterature({
					projectId: resolved.projectId,
					title: args.entryTitle,
					query: args.query,
					limit: args.limit,
					sort: args.sort,
					yearFrom: args.yearFrom,
					oaOnly: args.oaOnly ?? true,
					sessionId: exec?.agent?.session?.id
				});
				const papers = (run.results ?? []).filter((paper) => paper.shortDescriptionZh === "摘要待提炼").map((paper) => ({
					paperId: summaryPaperId(paper),
					title: paper.title,
					abstract: String(paper.abstract || paper.title).slice(0, 1600)
				}));
				return { ok: true, runId: run.id, status: run.status, title: run.title, count: (run.results ?? []).length, papers };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_get_search_summary_inputs",
		description: "读取一次检索的 runId、公开 paperId、标题和摘要，供 Agent 生成九字内中文摘要概括。runId 可省略，默认读取当前会话最新检索。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			runId: { type: "string", description: "可选：检索 runId；缺省读取当前会话最新检索" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					papers: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								paperId: { type: "string" },
								title: { type: "string" },
								abstract: { type: "string" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `检索摘要输入读取失败：${value.error ?? "未知错误"}` }];
				const blocks = value.papers.map((paper, index) => `${index + 1}. paperId: ${paper.paperId}\n标题: ${paper.title}\n摘要: ${paper.abstract}`).join("\n\n");
				return [{ type: "text", text: `runId: ${value.runId}\n待提炼论文 ${value.papers.length} 篇：\n\n${blocks || "无待提炼论文"}` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const sessionId = exec?.agent?.session?.id;
				const candidates = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).listSearchRuns(resolved.projectId).filter((run) => !sessionId || run.sessionId === sessionId);
				const run = args.runId ? (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getSearchRun(args.runId) : candidates.at(-1);
				if (run === undefined || run.projectId !== resolved.projectId) return { ok: false, error: "未找到当前课题的检索条目" };
				const papers = (run.results ?? []).filter((paper) => paper.shortDescriptionZh === "摘要待提炼").map((paper) => ({
					paperId: summaryPaperId(paper), title: paper.title, abstract: String(paper.abstract || paper.title).slice(0, 1600)
				}));
				return { ok: true, runId: run.id, papers };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_update_search_summaries",
		description:
			"根据每篇论文的摘要或标题，为检索条目写入 2–9 个汉字的中文核心内容概括（拉丁字母、数字和标点不计入汉字数）。" +
			"概括必须说明论文实现、发现或解决了什么，例如“可降解无线传感”“提升肿瘤药物递送”；" +
			"禁止填写“相关研究”“传感器件”“研究方法”“相关综述”等文章类型。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			runId: { type: "string", required: true, description: "lab_tasks_register_search 返回的 runId" },
			summaries: {
				type: "array",
				description: "摘要数组；也可改用 summariesText 文本格式",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						paperId: { type: "string", description: "公开 paperId；接受原始 DOI、DOI URL、OpenAlex URL/W 号、PMID、arXiv ID、结果 id 或完整标题" },
						summaryZh: { type: "string", description: "根据摘要提炼的 2–9 个汉字中文核心内容（拉丁字母、数字和标点不计入），不得只是文章类型" },
						summary: { type: "string", description: "summaryZh 的兼容别名" }
					}
				}
			},
			summariesText: { type: "string", description: "可选简化格式：每行 paperId<TAB>summaryZh，也接受 paperId | summaryZh" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					updated: { type: "number" },
					unmatched: { type: "array", items: { type: "string" } },
					rejected: {
						type: "array",
						items: { type: "object", additionalProperties: false, properties: { paperId: { type: "string" }, reason: { type: "string" } } }
					},
					availablePaperIds: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `摘要概括登记失败：${value.error ?? "未知错误"}` }];
				const unmatched = value.unmatched?.length ? `\n未匹配 paperId：${value.unmatched.join("、")}` : "";
				const rejected = value.rejected?.length ? `\n未写入项：${value.rejected.map((item) => `${item.paperId || "(空)"}（${item.reason}）`).join("；")}` : "";
				const available = value.updated === 0 && value.availablePaperIds?.length ? `\n当前可用 paperId：${value.availablePaperIds.join("、")}` : "";
				return [{ type: "text", text: `已为 ${value.updated} 篇文献登记摘要核心内容。有效项会立即保存，不再因单条错误回滚整批。${unmatched}${rejected}${available}` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const run = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getSearchRun(args.runId);
				if (run === undefined || run.projectId !== resolved.projectId) return { ok: false, error: "检索条目不存在或不属于当前课题" };
				const summaries = [...(args.summaries ?? []), ...parseSummaryText(args.summariesText)];
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).updateSearchSummaries({ runId: args.runId, summaries });
				return { ok: true, updated: result.updated, unmatched: result.unmatched, rejected: result.rejected, availablePaperIds: result.availablePaperIds };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 微信公众号正文读取：仅允许 mp.weixin.qq.com/s，返回可见文字供 AI 提取。
	ctx.tools.register(defineTool({
		name: "lab_tasks_fetch_wechat_article",
		description:
			"读取用户明确提供的微信公众号正文链接，返回页面标题、公众号名称、公众号推送时间和可见正文，供 AI 提取论文元数据。" +
			"严格只接受 https://mp.weixin.qq.com/s...；不下载 PDF。公众号推送时间不是论文发表时间。",
		parameters: {
			sourceUrl: { type: "string", required: true, description: "用户粘贴的 https://mp.weixin.qq.com/s... 正文链接" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					sourceUrl: { type: "string" },
					pageTitle: { type: "string" },
					description: { type: "string" },
					accountName: { type: "string" },
					wechatPublishedAt: { type: "string" },
					content: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `微信公众号正文读取失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: [
					`来源链接：${value.sourceUrl}`,
					value.pageTitle ? `公众号文章标题：${value.pageTitle}` : null,
					value.accountName ? `公众号：${value.accountName}` : null,
					value.wechatPublishedAt ? `公众号推送时间（不是论文发表时间）：${value.wechatPublishedAt}` : null,
					value.description ? `页面描述：${value.description}` : null,
					"\n公众号正文可见内容：\n" + value.content,
					"\n请只提取正文明确展示的论文元数据；未知字段省略，不要把公众号推送时间当作论文发表时间。"
				].filter(Boolean).join("\n") }];
			}
		},
		timeoutMs: 35000,
		async execute(args) {
			try {
				return { ok: true, ...await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).fetchWechatArticle({ sourceUrl: args.sourceUrl }) };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 微信公众号 DOI 检索校验：把 AI 提取的论文元数据拿去 OpenAlex/Crossref 校验，
	// 返回带置信度的 DOI 候选，供登记时补全权威 DOI（公众号页面常不展示 DOI）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_resolve_wechat_doi",
		description:
			"把从微信公众号文章中提取的论文题名（可带作者/年份）提交 OpenAlex 与 Crossref 检索校验，返回带置信度分级的 DOI 候选。" +
			"用于公众号页面未展示 DOI 时补全权威 DOI；页面已明确展示 DOI 时跳过本步、直接登记。" +
			"候选按置信度（high/medium/low）与标题相似度排序，confidence=high 才可直接采用，medium 需谨慎，low 不建议采用。" +
			"检索不可用时调用方可降级为只登记页面字段（lab_tasks_register_wechat_paper 的 doi 缺省省略，禁止猜测）。" +
			"仅用于 https://mp.weixin.qq.com/s... 正文链接场景，配合 lab_tasks_fetch_wechat_article 使用。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查（仅供留痕，缺省不影响检索）" },
			title: { type: "string", required: true, description: "论文原始题名；只能填写公众号页面明确展示的题名" },
			authors: { type: "array", items: { type: "string" }, description: "作者列表，保持页面展示顺序；用于作者姓氏匹配校验" },
			journal: { type: "string", description: "期刊名；页面未展示时省略" },
			year: { type: "number", description: "四位发表年份；页面未展示时省略" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					title: { type: "string" },
					candidates: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								doi: { type: "string" },
								title: { type: "string" },
								authors: { type: "array", items: { type: "string" } },
								journal: { type: "string" },
								year: { type: "number" },
								volume: { type: "string" },
								issue: { type: "string" },
								pages: { type: "string" },
								publicationDate: { type: "string" },
								confidence: { type: "string" },
								titleScore: { type: "number" },
								matchedAuthors: { type: "array", items: { type: "string" } },
								yearMatch: { type: "number" }
							}
						}
					}
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `DOI 检索校验失败：${value.error ?? "未知错误"}` }];
				const lines = value.candidates.map((candidate, index) => {
					const reasons = [`标题相似度 ${candidate.titleScore}`];
					if (candidate.matchedAuthors?.length) reasons.push(`作者重合 ${candidate.matchedAuthors.join("、")}`);
					if (candidate.yearMatch === 0) reasons.push("年份吻合");
					else if (candidate.yearMatch === 1) reasons.push(`年份差 ${candidate.yearMatch}`);
					return `${index + 1}. [${candidate.confidence}] ${candidate.doi}\n   ${candidate.title}（${candidate.journal ?? "期刊未知"}${candidate.year ? `, ${candidate.year}` : ""}）\n   依据：${reasons.join("；")}`;
				});
				return [{ type: "text", text: `「${value.title}」检索到 ${value.candidates.length} 个 DOI 候选：\n\n${lines.join("\n")}\n\n请采用 confidence=high 的候选；medium 需再与用户确认；low 不建议采用。确定后调用 lab_tasks_register_wechat_paper 提交（doi 传选定的值）。` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).resolveWechatPaperDoi({
					projectId: resolved.error ? undefined : resolved.projectId,
					title: args.title,
					authors: args.authors,
					journal: args.journal,
					year: args.year
				});
				return cleanJson({ ok: true, title: result.title, candidates: result.candidates });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 微信公众号文献入口：AI 提取可核验元数据后先入精读队列，不下载 PDF。
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_wechat_paper",
		description:
			"把 AI 从微信公众号文章中提取的论文元数据提交到当前课题的「文献精读」板块。" +
			"只登记页面中可核验的字段，不下载 PDF；条目会显示为“待上传 PDF”，后续人工上传原文时复用返回的 bundleId。" +
			"仅用于 https://mp.weixin.qq.com/s... 正文链接。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			sourceUrl: { type: "string", required: true, description: "用户提供的微信公众号文章链接，必须以 https://mp.weixin.qq.com/s 开头" },
			title: { type: "string", required: true, description: "论文原始题名；只能填写公众号页面明确展示的题名" },
			authors: { type: "array", items: { type: "string" }, description: "作者列表，保持页面展示顺序" },
			doi: { type: "string", description: "论文 DOI；页面未展示时省略，禁止猜测" },
			journal: { type: "string", description: "期刊名；页面未展示时省略" },
			year: { type: "number", description: "四位发表年份；页面未展示时省略" },
			publicationDate: { type: "string", description: "页面展示的发表日期" },
			volume: { type: "string", description: "卷号" },
			issue: { type: "string", description: "期号" },
			pages: { type: "string", description: "页码或文章号" },
			abstract: { type: "string", description: "论文摘要；仅在公众号页面明确提供时填写" },
			keywords: { type: "array", items: { type: "string" }, description: "关键词；仅在页面明确提供时填写" },
			shortCitation: { type: "string", description: "可选：期刊 卷, 页码 (年份).；元数据不完整时省略" },
			titleZh: { type: "string", description: "可选：页面明确给出的中文译题" },
			summary: { type: "string", description: "可选：根据公众号正文形成的简短内容说明；不要冒充全文精读结论" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本（默认 1）" },
			noteTemplateId: { type: "string", description: "可选：后续精读使用的阅读笔记模板" },
			...ENTRY_NAMING_PARAMETERS,
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" },
					created: { type: "boolean" },
					title: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `微信公众号文献登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `${value.created ? "已新建" : "已更新"}文献精读条目「${value.title}」，当前状态：待上传 PDF。\nbundleId: ${value.bundleId}\nreportId: ${value.reportId}\n无需下载 PDF；后续用户手工上传原文时，用 lab_tasks_register_bundle 传入此 bundleId，再继续全文精读。` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).registerWechatPaper({
					projectId: resolved.projectId,
					sourceUrl: args.sourceUrl,
					title: args.title,
					authors: args.authors,
					doi: args.doi,
					journal: args.journal,
					year: args.year,
					publicationDate: args.publicationDate,
					volume: args.volume,
					issue: args.issue,
					pages: args.pages,
					abstract: args.abstract,
					keywords: args.keywords,
					shortCitation: args.shortCitation,
					titleZh: args.titleZh,
					summary: args.summary,
					goalProfileId: args.goalProfileId,
					goalProfileVersion: args.goalProfileVersion,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion,
					naming: pickEntryNaming(args)
				});
				return { ok: true, bundleId: result.bundle.id, reportId: result.report.id, status: result.report.status, created: result.created, title: result.bundle.title };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 通用文献元数据入口（非公众号）：DOI/publisher 页面或用户给出的题名元数据
	// → 先入精读队列“待上传 PDF”，不下载 PDF；后续原文经 lab_tasks_register_bundle 补齐。
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_paper_meta",
		description:
			"把论文元数据（DOI/publisher 页面/用户提供的题名+作者等）提交到当前课题的「文献精读」板块，无需 PDF 或微信公众号链接。" +
			"条目会显示为“待上传 PDF”，后续用户上传原文时调用 lab_tasks_register_bundle 传回返回的 bundleId（或按 DOI/题名自动匹配）即可继续全文精读。" +
			"sourceType 取值：publisher（出版方/摘要页，默认）、doi（DOI 直达页）、wechat（公众号链接，必须传 mp.weixin.qq.com/s 的 sourceUrl）。" +
			"只登记可核验字段；title 必填，DOI 若给出必须合法；重复登记同一 DOI/链接会更新原条目（幂等）。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			sourceType: { type: "string", description: "可选：publisher（默认）| doi | wechat" },
			sourceUrl: { type: "string", description: "可选：来源页面 http(s) 链接；wechat 类型时必填且须为 https://mp.weixin.qq.com/s... " },
			title: { type: "string", required: true, description: "论文原始题名（必填）" },
			authors: { type: "array", items: { type: "string" }, description: "作者列表，保持页面展示顺序" },
			doi: { type: "string", description: "论文 DOI；未确认时省略，禁止猜测" },
			journal: { type: "string", description: "期刊名" },
			year: { type: "number", description: "四位发表年份" },
			publicationDate: { type: "string", description: "发表日期" },
			volume: { type: "string", description: "卷号" },
			issue: { type: "string", description: "期号" },
			pages: { type: "string", description: "页码或文章号" },
			abstract: { type: "string", description: "论文摘要" },
			keywords: { type: "array", items: { type: "string" }, description: "关键词" },
			shortCitation: { type: "string", description: "可选：期刊 卷, 页码 (年份).；元数据不完整时省略" },
			titleZh: { type: "string", description: "可选：中文译题" },
			summary: { type: "string", description: "可选：简短内容说明；不要冒充全文精读结论" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本（默认 1）" },
			noteTemplateId: { type: "string", description: "可选：后续精读使用的阅读笔记模板" },
			...ENTRY_NAMING_PARAMETERS,
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" },
					created: { type: "boolean" },
					title: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `文献登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `${value.created ? "已新建" : "已更新"}文献精读条目「${value.title}」（${args.sourceType ?? "publisher"} 元数据），当前状态：待上传 PDF。\nbundleId: ${value.bundleId}\nreportId: ${value.reportId}\n无需 PDF 即可登记；后续用户上传原文时，用 lab_tasks_register_bundle 传回此 bundleId，再继续全文精读。` }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).registerPaperMeta({
					projectId: resolved.projectId,
					sourceType: args.sourceType,
					sourceUrl: args.sourceUrl,
					title: args.title,
					authors: args.authors,
					doi: args.doi,
					journal: args.journal,
					year: args.year,
					publicationDate: args.publicationDate,
					volume: args.volume,
					issue: args.issue,
					pages: args.pages,
					abstract: args.abstract,
					keywords: args.keywords,
					shortCitation: args.shortCitation,
					titleZh: args.titleZh,
					summary: args.summary,
					goalProfileId: args.goalProfileId,
					goalProfileVersion: args.goalProfileVersion,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion,
					naming: pickEntryNaming(args)
				});
				return { ok: true, bundleId: result.bundle.id, reportId: result.report.id, status: result.report.status, created: result.created, title: result.bundle.title };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 原文整理登记：登记 PDF/source-map 的原文 bundle
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_bundle",
		description:
			"登记一篇论文原文到课题（写入课题面板「文献资料 → 文献原文整理」）。" +
			"输入 PDF 路径或 nature-reader 生成的 source-map JSON，登记后课题面板可见原文；" +
			"如果是此前由公众号元数据创建的待上传条目，请传回其 bundleId，系统会在原条目上补齐原文。" +
			"用途：精读/建卡前先登记原文。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", description: "可选：待补齐原文的既有 bundleId（公众号元数据登记工具返回）；缺省时按 DOI 或题名自动匹配" },
			pdfPath: { type: "string", description: "可选：PDF 绝对路径（与 sourceMapPath 二选一）" },
			sourceMapPath: { type: "string", description: "可选：nature-reader 的 source-map JSON 路径（与 pdfPath 二选一）" },
			doi: { type: "string", description: "可选：论文 DOI（如 10.1000/xyz.1）。填写后课题面板文献条目中的 PDF/SI 按钮会按 DOI 点亮为可下载" },
			siPath: { type: "string", description: "可选：SI（Supplementary Information 补充材料）文件绝对路径，随 PDF 一并登记；面板条目 SI 按钮据此点亮" },
			title: { type: "string", description: "可选：论文标题" },
			renderDir: { type: "string", description: "可选：页面渲染输出目录（PPT 配图用）" },
			...ENTRY_NAMING_PARAMETERS
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					status: { type: "string" },
					title: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `原文登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记原文（${value.bundleId}，${value.status}${value.title ? `：${value.title}` : ""}）。可在课题面板「文献资料 → 文献原文整理」查看。` }];
			}
		},
		timeoutMs: 180000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				if (!args.pdfPath && !args.sourceMapPath) return { ok: false, error: "pdfPath 与 sourceMapPath 至少提供一个" };
				const bundle = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).preparePaper({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					pdfPath: args.pdfPath,
					sourceMapPath: args.sourceMapPath,
					doi: args.doi,
					siPath: args.siPath,
					title: args.title,
					renderDir: args.renderDir,
					naming: pickEntryNaming(args)
				});
				return { ok: true, bundleId: bundle.id, status: bundle.status, title: bundle.title };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 精读前强制盘点：先看现有正文/SI，再按阅读笔记模板生成。
	ctx.tools.register(defineTool({
		name: "lab_tasks_get_reading_inputs",
		description:
			"生成任何文献精读报告前必须先调用。盘点该文献当前已有的正文 PDF、SI 和 source-map，并返回本次报告格式要求。" +
			"同时把模板的完整章节骨架与每节要点写入「精读生成契约」文件，返回 contractPath：必须用 read 读取该契约（较长时用 offset/limit 分段读完）后按契约生成。" +
			"必须逐个读取 available=true 的资源；PDF/Office 先用 lab_convert_document 转为 Markdown。" +
			"只要存在阅读笔记模板，就严格按模板章节生成；Nature paper-card 仅在没有可用模板时回退，不得覆盖模板。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", description: "文献 bundleId；与 reportId 至少提供一个" },
			reportId: { type: "string", description: "既有待精读 reportId；与 bundleId 至少提供一个" },
			noteTemplateId: { type: "string", description: "可选：本次准备采用的阅读笔记模板；缺省使用报告已快照模板或 note-default" },
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					reportId: { type: "string" },
					title: { type: "string" },
					entryStem: { type: "string" },
					entryDir: { type: "string" },
					namingJson: { type: "string" },
					missingNaming: { type: "array", items: { type: "string" } },
					formatSource: { type: "string" },
					templateId: { type: "string" },
					templateVersion: { type: "string" },
					templateName: { type: "string" },
					resourcesJson: { type: "string" },
					requirementsJson: { type: "string" },
					contractPath: { type: "string" },
					contractSha256: { type: "string" },
					contractCharacters: { type: "number" },
					templateSectionCount: { type: "number" },
					instructions: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `精读输入盘点失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: [
					`精读前资源盘点：${value.title || value.bundleId}`,
					`bundleId: ${value.bundleId}${value.reportId ? `\nreportId: ${value.reportId}` : ""}`,
					`条目命名：${value.entryStem || "（未固化）"}${value.entryDir ? "\n条目目录：" + value.entryDir : ""}`,
					value.missingNaming?.length
						? `命名还缺：${value.missingNaming.join("、")}——用 lab_tasks_set_entry_naming 补齐（期刊缩写/通讯作者/中文概括/题目前段）`
						: "命名各段已齐备。",
					`报告格式来源：${value.formatSource}${value.templateId ? `（${value.templateId}@${value.templateVersion} ${value.templateName || ""}）` : ""}`,
					`现有资源：\n${value.resourcesJson}`,
					`生成要求摘要：\n${value.requirementsJson}`,
					value.contractPath
						? `精读生成契约（先用 read 读取，按其中章节骨架与每节要点生成）：\n${value.contractPath}（${value.contractCharacters ?? "?"} 字符 / ${value.templateSectionCount ?? "?"} 节）`
						: "本次没有可用阅读笔记模板：按 Nature paper-card 结构生成（回退路径）。",
					`强制顺序：\n- ${value.instructions.join("\n- ")}`
				].join("\n\n") }];
			}
		},
		timeoutMs: 15000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const inputs = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).readingReportInputs({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					reportId: args.reportId,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion
				});
				// 契约落盘：完整章节骨架/每节要点写入条目目录，Agent 用 read 分块读取，
				// 不再把整篇模板塞进一次工具结果（避免 8192 字符结果裁剪导致要求漂移）。
				const contract = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).materializeReadingContract(inputs);
				const requirements = inputs.generationRequirements ?? {};
				const digest = {
					audience: requirements.audience,
					language: requirements.language,
					length: requirements.length,
					minContentChars: requirements.minContentChars,
					sections: (requirements.sections ?? []).map((section) => `${section.required === false ? "[可选] " : ""}${section.title}`),
					styleRules: requirements.styleRules,
					evidenceRequirements: requirements.evidenceRequirements,
					outputRequirements: requirements.outputRequirements
				};
				// 返回前过 cleanJson：去除 undefined 自有字段、归一 NaN/Infinity，
				// 保证跨 Typert/工具 JSON 边界无损（P0 修复 #2）。
				return cleanJson({
					ok: true,
					bundleId: inputs.bundleId,
					reportId: inputs.reportId,
					title: inputs.title,
					entryStem: inputs.entryStem,
					entryDir: inputs.entryDir,
					namingJson: inputs.naming ? JSON.stringify(inputs.naming) : undefined,
					missingNaming: inputs.missingNaming ?? [],
					formatSource: inputs.formatSource,
					templateId: inputs.templateId,
					templateVersion: inputs.templateVersion,
					templateName: inputs.templateName,
					resourcesJson: JSON.stringify(inputs.resources, null, 2),
					requirementsJson: JSON.stringify(digest, null, 2),
					contractPath: contract?.contractPath,
					contractSha256: contract?.sha256,
					contractCharacters: contract?.characters,
					templateSectionCount: contract?.sectionCount,
					instructions: contract
						? [...inputs.instructions, `先用 read 读取精读生成契约 ${contract.contractPath}，严格按其章节骨架与每节要点生成；契约较长时用 offset/limit 分段读完。`]
						: inputs.instructions
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 精读报告登记：创建 + 完成（兼容字段仍名为 paperCardPath，内容模板优先）
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_report",
		description:
			"登记一份文献精读报告到课题文献条目并自动暂存实际 DOCX。" +
			"调用前必须先用 lab_tasks_get_reading_inputs 盘点并读取正文/SI；基于全部已有资源登记阅读笔记 Markdown。" +
			"报告优先采用阅读笔记模板，只有没有可用模板时才使用 Nature paper-card。" +
			"如已生成 DOCX 可同时传入，否则系统生成并固化一次。" +
			"登记后立即进入右侧分页预览与人工审阅；自动自查只提供提醒，不是门禁。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", description: "已登记的原文 bundleId（lab_tasks_register_bundle 返回）；与 reportId 至少提供一个" },
			reportId: { type: "string", description: "可选：复用既有待精读条目（公众号元数据登记工具返回），避免重复创建" },
			paperCardPath: { type: "string", description: "可选：按阅读笔记模板生成的精读报告 Markdown 绝对路径；仅无可用模板时可传 nature-paper-card 产物" },
			docxPath: { type: "string", description: "可选：已生成的实际 .docx 绝对路径；缺省由 Markdown 生成并暂存" },
			goalProfileId: { type: "string", description: "可选：精读目标 profile（默认 default-prodrug-polymer）" },
			goalProfileVersion: { type: "string", description: "可选：目标版本" },
			noteTemplateId: { type: "string", description: "可选：阅读笔记模板（默认 note-default，可在「模板管理」查看/新建）" },
			noteTemplateVersion: { type: "string", description: "可选：阅读笔记模板版本" },
			shortCitation: { type: "string", description: "可选：文献短引用；必须使用“期刊 卷, 页码 (年份).”格式，不含作者和题名，例如 Nature 630, 84–90 (2024)." },
			titleZh: { type: "string", description: "可选：中文标题（面板条目标题悬浮提示）" },
			summary: { type: "string", description: "可选：约200字概览卡片正文；缺省自动从 paper card 推导" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					reportId: { type: "string" },
					status: { type: "string" },
					shortCitation: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `精读登记失败：${value.error ?? "未知错误"}` }];
				if (value.status === "pending") return [{ type: "text", text: `已登记待精读条目（${value.reportId}${value.shortCitation ? `：${value.shortCitation}` : ""}），等待 PDF/原文与精读报告。` }];
				return [{ type: "text", text: `已暂存精读报告（${value.reportId}，${value.status}${value.shortCitation ? `：${value.shortCitation}` : ""}）。请在课题面板「文献资料」条目点击“预览报告”，逐页检查后在右侧预览页人工审核。审核通过前不会开放 DOCX 下载。` }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				let report;
				if (args.reportId) {
					report = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getReadingReport(args.reportId);
					if (report === undefined || report.projectId !== resolved.projectId) return { ok: false, error: "精读条目不存在或不属于当前课题" };
					if (args.bundleId && report.bundleId !== args.bundleId) return { ok: false, error: "reportId 与 bundleId 不属于同一文献" };
				} else {
					if (!args.bundleId) return { ok: false, error: "bundleId 与 reportId 至少提供一个" };
					report = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).listReadingReports(resolved.projectId).find((row) => row.bundleId === args.bundleId && !row.paperCardPath);
					if (report === undefined) report = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).createReadingReport({
						projectId: resolved.projectId,
						bundleId: args.bundleId,
						goalProfileId: args.goalProfileId ?? "default-prodrug-polymer",
						goalProfileVersion: args.goalProfileVersion ?? "1",
						noteTemplateId: args.noteTemplateId,
						noteTemplateVersion: args.noteTemplateVersion,
						shortCitation: args.shortCitation,
						titleZh: args.titleZh,
						summary: args.summary
					});
				}
				if (args.noteTemplateId || args.noteTemplateVersion) report = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).selectReadingReportTemplate({
					reportId: report.id,
					noteTemplateId: args.noteTemplateId,
					noteTemplateVersion: args.noteTemplateVersion
				});
				if (args.paperCardPath) {
					const bundle = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getBundle(report.bundleId);
					const done = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).completeReadingReport({
						reportId: report.id,
						paperCardPath: args.paperCardPath,
						docxPath: args.docxPath,
						locatorMode: bundle?.locatorMode ?? report.locatorMode,
						shortCitation: args.shortCitation,
						titleZh: args.titleZh,
						summary: args.summary
					});
					return { ok: true, reportId: done.id, status: done.status, shortCitation: done.shortCitation };
				}
				return { ok: true, reportId: report.id, status: report.status, shortCitation: report.shortCitation };
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// PPT 登记：创建 + 完成（pptx 路径）
	ctx.tools.register(defineTool({
		name: "lab_tasks_register_presentation",
		description:
			"登记一份文献汇报 PPT 到课题文献条目。" +
			"**前置依赖：必须先有已暂存的精读报告。** 公众号/题录元数据登记不会自动生成精读报告，" +
			"所以正常顺序是「登记原文 → 登记精读报告（lab_tasks_register_report，它返回 reportId）→ 本次登记 PPT」。" +
			"reportId 指向的报告若还没 stage，本工具会报 has no staged report artifact yet 并给出下一步。" +
			"基于已有暂存报告创建 PPT run，不要求先通过报告审核；模板只作格式参考。" +
			"实际 PPTX 登记后立即进入右侧分页预览与人工审阅；自动版面自查只提供提醒。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			reportId: { type: "string", required: true, description: "已登记的精读报告 reportId（lab_tasks_register_report 返回）" },
			pptxPath: { type: "string", description: "可选：生成的 .pptx 绝对路径（完成后）" },
			outlinePath: { type: "string", description: "可选：大纲 .md 路径" },
			speechNotesPath: { type: "string", description: "可选：讲稿 .md 路径" },
			templateId: { type: "string", description: "可选：PPT 模板（缺省用课题创建时选定的模板，其次 nature-default）" },
			templateVersion: { type: "string", description: "可选：模板版本" },
			conformancePath: { type: "string", description: "可选：lab_ppt_build_from_template 产出的模板符合性报告 .json 路径" },
			skipAudit: { type: "boolean", description: "历史兼容字段：仅记录请求；自查始终为非阻断提醒，人工审核不可跳过" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					status: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `PPT 登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已暂存文献 PPT（${value.runId}，${value.status}）。请在课题面板条目点击“预览PPT”，逐页检查后在右侧预览页人工审核。审核通过前不会开放 PPTX 下载。` }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const projectTemplate = (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).getProject(resolved.projectId)?.template;
				const templateId = args.templateId ?? projectTemplate?.id ?? "nature-default";
				const templateVersion = args.templateVersion
					?? (templateId === projectTemplate?.id ? projectTemplate?.version : undefined)
					?? "1";
				const run = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).createPresentation({
					projectId: resolved.projectId,
					reportId: args.reportId,
					templateId,
					templateVersion,
					skipAudit: args.skipAudit === true
				});
				if (args.pptxPath) {
					const done = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).completePresentation({
						runId: run.id,
						pptxPath: args.pptxPath,
						outlinePath: args.outlinePath,
						speechNotesPath: args.speechNotesPath,
						conformancePath: args.conformancePath
					});
					return { ok: true, runId: done.id, status: done.status };
				}
				return { ok: true, runId: run.id, status: run.status };
			} catch (error) {
				return { ok: false, error: withRegistrationNextStep(error) };
			}
		}
	}));

	// ── 文献条目管理：命名、重新提交、删除（课题组命名规范 + 精读条目维护）────────
	//
	// 与登记类工具的分工：登记类创建条目并跑生成流程；这一组只维护**已存在**条目，
	// 不改状态机、不重跑审计，交付的字节由调用方负责。

	// 补/改文献条目命名段（<期刊缩写> <年份> <通讯作者> <中文概括> <题目前段>）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_set_entry_naming",
		description:
			"补齐或修改文献条目的命名段，决定条目目录名与产物文件名。" +
			"规范：<期刊缩写> <年份> <通讯作者> <中文内容概括> <英文题目前段>，命名中不允许出现标点。" +
			"mode=freeze（默认）只写命名，条目尚未固化时按新命名创建目录；" +
			"mode=apply 会按当前命名重算并**移动**条目目录（正文/SI/报告/PPT 一起搬），" +
			"对已经交付的条目请先与用户确认。" +
			"通讯作者必须优先从 PDF 首页脚注/星标确认：检索库的作者列表不标注通讯作者，末位作者只是启发式。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", required: true, description: "文献 bundleId" },
			mode: { type: "string", description: "freeze（默认，只写命名）/ apply（重算并移动条目目录）" },
			...ENTRY_NAMING_PARAMETERS
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					entryStem: { type: "string" },
					entryDir: { type: "string" },
					movedCount: { type: "number" },
					movedJson: { type: "string" },
					missingNaming: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `命名更新失败：${value.error ?? "未知错误"}` }];
				const moved = value.movedCount ? `\n已搬运 ${value.movedCount} 个产物：\n${value.movedJson}` : "";
				const missing = value.missingNaming?.length ? `\n仍缺命名段：${value.missingNaming.join("、")}` : "";
				return [{ type: "text", text: `条目命名已更新：${value.entryStem}\n目录：${value.entryDir}${moved}${missing}` }];
			}
		},
		timeoutMs: 60000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).setEntryNaming({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					naming: pickEntryNaming(args),
					mode: args.mode === "apply" ? "apply" : "freeze"
				});
				return cleanJson({
					ok: true,
					bundleId: result.bundle.id,
					entryStem: result.bundle.entryStem,
					entryDir: result.bundle.entryDir,
					movedCount: result.moved.length,
					movedJson: result.moved.length ? JSON.stringify(result.moved, null, 2) : undefined,
					missingNaming: result.missingNaming
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 重新提交正文/SI（覆盖，不新建条目、不换目录）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_update_bundle_file",
		description:
			"重新提交某条文献的正文 PDF 或 SI 补充材料：覆盖同一命名目录下的同名产物并刷新哈希。" +
			"用途：用户补传了更正版原文/SI，或第一次传错文件需要替换。" +
			"不会新建精读条目，也不会移动目录；kind=pdf 时会把该条目标记为“已有原文”。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", required: true, description: "文献 bundleId" },
			kind: { type: "string", required: true, description: "pdf（正文）或 si（补充材料）" },
			filePath: { type: "string", required: true, description: "新文件的绝对路径（PDF；SI 可为 pdf/docx/zip）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					fileName: { type: "string" },
					filePath: { type: "string" },
					sha256: { type: "string" },
					replaced: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `重新提交失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已重新提交 ${value.fileName}（sha256 ${String(value.sha256).slice(0, 12)}…）${value.replaced ? `\n已替换：${value.replaced}` : ""}` }];
			}
		},
		timeoutMs: 60000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				if (!args.filePath) return { ok: false, error: "filePath 必填" };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).resubmitBundleFile({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					kind: args.kind,
					filePath: args.filePath
				});
				return cleanJson({ ok: true, bundleId: result.bundle.id, fileName: result.fileName, filePath: result.filePath, sha256: result.sha256, replaced: result.replaced });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 重新提交精读报告（覆盖同一 report 行的产物）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_update_report",
		description:
			"重新提交某条精读报告的内容（覆盖同一 reportId 的报告文件与哈希）。" +
			"用途：按人工审核意见修改后再次提交，或第一次生成有误需要替换。" +
			"修改后仍需在面板重新人工审核，审核通过前不开放下载。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			reportId: { type: "string", required: true, description: "既有精读 reportId" },
			reportPath: { type: "string", description: "修改后的精读 Markdown 绝对路径（与 markdown 二选一）" },
			markdown: { type: "string", description: "可选：直接给 Markdown 正文（与 reportPath 二选一）" },
			format: { type: "string", description: "可选：md（默认）或 docx" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					reportId: { type: "string" },
					fileName: { type: "string" },
					filePath: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `精读报告重新提交失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已重新提交精读报告（${value.fileName}）。请在面板重新人工审核后再交付。` }];
			}
		},
		timeoutMs: 60000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				if (!args.reportPath && !args.markdown) return { ok: false, error: "reportPath 与 markdown 至少提供一个" };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).resubmitReport({
					projectId: resolved.projectId,
					reportId: args.reportId,
					format: args.format === "docx" ? "docx" : "md",
					markdown: args.markdown,
					sourceName: args.reportPath
				});
				return cleanJson({ ok: true, reportId: result.report.id, fileName: result.fileName, filePath: result.filePath });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 重新提交文献汇报 PPT（覆盖同一 run 的 pptx）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_update_presentation",
		description:
			"重新提交某次文献汇报 PPT（覆盖同一 presentationId 的 pptx 文件）。" +
			"用途：按审核意见改版后再次提交；文件必须已由 lab_ppt_build_from_template 或用户生成。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			presentationId: { type: "string", required: true, description: "PPT run id（lab_tasks_register_presentation 返回的 runId）" },
			pptxPath: { type: "string", required: true, description: "新的 .pptx 绝对路径" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					fileName: { type: "string" },
					filePath: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `PPT 重新提交失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已重新提交文献汇报 PPT（${value.fileName}）。` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				if (!args.pptxPath) return { ok: false, error: "pptxPath 必填" };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).resubmitPresentation({
					projectId: resolved.projectId,
					presentationId: args.presentationId,
					filePath: args.pptxPath
				});
				return cleanJson({ ok: true, runId: result.presentation.id, fileName: result.fileName, filePath: result.filePath });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// 删除精读条目（含条目目录下的正文/SI/报告/PPT）。
	ctx.tools.register(defineTool({
		name: "lab_tasks_delete_bundle",
		description:
			"从课题删除一条文献精读条目：删除条目目录（正文、SI、精读报告、PPT、契约）与其读数行。" +
			"不可恢复，且会连带删除该条目的精读报告与汇报 PPT。" +
			"调用前必须向用户确认要删的是哪一条（用 bundleId + 题名/命名指认），只有用户明确同意才传 confirm=true。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			bundleId: { type: "string", required: true, description: "要删除的文献 bundleId" },
			confirm: { type: "boolean", description: "用户明确同意删除时必须传 true，否则拒绝执行" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					bundleId: { type: "string" },
					removedCount: { type: "number" },
					removedJson: { type: "string" },
					reportCount: { type: "number" },
					presentationCount: { type: "number" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `删除失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已删除条目 ${value.bundleId}（精读报告 ${value.reportCount} 份、汇报 PPT ${value.presentationCount} 份）。\n删除清单：\n${value.removedJson}` }];
			}
		},
		timeoutMs: 60000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).deleteBundle({
					projectId: resolved.projectId,
					bundleId: args.bundleId,
					confirm: args.confirm === true
				});
				return cleanJson({
					ok: true,
					bundleId: result.bundleId,
					removedCount: result.removed.length,
					removedJson: JSON.stringify(result.removed, null, 2),
					reportCount: result.reports.length,
					presentationCount: result.presentations.length
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	// ── 文献综述：检索条目 → 综述文档 → 综述 PPT ────────────────────────────────
	//
	// 与单篇精读并列的第二条交付线：输入是**一次检索的全部结果**，产物落在
	// <workspace>/literature/reviews/<runStem>/，模板复用阅读笔记模板域（kind=review）。

	ctx.tools.register(defineTool({
		name: "lab_review_templates_list",
		description:
			"列出可用的文献综述模板（「模板管理」里 kind=review 的模板）。" +
			"对某个检索条目写综述前先调用它挑选模板；缺省使用 review-default。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					templatesJson: { type: "string" },
					count: { type: "number" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `综述模板列表失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `可用综述模板 ${value.count} 个：\n${value.templatesJson}` }];
			}
		},
		timeoutMs: 15000,
		async execute() {
			try {
				const templates = await ctx.labNoteTemplates.listReviewTemplates();
				return cleanJson({
					ok: true,
					count: templates.length,
					templatesJson: JSON.stringify(templates.map((row) => ({
						id: row.id,
						version: row.version,
						name: row.name,
						topics: row.topics
					})), null, 2)
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_review_templates_get",
		description: "取某个综述模板的章节骨架、风格与证据要求（写综述前用它对齐格式）。",
		parameters: {
			templateId: { type: "string", required: true, description: "综述模板 id（lab_review_templates_list 返回）" },
			templateVersion: { type: "string", description: "可选：模板版本；缺省取最新 active 版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					templateId: { type: "string" },
					templateVersion: { type: "string" },
					templateName: { type: "string" },
					sectionsJson: { type: "string" },
					requirementsJson: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `取综述模板失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `综述模板 ${value.templateName}（${value.templateId}@${value.templateVersion}）\n章节骨架：\n${value.sectionsJson}\n生成要求：\n${value.requirementsJson}` }];
			}
		},
		timeoutMs: 15000,
		async execute(args) {
			try {
				const snapshot = await ctx.labNoteTemplates.snapshotForTask(args.templateId, args.templateVersion);
				if (!snapshot) return { ok: false, error: `综述模板 '${args.templateId}' 不存在` };
				const requirements = ctx.labNoteTemplates.toNoteRequirements(snapshot);
				return cleanJson({
					ok: true,
					templateId: snapshot.id,
					templateVersion: snapshot.version,
					templateName: snapshot.name,
					sectionsJson: JSON.stringify(snapshot.sections.map((section) => `${section.required === false ? "[可选] " : ""}${section.title}：${section.hint ?? ""}`), null, 2),
					requirementsJson: JSON.stringify({
						audience: requirements.audience,
						language: requirements.language,
						length: requirements.length,
						styleRules: requirements.styleRules,
						evidenceRequirements: requirements.evidenceRequirements,
						outputRequirements: requirements.outputRequirements
					}, null, 2)
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_get_review_inputs",
		description:
			"对某个文献检索条目写综述前必须先调用：盘点本次检索的全部结果（题名/摘要/中文概括/DOI）、" +
			"RIS 导出路径与综述模板要求，并把「综述生成契约」写入条目目录，返回 contractPath。" +
			"必须用 read 读完 contractPath 后，严格按其中的章节骨架与纳入文献清单写综述；" +
			"只能引用契约里列出的文献，不得引入未检索到的内容。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			runId: { type: "string", required: true, description: "检索条目 id（lab_tasks_register_search 返回的 runId）" },
			templateId: { type: "string", description: "可选：综述模板 id；缺省用条目已选模板或 review-default" },
			templateVersion: { type: "string", description: "可选：综述模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					title: { type: "string" },
					resultCount: { type: "number" },
					templateId: { type: "string" },
					templateVersion: { type: "string" },
					archiveDir: { type: "string" },
					risPath: { type: "string" },
					papersJson: { type: "string" },
					contractPath: { type: "string" },
					contractCharacters: { type: "number" },
					templateSectionCount: { type: "number" },
					instructions: { type: "array", items: { type: "string" } }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `综述输入盘点失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: [
					`综述输入盘点：${value.title || value.runId}（${value.resultCount} 条文献）`,
					`模板：${value.templateId ?? "（无，用默认综述结构）"}${value.templateVersion ? `@${value.templateVersion}` : ""}`,
					`归档目录：${value.archiveDir}`,
					value.risPath ? `RIS 导出：${value.risPath}` : "RIS 尚未导出（可调用 lab_tasks_search_ris）",
					`纳入文献：\n${value.papersJson}`,
					`综述生成契约（先用 read 读完，再按章节骨架写）：\n${value.contractPath}（${value.contractCharacters} 字符 / ${value.templateSectionCount} 节）`,
					`强制顺序：\n- ${(value.instructions ?? []).join("\n- ")}`
				].join("\n\n") }];
			}
		},
		timeoutMs: 30000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const inputs = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).readingReviewInputs({
					projectId: resolved.projectId,
					runId: args.runId,
					templateId: args.templateId,
					templateVersion: args.templateVersion
				});
				const contract = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).materializeReviewContract(inputs);
				return cleanJson({
					ok: true,
					runId: inputs.runId,
					title: inputs.title,
					resultCount: inputs.resultCount,
					templateId: inputs.template?.id,
					templateVersion: inputs.template?.version,
					archiveDir: inputs.archiveDir,
					risPath: inputs.risPath,
					papersJson: JSON.stringify(inputs.papers.map((paper) => ({
						paperId: paper.paperId,
						title: paper.title,
						summaryZh: paper.summaryZh,
						doi: paper.doi,
						year: paper.year,
						journal: paper.journal
					})), null, 2),
					contractPath: contract.contractPath,
					contractCharacters: contract.contractCharacters,
					templateSectionCount: contract.templateSectionCount,
					instructions: inputs.instructions
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_register_review",
		description:
			"把某检索条目的文献综述登记到课题（面板检索条目会出现「综述」）。" +
			"调用前必须先用 lab_tasks_get_review_inputs 盘点并读完综述生成契约。" +
			"同一 runId 重复登记即为**重新提交**（覆盖同一归档目录下的综述报告）。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			runId: { type: "string", required: true, description: "检索条目 id" },
			reviewPath: { type: "string", description: "综述 Markdown 绝对路径（与 markdown 二选一）" },
			markdown: { type: "string", description: "可选：直接给综述 Markdown 正文（与 reviewPath 二选一）" },
			docxPath: { type: "string", description: "可选：已生成的综述 .docx 绝对路径" },
			templateId: { type: "string", description: "可选：本次使用的综述模板 id" },
			templateVersion: { type: "string", description: "可选：综述模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					markdownPath: { type: "string" },
					docxPath: { type: "string" },
					contractPath: { type: "string" },
					sha256: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `综述登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记文献综述（${value.runId}）。\n报告：${value.markdownPath}${value.docxPath ? `\nWord：${value.docxPath}` : ""}\n可在课题面板检索条目上直接打开。` }];
			}
		},
		timeoutMs: 60000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				if (!args.reviewPath && !args.markdown) return { ok: false, error: "reviewPath 与 markdown 至少提供一个" };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).registerReview({
					projectId: resolved.projectId,
					runId: args.runId,
					markdown: args.markdown,
					reportPath: args.reviewPath,
					docxPath: args.docxPath,
					templateId: args.templateId,
					templateVersion: args.templateVersion
				});
				return cleanJson({
					ok: true,
					runId: result.run.id,
					markdownPath: result.markdownPath,
					docxPath: result.docxPath,
					contractPath: result.contractPath,
					sha256: result.run.review?.sha256
				});
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));

	ctx.tools.register(defineTool({
		name: "lab_tasks_register_review_presentation",
		description:
			"把文献综述的汇报 PPT 登记到检索条目（面板检索条目出现「综述PPT」）。" +
			"PPT 用 lab_ppt_build_from_template 按所选 PPT 模板构建；同一 runId 重复登记即为重新提交。",
		parameters: {
			projectId: { type: "string", description: "可选：课题编号；缺省按会话绑定或工作目录反查" },
			runId: { type: "string", required: true, description: "检索条目 id" },
			pptxPath: { type: "string", required: true, description: "综述汇报 .pptx 绝对路径" },
			contractPath: { type: "string", description: "可选：PPT 生成契约路径（lab_ppt_templates_contract 返回）" },
			conformancePath: { type: "string", description: "可选：PPT 符合性报告路径（lab_ppt_build_from_template 返回）" },
			templateId: { type: "string", description: "可选：所用 PPT 模板 id" },
			templateVersion: { type: "string", description: "可选：PPT 模板版本" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					error: { type: "string" },
					runId: { type: "string" },
					pptxPath: { type: "string" }
				}
			},
			render(args, value) {
				if (!value.ok) return [{ type: "text", text: `综述 PPT 登记失败：${value.error ?? "未知错误"}` }];
				return [{ type: "text", text: `已登记综述汇报 PPT（${value.runId}）：${value.pptxPath}` }];
			}
		},
		timeoutMs: 120000,
		async execute(args, exec) {
			try {
				const resolved = resolveProjectId(ctx, args, exec);
				if (resolved.error) return { ok: false, error: resolved.error };
				const result = await (ctx.get?.("ibmLiteratureWorkflows") ?? ctx.labTasks).registerReviewPresentation({
					projectId: resolved.projectId,
					runId: args.runId,
					pptxPath: args.pptxPath,
					contractPath: args.contractPath,
					conformancePath: args.conformancePath,
					templateId: args.templateId,
					templateVersion: args.templateVersion
				});
				return cleanJson({ ok: true, runId: result.run.id, pptxPath: result.pptxPath });
			} catch (error) {
				return { ok: false, error: error.message };
			}
		}
	}));
}

export const Config = undefined;
