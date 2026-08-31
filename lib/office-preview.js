/**
 * Lossless Office preview pipeline: render the actual staged DOCX/PPTX with
 * LibreOffice and serve the resulting PDF. There is deliberately no text-only
 * or approximate fallback — a missing renderer is an environment error.
 *
 * P1-3: [resolveSofficeExecutable] resolves the renderer from explicit config
 * → typical absolute install paths → PATH, so a clean Windows machine without
 * soffice on PATH is still detected when LibreOffice is installed in the
 * default location. Missing renderers degrade with an actionable diagnostic.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICE_KINDS = new Set(["docx", "pptx"]);

/** 各平台 LibreOffice 典型安装路径（绝对路径，不依赖 PATH）。 */
const SOFFICE_CANDIDATES = {
	win32: [
		"C:\\Program Files\\LibreOffice\\program\\soffice.exe",
		"C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
	],
	darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"],
	linux: ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice"]
};

/** 探测 soffice --headless --version，返回版本行（不可执行时 null）。 */
function sofficeVersion(command, platform) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(command, ["--headless", "--version"], {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
				shell: platform === "win32" && !command.includes("/") && !command.includes("\\")
			});
		} catch {
			// win32 上"存在但不可执行"的文件会同步抛 UNKNOWN/ENOENT
			return resolve(null);
		}
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", () => resolve(null));
		const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 15000);
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) return resolve(null);
			const version = (stdout || stderr).trim().split("\n")[0] || null;
			resolve(version);
		});
	});
}

/**
 * P1-3：解析 LibreOffice 可执行文件。
 *
 * 解析顺序：
 *   1. 显式配置（LAB_OFFICE_RENDERER / config.sofficePath）——存在且可执行
 *      即用；显式配置缺失/不可执行时明确报错，不静默降级；
 *   2. 典型绝对安装路径（win32 含 %LOCALAPPDATA%\Programs）；
 *   3. PATH 中的 soffice / soffice.exe；
 *   4. unavailable。
 *
 * @param {{ explicit?: string, platform?: string }} options
 * @returns {Promise<{ command: string | null, source: string, version: string | null, detail: string, hint: string }>}
 */
export async function resolveSofficeExecutable({ explicit, platform = process.platform } = {}) {
	// 1) 显式配置
	if (explicit) {
		const pathExists = existsSync(explicit);
		const pathUsable = pathExists ? await sofficeVersion(explicit, platform) : null;
		if (pathUsable) {
			return { command: explicit, source: "explicit", version: pathUsable, detail: explicit, hint: "使用显式配置的 LibreOffice 可执行文件。" };
		}
		return {
			command: null,
			source: "explicit-missing",
			version: null,
			detail: pathExists ? `配置的渲染器不可执行: ${explicit}` : `配置的渲染器不存在: ${explicit}`,
			hint: "请检查 LAB_OFFICE_RENDERER / sofficePath 配置的路径是否正确，或安装 LibreOffice。"
		};
	}
	// 2) 典型安装路径
	const candidates = [...(SOFFICE_CANDIDATES[platform] ?? [])];
	if (platform === "win32" && process.env.LOCALAPPDATA) {
		candidates.push(join(process.env.LOCALAPPDATA, "Programs", "LibreOffice", "program", "soffice.exe"));
	}
	for (const path of candidates) {
		if (!existsSync(path)) continue;
		const version = await sofficeVersion(path, platform);
		if (version) {
			return { command: path, source: "paths", version, detail: path, hint: "检测到典型安装路径中的 LibreOffice。" };
		}
	}
	// 3) PATH 探测
	for (const name of ["soffice", "soffice.exe"]) {
		const version = await sofficeVersion(name, platform);
		if (version) {
			return { command: name, source: "path", version, detail: `${name}（PATH）`, hint: "PATH 中的 LibreOffice。" };
		}
	}
	// 4) unavailable
	return {
		command: null,
		source: "unavailable",
		version: null,
		detail: "未找到 LibreOffice（典型安装路径与 PATH 均无 soffice）",
		hint: "Office 预览（PPTX/DOCX → PDF）需要 LibreOffice。可从 libreoffice.org 下载安装；安装后无需额外配置，客户端自动检测典型安装路径。"
	};
}

function run(command, args, { timeoutMs = 120000 } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Office preview renderer timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", (error) => { clearTimeout(timer); reject(new Error(`Office preview renderer unavailable (${command}): ${error.message}`)); });
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`Office preview renderer failed (${code}): ${(stderr || stdout).trim() || "no diagnostic output"}`));
		});
	});
}

export class OfficePreviewRenderer {
	constructor({ cacheDir, sofficePath, timeoutMs = 120000, platform = process.platform } = {}) {
		if (!cacheDir) throw new Error("Office preview cacheDir is required");
		this.cacheDir = cacheDir;
		this.explicit = sofficePath ?? process.env.LAB_OFFICE_RENDERER ?? null;
		this.timeoutMs = timeoutMs;
		this.platform = platform;
		this.inFlight = new Map();
		this._resolved = null;
	}

	/** 惰性解析渲染器（结果缓存；缺失时返回诊断结构而非抛错）。 */
	async resolveRenderer() {
		if (!this._resolved) {
			this._resolved = await resolveSofficeExecutable({ explicit: this.explicit, platform: this.platform });
		}
		return this._resolved;
	}

	/** 渲染器状态（供 Doctor / preflight 诊断复用）。 */
	async status() {
		return await this.resolveRenderer();
	}

	async preflight() {
		const resolved = await this.resolveRenderer();
		if (!resolved.command) {
			throw new Error(`Office preview renderer unavailable: ${resolved.detail}. ${resolved.hint}`);
		}
		return { ok: true, renderer: resolved.command, source: resolved.source, version: resolved.version };
	}

	async render({ buffer, kind, sha256 }) {
		if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Office preview source is empty");
		if (!OFFICE_KINDS.has(kind)) throw new Error(`unsupported Office preview kind '${kind}'`);
		const sourceSha256 = sha256 || createHash("sha256").update(buffer).digest("hex");
		if (!/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error("invalid Office preview source hash");
		await mkdir(this.cacheDir, { recursive: true });
		const cachePath = join(this.cacheDir, `${sourceSha256}.pdf`);
		if (existsSync(cachePath)) return await this.readVerifiedPdf(cachePath, sourceSha256);
		if (!this.inFlight.has(sourceSha256)) {
			this.inFlight.set(sourceSha256, this.renderFresh({ buffer, kind, sourceSha256, cachePath }).finally(() => this.inFlight.delete(sourceSha256)));
		}
		return await this.inFlight.get(sourceSha256);
	}

	async readVerifiedPdf(path, sourceSha256) {
		const pdf = await readFile(path);
		if (pdf.length < 8 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`invalid rendered preview PDF: ${basename(path)}`);
		return {
			buffer: pdf,
			mime: "application/pdf",
			byteLength: pdf.length,
			sha256: createHash("sha256").update(pdf).digest("hex"),
			sourceSha256
		};
	}

	async renderFresh({ buffer, kind, sourceSha256, cachePath }) {
		const resolved = await this.resolveRenderer();
		if (!resolved.command) {
			throw new Error(`Office preview renderer unavailable: ${resolved.detail}. ${resolved.hint}`);
		}
		const command = resolved.command;
		const work = await mkdtemp(join(tmpdir(), "dsh-office-preview-"));
		try {
			const input = join(work, `source.${kind}`);
			const profile = join(work, "libreoffice-profile");
			await mkdir(profile, { recursive: true });
			await writeFile(input, buffer);
			await run(command, [
				`-env:UserInstallation=${pathToFileURL(profile).href}`,
				"--headless",
				"--convert-to", "pdf",
				"--outdir", work,
				input
			], { timeoutMs: this.timeoutMs });
			const rendered = join(work, "source.pdf");
			if (!existsSync(rendered)) throw new Error("Office preview renderer completed without producing a PDF");
			const pdf = await readFile(rendered);
			if (pdf.length < 8 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Office preview renderer produced an invalid PDF");
			await writeFile(cachePath, pdf);
			return await this.readVerifiedPdf(cachePath, sourceSha256);
		} finally {
			await rm(work, { recursive: true, force: true });
		}
	}
}

export default OfficePreviewRenderer;
