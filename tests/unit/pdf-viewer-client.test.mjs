import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const componentPath = fileURLToPath(new URL("../../client/src/components-core.js", import.meta.url));
const constantsPath = fileURLToPath(new URL("../../client/src/constants.js", import.meta.url));
const viewerPath = fileURLToPath(new URL("../../scripts/pdf-viewer-shell/src/main.tsx", import.meta.url));
const assetsServicePath = fileURLToPath(new URL("../../lib/pdf-viewer-assets.js", import.meta.url));

test("PDF evidence viewer switches documents after the iframe is already loaded", async () => {
	const source = await readFile(componentPath, "utf8");
	assert.match(source, /kind: documentKind, page: pageNumber, quote/);
	assert.match(source, /\/\/ 已加载的 iframe 不会再次发送 ready；属性切换时主动下发/);
	assert.match(source, /postOpen\(\);\s*return \(\) =>/s);
	assert.match(source, /\[bundleId, documentKind, pageNumber, quote\]/);
});

test("standalone PDF viewer keeps PDF and SI sources separate", async () => {
	const source = await readFile(viewerPath, "utf8");
	assert.match(source, /function configurePdfWorker\(\)/);
	assert.match(source, /pdfjsLib\.GlobalWorkerOptions\.workerSrc = WORKER_SRC/);
	assert.match(source, /new URL\("\/api\/lab-pdf-viewer\/pdf\.worker\.mjs\?v=worker-v2", window\.location\.origin\)\.href/);
	assert.match(source, /configurePdfWorker\(\);\s*const loadingTask = pdfjsLib\.getDocument/);
	assert.doesNotMatch(source, /getDocument\(\{ url: pdfUrl, workerSrc:/);
	assert.match(source, /const kind = d\.kind === "si" \? "si" : "pdf"/);
	assert.match(source, /kind=\$\{kind\}&bundleId=/);
	assert.match(source, /openPdf\(bundleId, kind, page, q\)/);
});

test("PDF viewer entry and worker bypass stale desktop WebView caches", async () => {
	const [constants, assetsService] = await Promise.all([
		readFile(constantsPath, "utf8"),
		readFile(assetsServicePath, "utf8")
	]);
	assert.match(constants, /PDF_VIEWER_URL = "\/api\/lab-pdf-viewer\/index\.html\?v=worker-v2"/);
	assert.match(assetsService, /ext === "\.html" \|\| target\.endsWith\("pdf\.worker\.mjs"\)/);
	assert.match(assetsService, /\? "no-store"/);
});

test("standalone PDF viewer ignores stale asynchronous loads and uses the current quote", async () => {
	const source = await readFile(viewerPath, "utf8");
	assert.match(source, /const requestSeqRef = useRef\(0\)/);
	assert.match(source, /const requestSeq = \+\+requestSeqRef\.current/);
	assert.match(source, /if \(requestSeq !== requestSeqRef\.current\)/);
	assert.match(source, /renderPage\(doc, page, q, requestSeq\)/);
	assert.match(source, /locateAndHighlight\(quoteText\)/);
	assert.doesNotMatch(source, /const \[quote, setQuote\]/);
});
