/**
 * dsh-lab-agent: 文档转 Markdown 服务（Cordis host service, ctx.labConvert）。
 *
 * 集成 microsoft/markitdown（可选 Python 依赖）：用户上传 Office 格式
 * （docx/pptx/xlsx/pdf/图片等）→ convertToMarkdown → 保存 .md 到
 * $DSH_HOME/lab-agent/converted/ + 转换记录（lab_convert domain）。
 * markitdown 不可用时清晰降级（available:false + 安装指引），绝不静默。
 *
 * NOTE: fields/methods must stay PUBLIC — Cordis wraps services in a proxy
 * whose shadow receivers are not class instances, so private fields break.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { PROFILE_ID_RE } from "../src/goal-profile.js";
import { convertWithMarkitdown, probeMarkitdown } from "../src/markitdown.js";
import { venvPythonPath } from "../src/python-env.js";

/** Browser Remote 载荷上限；base64 解码前后都会校验。 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** 需要借助 markitdown 才方便 Agent 阅读的常见文档格式。 */
const CONVERTIBLE_UPLOAD_EXTENSIONS = new Set([
	".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
	".rtf", ".html", ".htm", ".epub"
]);

function safeUploadName(value) {
	const leaf = basename(String(value ?? "").replace(/\\/g, "/"))
		.normalize("NFC")
		.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
		.replace(/[. ]+$/g, "")
		.trim();
	if (!leaf || leaf === "." || leaf === "..") throw new Error("上传文件名无效");
	if (leaf.length <= 180) return leaf;
	const extension = extname(leaf).slice(0, 24);
	return `${leaf.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function decodeUploadBase64(base64) {
	if (typeof base64 !== "string") throw new Error("上传内容必须是 base64 字符串");
	const normalized = base64.replace(/\s+/g, "");
	if (normalized.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) {
		throw new Error(`文件不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
	}
	if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
		throw new Error("上传内容不是有效的 base64");
	}
	const buffer = Buffer.from(normalized, "base64");
	const unpadded = normalized.replace(/=+$/g, "");
	if (buffer.toString("base64").replace(/=+$/g, "") !== unpadded) {
		throw new Error("上传内容不是有效的 base64");
	}
	if (buffer.length > MAX_UPLOAD_BYTES) throw new Error(`文件不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
	return buffer;
}

export const convertRunSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	sourcePath: z.string().min(1),
	fileName: z.string().default(""),
	mdPath: z.string().optional(),
	status: z.enum(["pending", "succeeded", "failed"]).default("pending"),
	error: z.string().optional(),
	inputsSha256: z.string().min(1),
	createdAt: z.string(),
	updatedAt: z.string()
});

export const labConvertDomainSpec = defineDomain({
	name: "lab_convert",
	version: 0,
	tables: {
		convert_runs: domainTable(convertRunSchema)
	}
});

export class LabConvertService extends Service {
	static inject = ["storageDomain"];
	table;

	/** @param config {{ venvDir?: string, convertedDir?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labConvert");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(labConvertDomainSpec);
		this.ctx.effect(() => () => domain.close(), "lab-agent.convert.domainClose");
		this.domain = domain;
		this.table = domain.table("convert_runs");
		// 执行器可注入（测试 mock 用；生产为 markitdown 封装）
		this.convert = convertWithMarkitdown;
		this.probe = probeMarkitdown;
	}

	requireTable() {
		if (this.table === undefined) throw new Error("labConvert is not started yet");
		return this.table;
	}

	convertedDir() {
		return this.config.convertedDir ?? join(process.env.DSH_HOME ?? "", "lab-agent", "converted");
	}

	venvPython() {
		return this.config.venvDir ? venvPythonPath(this.config.venvDir) : undefined;
	}

	/** markitdown 可用性探测。 */
	async markitdownAvailable() {
		return await this.probe({ venvPython: this.venvPython() });
	}

	/** 安装指引（供 UI/文档展示）。 */
	installHint() {
		return {
			available: false,
			hint: "markitdown 未安装。请在实验室 Python 环境安装：\n  python -m pip install markitdown\n（Windows 本地建议先创建 venv 再安装）",
			script: "node scripts/install-markitdown.mjs"
		};
	}

	/**
	 * 转换本地文件 → Markdown，保存到 converted/ 并登记运行记录。
	 * @returns {{ run, text }} 转换后的 markdown 文本与记录。
	 */
	async convertToMarkdown({ path, fileName, outputDir }) {
		if (!existsSync(path)) throw new Error(`file not found: ${path}`);
		const buffer = await readFile(path);
		const inputsSha256 = createHash("sha256").update(buffer).digest("hex");
		const id = `convert-${Date.now().toString(36)}`;
		const now = new Date().toISOString();
		const run = convertRunSchema.parse({
			id,
			sourcePath: path,
			fileName: fileName ?? path.split(/[\\/]/).pop() ?? path,
			status: "pending",
			inputsSha256,
			createdAt: now,
			updatedAt: now
		});
		await this.requireTable().put(id, run);

		const dir = outputDir ?? this.convertedDir();
		await mkdir(dir, { recursive: true });
		const mdPath = join(dir, `${id}.md`);

		const result = await this.convert(path, { venvPython: this.venvPython(), output: mdPath });
		if (!result.available) {
			const failed = await this.persist({ ...run, status: "failed", error: result.error, updatedAt: new Date().toISOString() });
			throw new Error(`markitdown 不可用：${result.error}`);
		}
		if (result.error) {
			const failed = await this.persist({ ...run, status: "failed", error: result.error, updatedAt: new Date().toISOString() });
			throw new Error(`转换失败：${result.error}`);
		}
		const done = await this.persist({ ...run, status: "succeeded", mdPath, updatedAt: new Date().toISOString() });
		return { run: done, text: result.text, mdPath };
	}

	/**
	 * 安全保存浏览器上传文件。uploadDir 必须由 host 根据已验证的课题构造，
	 * 不能直接采用浏览器传来的目录。
	 * @param {{ name: string, base64: string, uploadDir?: string }} 浏览器上传载荷。
	 */
	async saveUpload({ name, base64, uploadDir }) {
		const fileName = safeUploadName(name);
		const buffer = decodeUploadBase64(base64);
		const dir = uploadDir ?? join(this.convertedDir(), "uploads");
		await mkdir(dir, { recursive: true });
		const sourcePath = join(dir, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${fileName}`);
		await writeFile(sourcePath, buffer, { flag: "wx" });
		return {
			fileName,
			sourcePath,
			byteLength: buffer.length,
			sha256: createHash("sha256").update(buffer).digest("hex")
		};
	}

	/**
	 * 保存课题文件，并尽力把 PDF/Office 文档转换为同课题下的 Markdown。
	 * 转换器缺失或转换失败不会撤销原文件上传，避免用户重新选择文件。
	 */
	async ingestUpload({ name, base64, uploadDir, outputDir }) {
		const stored = await this.saveUpload({ name, base64, uploadDir });
		const extension = extname(stored.fileName).toLowerCase();
		if (!CONVERTIBLE_UPLOAD_EXTENSIONS.has(extension)) {
			return { ...stored, conversion: { status: "skipped" } };
		}
		try {
			const converted = await this.convertToMarkdown({
				path: stored.sourcePath,
				fileName: stored.fileName,
				outputDir
			});
			return { ...stored, mdPath: converted.mdPath, conversion: { status: "succeeded", runId: converted.run.id } };
		} catch (reason) {
			return { ...stored, conversion: { status: "failed", error: reason?.message ?? String(reason) } };
		}
	}

	/** 上传（base64）文件 → 写临时文件 → 转换（保留旧 API 兼容）。 */
	async convertUpload({ name, base64 }) {
		const stored = await this.saveUpload({ name, base64 });
		return await this.convertToMarkdown({ path: stored.sourcePath, fileName: stored.fileName });
	}

	listRuns() {
		return [...this.requireTable().keys()].sort().map((k) => this.requireTable().get(k));
	}

	async persist(row) {
		await this.requireTable().put(row.id, row);
		return { ...row };
	}
}

export default LabConvertService;
