/**
 * Lossless Office preview pipeline: render the actual staged DOCX/PPTX with
 * LibreOffice and serve the resulting PDF. There is deliberately no text-only
 * or approximate fallback — a missing renderer is an environment error.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICE_KINDS = new Set(["docx", "pptx"]);

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
	constructor({ cacheDir, sofficePath = process.env.LAB_OFFICE_RENDERER || "soffice", timeoutMs = 120000 } = {}) {
		if (!cacheDir) throw new Error("Office preview cacheDir is required");
		this.cacheDir = cacheDir;
		this.sofficePath = sofficePath;
		this.timeoutMs = timeoutMs;
		this.inFlight = new Map();
	}

	async preflight() {
		await run(this.sofficePath, ["--headless", "--version"], { timeoutMs: 15000 });
		return { ok: true, renderer: this.sofficePath };
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
		const work = await mkdtemp(join(tmpdir(), "dsh-office-preview-"));
		try {
			const input = join(work, `source.${kind}`);
			const profile = join(work, "libreoffice-profile");
			await mkdir(profile, { recursive: true });
			await writeFile(input, buffer);
			await run(this.sofficePath, [
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
