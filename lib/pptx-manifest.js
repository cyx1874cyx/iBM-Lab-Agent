/**
 * dsh-lab-agent: pptx-cli 封装（模板 manifest 作为唯一事实来源）。
 *
 * 架构分工（0.5.4 起）：
 *   * **pptx-cli 负责「读模板 + 验输出」** —— 把 .pptx 解析成 manifest.yaml
 *     （版式、占位符提示文字、几何、有效字号、静态层指纹），并提供
 *     `validate` / `manifest diff` / `doctor` 这些我们不该重写的检查；
 *   * **我们自己的 scripts/pptx/build_from_template.py 负责「写内容 + 中文排版政策」**
 *     —— pptx-cli 1.3.5 全包没有任何 font.name/font.size/对齐写入，纯文本路径也不剥
 *     模板自带项目符号，且定位全程按 `placeholder_idx`（PowerPoint 会重排 idx）。
 *     这三件事只能由我们做（见 docs/PPT_TEMPLATE_SPEC.md）。
 *
 * 硬约束：
 *   1. 不 fork / 不 vendor pptx-cli 源码，只用 pin 的发布版；
 *   2. 它是**可选依赖**：没装时所有入口返回 `available:false` + 明确诊断，
 *      既不抛未捕获异常，也绝不静默给出伪结果（调用方必须显式降级）；
 *   3. 控制台脚本不可依赖，统一用 `python -m pptx_cli`；
 *   4. 解释器走仓库统一 resolver（venv → bundled → 系统 py/python3），
 *      与 PPTX builder 用同一个，避免两套探测逻辑漂移。
 *
 * pptx-cli 的机器契约：stdout 只放 JSON envelope
 *   {schema_version, request_id, ok, command, result, warnings, errors, metrics}
 * 退出码分类：0 成功 / 10 校验或模式错误 / 20 权限或策略 / 40 冲突或过期状态 /
 *            50 IO 或包读写 / 90 内部错误。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { bundledPythonFromEnv, resolvePythonExecutable } from "../src/python-env.js";
import { typographyFromScan } from "../src/ppt-slot-spec.js";
import { scanPresentationXml } from "../src/pptx-xml.js";

/** 以模块方式执行（控制台脚本不可依赖）。 */
export const PPTX_CLI_MODULE = "pptx_cli";
/** manifest 包内的固定文件名（pptx-cli init 产物布局）。 */
export const MANIFEST_FILE = "manifest.yaml";
export const ANNOTATIONS_FILE = "annotations.yaml";
export const INIT_REPORT_FILE = join("reports", "init-report.json");
export const FINGERPRINTS_FILE = join("fingerprints", "parts.json");
/** pptx-cli 会把源模板复制进 manifest 包，供后续 XML 级检查使用。 */
export const PACKAGED_SOURCE_TEMPLATE = join("assets", "source-template.pptx");

/** pptx-cli 退出码 → 分类与中文说明。 */
export const PPTX_CLI_EXIT_CODES = {
	0: { kind: "ok", message: "成功" },
	10: { kind: "validation", message: "校验或模式错误（deck spec / manifest 不符合契约）" },
	20: { kind: "permission", message: "权限或策略失败" },
	40: { kind: "conflict", message: "冲突或过期状态（例如模板指纹已变）" },
	50: { kind: "io", message: "IO 或包读写失败" },
	90: { kind: "internal", message: "pptx-cli 内部错误" }
};

/**
 * 错误码 → 排查建议。按**前缀**匹配（pptx-cli 的 code 形如
 * `ERR_VALIDATION_TABLE_PAYLOAD` / `ERR_IO_NOT_FOUND`），未知码给通用建议，
 * 不做"猜"式的假映射。
 */
const CLI_ERROR_HINTS = [
	["ERR_IO_NOT_FOUND", "路径不存在：确认模板/成品/manifest 目录的实际位置，注意 Windows 盘符与转义"],
	["ERR_IO_", "文件读写失败：确认文件未被 PowerPoint 占用、目录可写"],
	["ERR_VALIDATION_", "契约校验失败：按 message 修正 deck spec 或模板占位符用法"],
	["ERR_PERMISSION", "被策略拒绝：检查目标目录权限与企业策略"],
	["ERR_CONFLICT", "状态冲突：模板已变更（指纹不符），重新执行 init 生成新 manifest"],
	["ERR_SCHEMA", "JSON Schema 校验失败：输入结构不符合 pptx-cli 契约"],
	["ERR_INTERNAL", "pptx-cli 内部错误：保留原始 message 上报，不要静默重试掩盖"]
];

/** 退出码 → 分类（未知码归入 internal）。 */
export function classifyExitCode(code) {
	return PPTX_CLI_EXIT_CODES[code] ?? { kind: "internal", message: `未知退出码 ${code}` };
}

/** 错误码 → 分类（按前缀）。 */
export function errorKindFromCode(code) {
	const text = String(code ?? "");
	if (text.startsWith("ERR_VALIDATION") || text.startsWith("ERR_SCHEMA")) return "validation";
	if (text.startsWith("ERR_IO")) return "io";
	if (text.startsWith("ERR_PERMISSION")) return "permission";
	if (text.startsWith("ERR_CONFLICT")) return "conflict";
	if (text.startsWith("ERR_INTERNAL")) return "internal";
	return "unknown";
}

/** 单条 pptx-cli 错误 → 我们的错误对象（code/message/hint/kind/...）。 */
export function mapCliError(error) {
	const code = typeof error?.code === "string" ? error.code : undefined;
	const message = typeof error?.message === "string" ? error.message : String(error?.message ?? error ?? "unknown pptx-cli error");
	const hint = CLI_ERROR_HINTS.find(([prefix]) => (code ?? "").startsWith(prefix))?.[1]
		?? "未知 pptx-cli 错误码：按原始 message 排查，必要时在开发机上跑 `python -m pptx_cli doctor --manifest <dir>`";
	return {
		code: code ?? "ERR_UNKNOWN",
		message,
		hint,
		kind: errorKindFromCode(code),
		retryable: error?.retryable === true,
		suggestedAction: typeof error?.suggested_action === "string" ? error.suggested_action : undefined
	};
}

/** envelope 里的 errors[] → 我们的错误对象数组。 */
export function mapCliErrors(errors) {
	if (!Array.isArray(errors)) return [];
	return errors.map(mapCliError);
}

/**
 * 从子进程 stdout 里取 pptx-cli 的 JSON envelope。
 *
 * pptx-cli 在 `--format json` 下把 stdout 留给 JSON，但真实环境里 stdout 仍可能被
 * 包装脚本/告警行污染（实测 markitdown 那条链就有）。所以不从"行前缀"猜，而是
 * **从最后一个以 `{` 开头的行开始解析**，逐行往前退，直到解析成功；再校验它确实
 * 是 envelope（`ok` 为布尔）—— 否则调用方按"非 JSON 输出"诊断，绝不当成结果。
 */
export function extractPptxCliEnvelope(stdout) {
	const text = String(stdout ?? "");
	if (!text.trim()) return undefined;
	const lines = text.split(/\r?\n/);
	const starts = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].trimStart().startsWith("{")) starts.push(index);
	}
	for (let position = starts.length - 1; position >= 0; position -= 1) {
		const start = starts[position];
		for (let end = lines.length - 1; end >= start; end -= 1) {
			const candidate = lines.slice(start, end + 1).join("\n").trim();
			if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
			let parsed;
			try {
				parsed = JSON.parse(candidate);
			} catch {
				continue;
			}
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.ok === "boolean") return parsed;
		}
	}
	return undefined;
}

/** 尚未安装 pptx-cli 时的统一降级文案（调用方直接回给用户/Agent）。 */
export function describeCliUnavailable(detail = {}) {
	const reason = detail.error ? `：${detail.error}` : "";
	return "pptx-cli 不可用（可选依赖未安装或解释器不可用）" + reason
		+ "。安装方式：pip install pptx-cli==1.3.5；本功能会降级为旧的 parse.json 路径（manifestSource=fallback），"
		+ "不会产出伪结果。";
}

/**
 * 解析用于执行 pptx-cli 的解释器。
 * `python` 显式给出时直接采用（测试/工具注入用），否则走统一 resolver。
 */
export async function resolveCliPython({ python, venvPython, platform = process.platform, allowSystemFallback } = {}) {
	if (typeof python === "string" && python) {
		return { command: [python], source: "explicit", version: "" };
	}
	const resolved = await resolvePythonExecutable({
		venvPython,
		bundledPython: bundledPythonFromEnv(),
		platform,
		allowSystemFallback
	});
	return { command: resolved.command, source: resolved.source, version: resolved.version ?? "" };
}

/**
 * 运行 `python -m pptx_cli <args>`。
 *
 * @param {string[]} args 子命令参数（会自动补 `--format json`，由调用方决定是否补）
 * @param {object} [options] python/venvPython/platform/cwd/timeoutMs/spawnImpl
 * @returns {Promise<object>} 永不抛：包含 available/ok/failure/error/hint 的诊断对象
 */
export async function runPptxCli(args, {
	python,
	venvPython,
	platform = process.platform,
	allowSystemFallback,
	cwd,
	timeoutMs = 120000,
	spawnImpl = spawn,
	env
} = {}) {
	const resolved = await resolveCliPython({ python, venvPython, platform, allowSystemFallback });
	const base = {
		available: resolved.command !== null,
		ok: false,
		code: null,
		envelope: undefined,
		stdout: "",
		stderr: "",
		python: resolved.command === null ? null : resolved.command.join(" "),
		pythonSource: resolved.source,
		args: [PPTX_CLI_MODULE, ...args]
	};
	if (resolved.command === null) {
		return { ...base, failure: "unavailable", error: "no python interpreter available", hint: describeCliUnavailable() };
	}
	const command = resolved.command;
	return await new Promise((resolve) => {
		let child;
		try {
			child = spawnImpl(command[0], [...command.slice(1), "-m", PPTX_CLI_MODULE, ...args], {
				cwd,
				env: env ?? process.env,
				stdio: ["ignore", "pipe", "pipe"]
			});
		} catch (error) {
			resolve({ ...base, failure: "spawn", error: `cannot spawn python: ${error.message}` });
			return;
		}
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ...base, ...value });
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish({
				failure: "timeout",
				stdout,
				stderr,
				error: `pptx-cli 超时（${timeoutMs}ms）：${args.join(" ")}`,
				hint: "模板过大或磁盘繁忙时可调大 timeoutMs；必要时先在开发机手动跑同一条命令确认耗时"
			});
		}, timeoutMs);
		child.stdout?.on("data", (chunk) => { stdout += chunk; });
		child.stderr?.on("data", (chunk) => { stderr += chunk; });
		child.on?.("error", (error) => finish({ failure: "spawn", stdout, stderr, error: error.message }));
		child.on?.("exit", (code) => {
			const envelope = extractPptxCliEnvelope(stdout);
			const exit = classifyExitCode(code);
			if (envelope === undefined) {
				// markitdown 式的诊断：解释器缺模块也是走这里（stderr 有 No module named）。
				const missingModule = /No module named/i.test(stderr);
				finish({
					ok: false,
					code,
					stdout,
					stderr,
					failure: "no-envelope",
					error: missingModule
						? `${describeCliUnavailable({ error: stderr.trim().split(/\r?\n/)[0] })}`
						: `pptx-cli 未输出 JSON envelope（exit ${code}，${exit.message}）：${(stderr || stdout).trim().split(/\r?\n/)[0] ?? "无输出"}`
				});
				return;
			}
			const errors = mapCliErrors(envelope.errors);
			const ok = code === 0 && envelope.ok !== false;
			finish({
				ok,
				code,
				envelope,
				stdout,
				stderr,
				failure: ok ? undefined : (exit.kind === "ok" ? "exit" : exit.kind),
				errorCode: errors[0]?.code,
				errorKind: errors[0]?.kind,
				hint: errors[0]?.hint,
				error: ok ? undefined : (errors[0]?.message ?? `${exit.message}（exit ${code}）`),
				errors,
				warnings: Array.isArray(envelope.warnings) ? envelope.warnings : [],
				metrics: envelope.metrics
			});
		});
	});
}

/**
 * 探测 pptx-cli 是否可用（含版本）。
 * 用 `--version`（输出裸版本号，如 `1.3.5`），不走 envelope。
 */
export async function probePptxCli(options = {}) {
	const resolved = await resolveCliPython(options);
	if (resolved.command === null) {
		return { available: false, version: undefined, python: null, pythonSource: resolved.source, hint: describeCliUnavailable() };
	}
	const result = await runPptxCli(["--version"], { ...options, timeoutMs: options.timeoutMs ?? 30000 });
	const version = result.code === 0 ? result.stdout.trim().split(/\r?\n/).pop()?.trim() : undefined;
	if (!version) {
		return {
			available: false,
			version: undefined,
			python: result.python,
			pythonSource: result.pythonSource,
			hint: describeCliUnavailable({ error: result.error ?? (result.stderr || "").trim() })
		};
	}
	return { available: true, version, python: result.python, pythonSource: result.pythonSource };
}

/** `init`：把 .pptx 解析成 manifest 包。 */
export function initTemplateManifest({ pptxPath, outDir, ...cli }) {
	return runPptxCli(["init", pptxPath, "--out", outDir, "--format", "json"], cli);
}

/** `layouts list`：版式目录（JSON envelope）。 */
export function listLayouts({ manifestDir, ...cli }) {
	return runPptxCli(["layouts", "list", "--manifest", manifestDir, "--format", "json"], cli);
}

/** `placeholders list`：单个版式的占位符契约。 */
export function listPlaceholders({ manifestDir, layoutId, ...cli }) {
	return runPptxCli(["placeholders", "list", layoutId, "--manifest", manifestDir, "--format", "json"], cli);
}

/** `theme show`：主题元数据。 */
export function showTheme({ manifestDir, ...cli }) {
	return runPptxCli(["theme", "show", "--manifest", manifestDir, "--format", "json"], cli);
}

/** `validate`：成品 deck 对 manifest 契约的符合性（strict 可把 warning 升级为失败）。 */
export function validateDeck({ manifestDir, deckPath, strict = false, ...cli }) {
	const args = ["validate", "--manifest", manifestDir, "--deck", deckPath, "--format", "json"];
	if (strict) args.push("--strict");
	return runPptxCli(args, cli);
}

/** `manifest diff`：两个 manifest 包之间的破坏性/增量变更。 */
export function diffManifests({ leftDir, rightDir, ...cli }) {
	return runPptxCli(["manifest", "diff", leftDir, rightDir, "--format", "json"], cli);
}

/** `doctor`：兼容性体检。 */
export function doctorReport({ manifestDir, ...cli }) {
	return runPptxCli(["doctor", "--manifest", manifestDir, "--format", "json"], cli);
}

/** 读取 YAML 或 JSON（manifest.yaml / annotations.yaml），失败返回 undefined。 */
async function loadYamlOrJson(path) {
	try {
		return yaml.load(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** 该目录是不是 pptx-cli 的 manifest 包。 */
export function isManifestPackage(dir) {
	return typeof dir === "string" && dir.length > 0 && existsSync(join(dir, MANIFEST_FILE));
}

/**
 * 扫描 manifest 包内模板 pptx 的排版信息（行距 / 段前后 / 内边距）。
 *
 * **必须接进 slots.json 的派生**：容量只有用模板真实排版算才有意义。本模板正文是固定
 * 30pt 行距（`<a:lnSpc><a:spcPts val="3000"/>`）+ 段前 10pt / 段后 14pt，而 pptx-cli 的
 * `max_lines` 硬编码 1.22 倍行距、不扣段间距 —— 实测高估 36%（fig1 分析槽 19 vs 14 行）。
 * 不接这一步，slots.json 会退化回默认模型，容量与 pptx-cli 等价，修复就只到 lint 为止。
 *
 * @param {{ sourceTemplate?: string }} pkg loadManifestPackage 的返回值
 * @param {Array<object>} layouts summarizeManifest(...).layouts
 * @returns {Promise<object|undefined>} 扫描失败或模板缺失时返回 undefined（由 deriveSlotSpec 标记为默认模型）
 */
export async function templateTypography(pkg, layouts) {
	if (typeof pkg?.sourceTemplate !== "string" || pkg.sourceTemplate === "") return undefined;
	try {
		const table = typographyFromScan(await scanPresentationXml(await readFile(pkg.sourceTemplate)), layouts);
		// 空表按"没解出来"处理：typographyFromScan 在包不合法/没有版式时返回 {}，
		// 若原样返回，deriveSlotSpec 会把 capacityModel.source 标成 "template-xml"
		// 却一个槽位的排版都没解析到 —— 那就是"静默假装检查过"。
		return table !== undefined && table !== null && Object.keys(table).length > 0 ? table : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 读取 manifest 包内容（manifest/annotations/report/fingerprints/源模板路径）。
 * 任何缺失或损坏都返回 `{ok:false, findings:[...]}`，不抛。
 */
export async function loadManifestPackage(dir) {
	const findings = [];
	if (!isManifestPackage(dir)) {
		return { ok: false, dir, findings: [{ level: "error", code: "manifest_missing", message: `no ${MANIFEST_FILE} under ${dir}` }] };
	}
	const manifest = await loadYamlOrJson(join(dir, MANIFEST_FILE));
	if (manifest === undefined || manifest === null || typeof manifest !== "object") {
		return { ok: false, dir, findings: [{ level: "error", code: "manifest_unreadable", message: `cannot parse ${join(dir, MANIFEST_FILE)}` }] };
	}
	const annotations = await loadYamlOrJson(join(dir, ANNOTATIONS_FILE));
	if (annotations === undefined) findings.push({ level: "warning", code: "annotations_unreadable", message: `${ANNOTATIONS_FILE} missing or unparsable (semantic aliases unavailable)` });
	const report = await loadYamlOrJson(join(dir, INIT_REPORT_FILE));
	if (report === undefined) findings.push({ level: "warning", code: "init_report_unreadable", message: `${INIT_REPORT_FILE} missing or unparsable` });
	const fingerprints = await loadYamlOrJson(join(dir, FINGERPRINTS_FILE));
	if (fingerprints === undefined) findings.push({ level: "warning", code: "fingerprints_unreadable", message: `${FINGERPRINTS_FILE} missing or unparsable (静态层指纹对比不可用)` });
	const sourceTemplate = join(dir, PACKAGED_SOURCE_TEMPLATE);
	if (!existsSync(sourceTemplate)) findings.push({ level: "warning", code: "source_template_missing", message: `${PACKAGED_SOURCE_TEMPLATE} not found in manifest package (XML 级检查跳过)` });
	return {
		ok: true,
		dir,
		manifestPath: join(dir, MANIFEST_FILE),
		manifest,
		annotations,
		report,
		fingerprints,
		sourceTemplate: existsSync(sourceTemplate) ? sourceTemplate : undefined,
		findings
	};
}

/** 把 manifest 归一化成我们内部用的槽位结构（与 pptx-cli 字段名保持可追溯）。 */
export function summarizeManifest(manifest) {
	const presentation = manifest?.presentation ?? {};
	return {
		manifestVersion: manifest?.manifest_version,
		template: {
			name: manifest?.template?.name,
			sourceHash: manifest?.template?.source_hash,
			extractedAt: manifest?.template?.extracted_at
		},
		pageSize: {
			widthEmu: presentation?.page_size?.width_emu,
			heightEmu: presentation?.page_size?.height_emu
		},
		slideCount: presentation?.slide_count,
		theme: presentation?.theme ?? {},
		rules: manifest?.rules ?? {},
		compatibilityReport: manifest?.compatibility_report ?? [],
		layouts: (manifest?.layouts ?? []).map((layout) => ({
			id: layout.id,
			name: layout.name,
			sourceLayoutIndex: layout.source_layout_index,
			previewPath: layout.preview_path,
			validationRules: layout.validation_rules ?? {},
			placeholders: (layout.placeholders ?? []).map((placeholder) => ({
				logicalName: placeholder.logical_name,
				sourceName: placeholder.source_name,
				idx: placeholder.placeholder_idx,
				type: placeholder.placeholder_type,
				guidanceText: placeholder.guidance_text ?? "",
				guidanceLines: placeholder.guidance_lines ?? [],
				required: placeholder.required === true,
				supportedContentTypes: placeholder.supported_content_types ?? [],
				geometry: {
					leftEmu: placeholder.left_emu,
					topEmu: placeholder.top_emu,
					widthEmu: placeholder.width_emu,
					heightEmu: placeholder.height_emu
				},
				capacity: placeholder.estimated_text_capacity ?? undefined,
				textDefaults: placeholder.text_defaults ?? {},
				inheritanceChain: placeholder.inheritance_chain ?? [],
				overflowPolicy: placeholder.overflow_policy
			})),
			protectedElements: (layout.protected_static_elements ?? []).map((element) => ({
				elementId: element.element_id,
				elementType: element.element_type,
				name: element.name,
				leftEmu: element.left_emu,
				topEmu: element.top_emu,
				widthEmu: element.width_emu,
				heightEmu: element.height_emu,
				fingerprint: element.fingerprint
			}))
		}))
	};
}

/** 该占位符是否可承载文字（图片型占位符不参与字号/项目符号政策）。 */
export function isTextPlaceholder(placeholder) {
	const types = placeholder?.supportedContentTypes ?? [];
	return types.includes("text") || types.includes("markdown-text");
}
