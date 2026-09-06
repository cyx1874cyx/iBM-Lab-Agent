/* global window */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrowserExecutable } from "./helpers/ketcher-page.mjs";

const viewerRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)), "client", "assets", "pdf-viewer-standalone");

function minimalPdf() {
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		"<< /Length 63 >>\nstream\nBT /F1 18 Tf 72 720 Td (Worker ready evidence quote) Tj ET\nendstream",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
	];
	let body = "%PDF-1.4\n";
	const offsets = [0];
	for (let index = 0; index < objects.length; index += 1) {
		offsets.push(Buffer.byteLength(body));
		body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xref = Buffer.byteLength(body);
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body);
}

test("pdf viewer configures its offline worker and renders an archived page", async () => {
	const executablePath = resolveBrowserExecutable();
	assert.ok(executablePath, "需要 Edge/Chrome 或 LAB_BROWSER_PATH 执行 PDF viewer 浏览器验收");
	const pdf = minimalPdf();
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname === "/api/lab-artifacts") {
				res.writeHead(200, { "content-type": "application/pdf", "content-length": pdf.length });
				res.end(pdf);
				return;
			}
			let pathname = decodeURIComponent(url.pathname);
			if (pathname.startsWith("/api/lab-pdf-viewer/")) pathname = pathname.slice("/api/lab-pdf-viewer".length);
			if (pathname === "/" || pathname === "") pathname = "/index.html";
			const file = join(viewerRoot, normalize(pathname).replace(/^([/\\])+/, ""));
			if (!file.startsWith(viewerRoot) || !existsSync(file) || !statSync(file).isFile()) {
				res.writeHead(404).end("not found");
				return;
			}
			const bytes = await readFile(file);
			const mime = { ".html": "text/html;charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript" }[extname(file)] ?? "application/octet-stream";
			res.writeHead(200, { "content-type": mime, "content-length": bytes.length, "cache-control": "no-store" });
			res.end(bytes);
		} catch {
			res.writeHead(500).end("server error");
		}
	});
	let browser;
	try {
		await new Promise((resolvePromise, rejectPromise) => {
			server.once("error", rejectPromise);
			server.listen(0, "127.0.0.1", () => resolvePromise());
		});
		const { default: puppeteer } = await import("puppeteer-core");
		browser = await puppeteer.launch({ executablePath, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
		const page = await browser.newPage();
		await page.evaluateOnNewDocument(() => {
			window.__pdfMessages = [];
			window.addEventListener("message", (event) => window.__pdfMessages.push(event.data));
		});
		const address = server.address();
		await page.goto(`http://127.0.0.1:${address.port}/api/lab-pdf-viewer/index.html?v=worker-v2`, { waitUntil: "load" });
		await page.waitForFunction(() => window.__pdfMessages.some((row) => row?.type === "ready"));
		// 期刊印刷页码可能远大于 PDF 物理页数；viewer 必须按摘录找到真实页。
		await page.evaluate(() => window.postMessage({ type: "open", bundleId: "bundle-test", kind: "pdf", page: 17619, quote: "Worker ready evidence quote" }, window.location.origin));
		await page.waitForFunction(() => window.__pdfMessages.some((row) => row?.type === "loaded"), { timeout: 30000 });
		const messages = await page.evaluate(() => window.__pdfMessages);
		assert.equal(messages.some((row) => row?.type === "error" && /GlobalWorkerOptions\.workerSrc/.test(row.message || "")), false);
		assert.ok(messages.some((row) => row?.type === "loaded" && row.page === 1));
		assert.ok(messages.some((row) => row?.type === "highlight" && row.status === "matched"));
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
	}
});
