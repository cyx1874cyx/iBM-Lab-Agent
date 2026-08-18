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

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { PROFILE_ID_RE } from "../src/goal-profile.js";
import { convertWithMarkitdown, probeMarkitdown } from "../src/markitdown.js";
import { venvPythonPath } from "../src/python-env.js";

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
	async convertToMarkdown({ path, fileName }) {
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

		const dir = this.convertedDir();
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
	 * 上传（base64）文件 → 写临时文件 → 转换。
	 * @param {{ name: string, base64: string }} 浏览器上传载荷。
	 */
	async convertUpload({ name, base64 }) {
		const buffer = Buffer.from(base64, "base64");
		const dir = join(this.convertedDir(), "uploads");
		await mkdir(dir, { recursive: true });
		const tmp = join(dir, `${Date.now().toString(36)}-${name.replace(/[^\w.\-]/g, "_")}`);
		await writeFile(tmp, buffer);
		return await this.convertToMarkdown({ path: tmp, fileName: name });
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
