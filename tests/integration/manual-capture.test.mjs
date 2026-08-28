/**
 * Integration: 手工下载文献自动捕获（labCapture）。
 *
 * 覆盖需求 P0/P1 的测试项：
 *   - 捕获任务创建成功（token 明文一次性返回 + 数据库只存哈希）
 *   - 微信来源只使用 DOI 出版社页面；无 DOI 拒绝启动（不回退公众号链接）
 *   - 非法令牌 404 / 重放令牌 409 / 过期令牌拒绝
 *   - 100 MB 上限 / 非 PDF 冒充 / PDF 头与 EOF 错误 / SI 不支持格式
 *   - 路径穿越文件名被清理
 *   - 成功上传后复用原 bundle 并记录 manual-browser-capture provenance
 *   - PDF/SI 下载接口能读取捕获文件
 *   - Remote 接口（manual_capture_create/get/list）可从浏览器侧调用
 *   - 服务重启后任务状态与 bundle 登记保持正确
 *   - 前端按钮状态逻辑与"不显示公众号链接"静态断言
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { bootLite } from "../helpers/boot-lite.mjs";
import { createCaptureUploadHandler } from "../../lib/manual-capture.js";

const vendorRoot = fileURLToPath(new URL("../../vendor/nature-skills", import.meta.url));
const clientPath = fileURLToPath(new URL("../../client/index.js", import.meta.url));

/** 合法 chrome-extension:// Origin（MV3 扩展 id = 32 个 a–p 字符）。 */
const CHROME_ORIGIN = `chrome-extension://${"a".repeat(32)}`;

function mockRes() {
	const res = { status: 0, headers: {}, body: "" };
	res.writeHead = (status, headers) => { res.status = status; res.headers = headers ?? {}; };
	res.end = (body) => { res.body = body; };
	return res;
}

function uploadRequest({ token, fileName, body, origin = CHROME_ORIGIN, contentLength }) {
	const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
	return {
		method: "PUT",
		url: `/api/lab-capture-upload?token=${encodeURIComponent(token)}`,
		headers: {
			origin,
			"content-type": "application/octet-stream",
			"x-file-name": encodeURIComponent(fileName),
			"content-length": String(contentLength ?? buffer.byteLength)
		},
		body: buffer
	};
}

/** 构造最小合法 PDF（≥8KB，含 %PDF- 头与 %%EOF）。 */
function minimalPdf(seed = "x") {
	return Buffer.from(`%PDF-1.7\n1 0 obj<</Type /Page>>endobj\n${seed.repeat(9000)}\n%%EOF`);
}

async function bootCapture({ storageRoot } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-capture-"));
	const projectsRoot = join(dir, "projects");
	const handle = await bootLite({
		storageRoot: storageRoot ?? join(dir, "storages"),
		vendorDir: vendorRoot,
		lockFile: fileURLToPath(new URL("../../vendor.lock.json", import.meta.url)),
		includePython: false,
		extraRows: [
			{ id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
			{ id: "api-gateway", name: "@deepseek-ai/dsh-api-gateway" },
			{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] },
			{ id: "lab-note-templates", name: "dsh-lab-agent/note-templates", inject: ["storageDomain"] },
			{ id: "lab-ppt-templates", name: "dsh-lab-agent/ppt-templates", inject: ["storageDomain"], config: { templatesDir: join(dir, "templates") } },
			{ id: "lab-tasks", name: "dsh-lab-agent/tasks", inject: ["storageDomain", "labGoals", "labNoteTemplates", "labTemplates", "labVersions"], config: { skillsRoot: vendorRoot + "/skills", projectsRoot } },
			{ id: "lab-literature-sources", name: "dsh-lab-agent/literature-sources", inject: ["storageDomain"], config: { sessionsDir: join(dir, "literature-sessions"), downloadsDir: join(dir, "literature-downloads") } },
			{ id: "lab-chemistry", name: "dsh-lab-agent/chemistry", inject: ["storageDomain"] },
			{ id: "lab-nmr", name: "dsh-lab-agent/nmr", inject: ["storageDomain"] },
			{ id: "lab-synthesis", name: "dsh-lab-agent/synthesis", inject: ["storageDomain"] },
			{ id: "lab-convert", name: "dsh-lab-agent/convert", inject: ["storageDomain"] },
			{ id: "lab-python-env", name: "dsh-lab-agent/python-env", inject: [] },
			{ id: "lab-capture", name: "dsh-lab-agent/manual-capture", inject: ["storageDomain", "labTasks"] },
			{ id: "lab-remote", name: "dsh-lab-agent/remote", inject: ["labVersions", "labGoals", "labNoteTemplates", "labTasks", "labTemplates", "labLiterature", "labChemistry", "labNmr", "labSynthesis", "labPython", "labConvert", "labCapture"] }
		]
	});
	const ctx = handle.ctx;
	// 幂等：重启测试复用同一 storageRoot 时项目已存在
	if (ctx.labTasks.getProject("capture-project") === undefined) {
		await ctx.labTasks.createProject({
			id: "capture-project",
			name: "捕获测试课题",
			coreMarkdown: "# 捕获测试课题",
			goalProfileId: "default-prodrug-polymer",
			goalProfileVersion: "1",
			templateId: "nature-default",
			templateVersion: "1"
		});
	}
	const putBundle = async (row) => {
		// 幂等：重启测试复用同一 storageRoot 时保留已登记状态（pdfPath/siPath 不丢）
		const existing = ctx.labTasks.table("bundles").get(row.id);
		if (existing) return existing;
		const next = { ...row, projectId: "capture-project", createdAt: row.createdAt ?? new Date().toISOString(), updatedAt: row.updatedAt ?? new Date().toISOString() };
		await ctx.labTasks.table("bundles").put(row.id, next);
		return ctx.labTasks.table("bundles").get(row.id);
	};
	const now = new Date().toISOString();
	const bundle = await putBundle({
		id: "bundle-cap-1",
		title: "捕获测试文献",
		doi: "10.1000/capture.1",
		sourceType: "document",
		acquisitionStatus: "awaiting-pdf",
		locatorMode: "source-limited",
		status: "pending",
		createdAt: now,
		updatedAt: now
	});
	const handler = createCaptureUploadHandler(ctx.labCapture);
	const upload = async (req) => {
		const res = mockRes();
		await handler(req, res);
		let payload = {};
		try { payload = JSON.parse(res.body); } catch { /* 非 JSON 响应 */ }
		return { status: res.status, payload, headers: res.headers };
	};
	return { handle, dir, ctx, project: ctx.labTasks.getProject("capture-project"), bundle, putBundle, upload, handler };
}

async function invoke(ctx, method, args = {}) {
	return await ctx.typertGateway.invoke({ namespace: "lab", method, args });
}

test("capture: 创建任务成功，publisherUrl 用 DOI 出版社页面，令牌只存哈希", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		const created = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		// 32 字节随机一次性令牌：base64url 至少 32 字符
		assert.ok(created.token.length >= 32, "token returned once with length >= 32");
		assert.match(created.task.tokenSha256, /^[0-9a-f]{64}$/);
		// DOI 存在 → 出版社页面必须是 doi.org，绝不回退公众号链接
		assert.equal(created.task.publisherUrl, "https://doi.org/10.1000/capture.1");
		assert.equal(created.task.kind, "pdf");
		assert.equal(created.task.status, "armed");
		assert.equal(created.task.bundleId, "bundle-cap-1");
		assert.equal(created.task.projectId, "capture-project");
		// 默认有效期约 20 分钟
		const ttl = new Date(created.task.expiresAt).getTime() - Date.now();
		assert.ok(ttl > 19 * 60 * 1000 && ttl <= 20 * 60 * 1000 + 5000, `ttl ~20min, got ${ttl}ms`);
		// 数据库行只存哈希：明文 token 不落库
		const row = ctx.labCapture.getTask(created.task.id);
		assert.ok(row, "task persisted");
		assert.equal(Object.hasOwn(row, "token"), false, "明文 token 不持久化");
		assert.equal(row.tokenSha256, created.task.tokenSha256);
		assert.equal(createHash("sha256").update(created.token).digest("hex"), row.tokenSha256, "哈希与明文一致");
		// 同一 bundle+kind 已有 armed 任务 → 拒绝重复布防
		// 同一 bundle+kind 已有 armed 未过期任务 → 用户再次点击 = 重新捕获：
		// 旧任务作废（cancelled，旧令牌失效），创建新任务。
		const retry = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		assert.notEqual(retry.task.id, created.task.id, "重新捕获创建新任务");
		assert.equal(ctx.labCapture.getTask(created.task.id).status, "cancelled", "旧任务作废");
		assert.equal(ctx.labCapture.getTask(retry.task.id).status, "armed");
		// 作废后旧令牌不可再上传（防重放）
		const res = await boot.upload(uploadRequest({ token: created.token, fileName: "old.pdf", body: minimalPdf() }));
		assert.equal(res.status, 409);
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 捕获失败后能重新捕获（扩展侧失败时服务端任务仍 armed，再次点击作废重建）", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		// 模拟扩展侧上传失败（桥接不可用）：服务端任务从未收到 PUT，仍停在 armed
		const first = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" });
		assert.equal(first.task.status, "armed");
		// 用户再次点击按钮 → 不再被"已有进行中的捕获任务"拦截，而是作废旧任务重建
		const second = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" });
		assert.notEqual(second.task.id, first.task.id);
		assert.equal(ctx.labCapture.getTask(first.task.id).status, "cancelled");
		// 新任务可正常完成上传
		const si = Buffer.from("recovered supplementary data");
		const res = await boot.upload(uploadRequest({ token: second.token, fileName: "recover.zip", body: si }));
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(ctx.labCapture.getTask(second.task.id).status, "completed");
		// 服务端校验失败（任务 failed）后同样可重新捕获
		const third = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" });
		const bad = await boot.upload(uploadRequest({ token: third.token, fileName: "bad.exe", body: Buffer.from("MZ") }));
		assert.equal(bad.status, 400);
		assert.equal(ctx.labCapture.getTask(third.task.id).status, "failed");
		const fourth = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" });
		assert.equal(ctx.labCapture.getTask(fourth.task.id).status, "armed", "failed 后重建不受阻塞");
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 微信来源只使用 DOI 出版社页面；无 DOI 拒绝启动", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		// 微信来源 + DOI → 用 https://doi.org/<doi>
		const wx = await boot.putBundle({
			id: "bundle-cap-wx",
			title: "微信公众号文献",
			doi: "10.1000/wx.1",
			sourceType: "wechat",
			sourceUrl: "https://mp.weixin.qq.com/s/AbCdEf",
			acquisitionStatus: "awaiting-pdf",
			status: "pending"
		});
		assert.equal(wx.sourceType, "wechat");
		const created = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-wx", kind: "pdf" });
		assert.equal(created.task.publisherUrl, "https://doi.org/10.1000/wx.1");
		assert.ok(!created.task.publisherUrl.includes("weixin"), "不得使用公众号链接");
		// 微信来源无 DOI → 拒绝（不得回退到公众号页面）
		await boot.putBundle({
			id: "bundle-cap-wx-nodoi",
			title: "无 DOI 的微信文献",
			sourceType: "wechat",
			sourceUrl: "https://mp.weixin.qq.com/s/NoDoi123",
			acquisitionStatus: "awaiting-pdf",
			status: "pending"
		});
		await assert.rejects(
			() => ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-wx-nodoi", kind: "pdf" }),
			/未登记 DOI/
		);
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 普通来源无 DOI 也拒绝启动", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		await boot.putBundle({ id: "bundle-cap-nodoi", title: "无 DOI 文献", sourceType: "document", status: "pending" });
		await assert.rejects(
			() => ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-nodoi", kind: "si" }),
			/未登记 DOI/
		);
		// 未知 kind 拒绝
		await assert.rejects(
			() => ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "ppt" }),
			/kind must be pdf or si/
		);
		// 越权 bundle：属于其他课题
		await ctx.labTasks.createProject({
			id: "other-project", name: "其他课题",
			goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1",
			templateId: "nature-default", templateVersion: "1"
		});
		await boot.putBundle({ id: "bundle-cap-other", title: "他人文献", doi: "10.1000/other.1", sourceType: "document", status: "pending" });
		await ctx.labTasks.table("bundles").put("bundle-cap-other", { ...boot.ctx.labTasks.table("bundles").get("bundle-cap-other"), projectId: "other-project" });
		await assert.rejects(
			() => ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-other", kind: "pdf" }),
			/belongs to another project/
		);
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 上传接口 — 非法令牌 404 / 过期拒绝 / 重放 409 / 非法 Origin 403", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		const pdf = minimalPdf();
		// 非法令牌 → 404
		const bad = await boot.upload(uploadRequest({ token: "not-a-real-token", fileName: "paper.pdf", body: pdf }));
		assert.equal(bad.status, 404);
		// 缺少 token → 400
		const noToken = await boot.upload({ method: "PUT", url: "/api/lab-capture-upload", headers: { origin: CHROME_ORIGIN }, body: pdf });
		assert.equal(noToken.status, 400);
		// 非 chrome-extension:// Origin → 403
		const evil = await boot.upload(uploadRequest({ token: "x", fileName: "paper.pdf", body: pdf, origin: "https://evil.example.com" }));
		assert.equal(evil.status, 403);

		const created = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		const token = created.token;
		// 过期令牌 → 拒绝（非 2xx）
		const task = ctx.labCapture.getTask(created.task.id);
		await ctx.labCapture.table.put(task.id, { ...task, expiresAt: new Date(Date.now() - 1000).toISOString() });
		const expired = await boot.upload(uploadRequest({ token, fileName: "paper.pdf", body: pdf }));
		assert.ok(expired.status >= 400, `expired rejected, got ${expired.status}`);
		// 恢复未过期并成功上传
		await ctx.labCapture.table.put(task.id, { ...task, status: "armed", expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() });
		const first = await boot.upload(uploadRequest({ token, fileName: "paper.pdf", body: pdf }));
		assert.equal(first.status, 200, JSON.stringify(first.payload));
		// 重放同一令牌 → 409
		const replay = await boot.upload(uploadRequest({ token, fileName: "paper2.pdf", body: pdf }));
		assert.equal(replay.status, 409);
		assert.match(replay.payload.error, /replay|已使用/);
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 上传接口 — 100MB 上限 / 非 PDF / 头与 EOF 错误 / SI 格式白名单", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		// 每个校验用例创建新任务前，先清理上一个仍 armed 的任务（如 413 预检不落库失败）。
		const newPdfTask = async () => {
			for (const key of ctx.labCapture.table.keys()) {
				const row = ctx.labCapture.table.get(key);
				if (row.status === "armed") await ctx.labCapture.table.put(key, { ...row, status: "failed", error: "test cleanup" });
			}
			return ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		};
		// 100MB 上限：Content-Length 预检直接拒绝
		const created = await newPdfTask();
		const oversized = await boot.upload(uploadRequest({
			token: created.token, fileName: "huge.pdf",
			body: Buffer.alloc(0),
			contentLength: 101 * 1024 * 1024
		}));
		assert.equal(oversized.status, 413);

		// 非 PDF 冒充 PDF（.pdf 名 + 文本内容）
		const created2 = await newPdfTask();
		const fake = await boot.upload(uploadRequest({ token: created2.token, fileName: "fake.pdf", body: Buffer.from("hello world this is not a pdf") }));
		assert.equal(fake.status, 400);
		assert.match(fake.payload.error, /PDF/);

		// PDF 缺 %PDF- 头
		const created3 = await newPdfTask();
		const noHeader = await boot.upload(uploadRequest({ token: created3.token, fileName: "nohdr.pdf", body: Buffer.from("x".repeat(9000) + "\n%%EOF") }));
		assert.equal(noHeader.status, 400);
		assert.match(noHeader.payload.error, /文件头/);

		// PDF 缺 %%EOF
		const created4 = await newPdfTask();
		const noEof = await boot.upload(uploadRequest({ token: created4.token, fileName: "noeof.pdf", body: Buffer.from("%PDF-1.7\n" + "x".repeat(9000)) }));
		assert.equal(noEof.status, 400);
		assert.match(noEof.payload.error, /EOF/);

		// PDF 任务不匹配 .pdf 文件名
		const created5 = await newPdfTask();
		const wrongName = await boot.upload(uploadRequest({ token: created5.token, fileName: "paper.txt", body: minimalPdf() }));
		assert.equal(wrongName.status, 400);
		assert.match(wrongName.payload.error, /不匹配文件名/);

		// SI 非支持格式（.exe）
		await newPdfTask();
		const createdSi = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" });
		const exe = await boot.upload(uploadRequest({ token: createdSi.token, fileName: "malware.exe", body: Buffer.from("MZ") }));
		assert.equal(exe.status, 400);
		assert.match(exe.payload.error, /不匹配文件名|SI 只支持/);
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 路径穿越文件名被清理，文件落在课题工作区 captured-literature/<bundleId>/", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		const pdf = minimalPdf("traversal");
		const created = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		const res = await boot.upload(uploadRequest({ token: created.token, fileName: "../../../evil.pdf", body: pdf }));
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(res.payload.fileName, "evil.pdf", "路径组件被剥离");
		const bundle = ctx.labTasks.getBundle("bundle-cap-1");
		assert.ok(bundle.pdfPath, "bundle.pdfPath 已登记");
		assert.ok(!bundle.pdfPath.includes(".."), "登记路径无目录穿越");
		assert.ok(bundle.pdfPath.endsWith(join("captured-literature", "bundle-cap-1", "evil.pdf")), "保存到课题工作区 captured-literature/<bundleId>/");
		assert.ok(existsSync(bundle.pdfPath), "文件真实存在");
		assert.equal(ctx.labCapture.table.get(created.task.id).status, "completed");
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 成功上传后复用原 bundle，记录 provenance，下载接口可读取", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		const pdf = minimalPdf("e2e");
		const pdfSha = createHash("sha256").update(pdf).digest("hex");
		// PDF 上传
		const createdPdf = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		const resPdf = await boot.upload(uploadRequest({ token: createdPdf.token, fileName: "paper.pdf", body: pdf }));
		assert.equal(resPdf.status, 200, JSON.stringify(resPdf.payload));
		let bundle = ctx.labTasks.getBundle("bundle-cap-1");
		assert.equal(bundle.id, "bundle-cap-1", "复用原 bundleId，不新建文献");
		assert.equal(bundle.acquisitionStatus, "ready");
		assert.equal(bundle.pdfSha256, pdfSha);
		assert.ok(bundle.pdfPath.endsWith("paper.pdf"));
		// provenance 记录 manual-browser-capture
		const prov = ctx.labTasks.listProvenance("capture-project").find((p) => p.source === "manual-browser-capture");
		assert.ok(prov, "manual-browser-capture provenance 已记录");
		assert.equal(prov.kind, "source-bundle");
		// 下载接口能读取捕获文件（长度 + SHA-256 一致）
		const file = await ctx.labTasks.bundleFile("bundle-cap-1", "pdf");
		assert.equal(file.byteLength, pdf.byteLength);
		assert.equal(file.sha256, pdfSha);
		assert.equal(file.fileName, "paper.pdf");
		// SI 上传（同一 bundle 追加 siPath）
		const si = Buffer.from("supplementary data for capture test");
		const createdSi = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" });
		const resSi = await boot.upload(uploadRequest({ token: createdSi.token, fileName: "supporting.zip", body: si }));
		assert.equal(resSi.status, 200, JSON.stringify(resSi.payload));
		bundle = ctx.labTasks.getBundle("bundle-cap-1");
		assert.equal(bundle.siSha256, createHash("sha256").update(si).digest("hex"));
		assert.ok(bundle.siPath.endsWith(join("captured-literature", "bundle-cap-1", "supporting.zip")));
		const siFile = await ctx.labTasks.bundleFile("bundle-cap-1", "si");
		assert.deepEqual(siFile.buffer, si);
		// 精读报告不被捕获改动（不冒充全文精读完成）
		const report = await ctx.labTasks.createReadingReport({ projectId: "capture-project", bundleId: "bundle-cap-1", goalProfileId: "default-prodrug-polymer", goalProfileVersion: "1" });
		assert.equal(report.status, "pending");
		assert.equal(report.paperCardPath, undefined);
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: Remote 接口可从浏览器侧调用（create/get/list）", async () => {
	const boot = await bootCapture();
	try {
		const ctx = boot.ctx;
		// 浏览器侧 wire 形态：args 带 request 对象
		const created = await invoke(ctx, "manual_capture_create", { request: { projectId: "capture-project", bundleId: "bundle-cap-1", kind: "si" } });
		const task = created.task;
		assert.ok(task, "create 返回 task");
		assert.equal(task.status, "armed");
		assert.equal(task.publisherUrl, "https://doi.org/10.1000/capture.1");
		assert.match(task.token, /^[A-Za-z0-9_-]{20,}$/, "明文 token 只在创建响应中出现");
		assert.equal(Object.hasOwn(task, "tokenSha256"), false, "wire 层不暴露哈希细节（干净 JSON）");

		const got = await invoke(ctx, "manual_capture_get", { request: { taskId: task.id } });
		assert.equal(got.task.id, task.id);
		assert.equal(Object.hasOwn(got.task, "token"), false, "get 不返回明文 token");
		assert.match(got.task.tokenSha256, /^[0-9a-f]{64}$/);

		const listed = await invoke(ctx, "manual_capture_list", { request: { projectId: "capture-project" } });
		assert.ok(listed.tasks.some((row) => row.id === task.id));
		assert.equal(listed.tasks[0].projectId, "capture-project");
	} finally {
		await boot.handle.dispose();
		await rm(boot.dir, { recursive: true, force: true });
	}
});

test("capture: 服务重启后任务状态与 bundle 登记保持正确", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-capture-restart-"));
	const storageRoot = join(dir, "storages");
	let first;
	try {
		first = await bootCapture({ storageRoot });
		const ctx = first.ctx;
		const pdf = minimalPdf("restart");
		const created = await ctx.labCapture.createCaptureTask({ projectId: "capture-project", bundleId: "bundle-cap-1", kind: "pdf" });
		const res = await first.upload(uploadRequest({ token: created.token, fileName: "restart.pdf", body: pdf }));
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(ctx.labCapture.table.get(created.task.id).status, "completed");
	} finally {
		if (first) await first.handle.dispose();
	}
	// 重启：同一 storageRoot 重新 boot
	let second;
	try {
		second = await bootCapture({ storageRoot });
		const ctx = second.ctx;
		const tasks = ctx.labCapture.listTasks("capture-project");
		assert.ok(tasks.length >= 1, "重启后任务仍在");
		const done = tasks.find((row) => row.status === "completed");
		assert.ok(done, "completed 状态保持");
		assert.match(done.fileSha256, /^[0-9a-f]{64}$/);
		const bundle = ctx.labTasks.getBundle("bundle-cap-1");
		assert.ok(bundle.pdfPath && existsSync(bundle.pdfPath), "bundle.pdfPath 重启后仍指向已归档文件");
		assert.equal(bundle.acquisitionStatus, "ready");
	} finally {
		if (second) await second.handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("capture: 前端按钮状态逻辑与「不显示公众号链接」静态断言", async () => {
	const client = await readFile(clientPath, "utf8");
	// 按钮始终存在：PDF/SI 两个图标按钮带 data-ready 状态
	assert.match(client, /aria-label": "PDF 原文"/);
	assert.match(client, /aria-label": "SI 补充材料"/);
	assert.match(client, /data-ready/);
	// 已获取 → 点亮下载（downloadVerifiedBinary 长度+SHA-256 校验）
	assert.match(client, /downloadVerifiedBinary/);
	// 未获取 → 灰色可点击：同步打开出版社页 + 异步创建捕获任务 + 通知扩展
	assert.match(client, /manual_capture_create/);
	assert.match(client, /ARM_CAPTURE/);
	assert.match(client, /armCaptureFor/);
	assert.match(client, /window\.open\(publisherUrl/);
	assert.match(client, /等待下一次/, "显示等待下一次下载提示");
	// 扩展完成通知 → 重新拉取 workspace（onChanged）
	assert.match(client, /CAPTURE_COMPLETED/);
	assert.match(client, /ibm-lit-capture-ext/);
	// 不显示公众号链接：前端不含 mp.weixin.qq.com 域名，微信来源不回退 sourceUrl
	assert.ok(!client.includes("mp.weixin.qq.com"), "前端不含公众号域名");
	assert.match(client, /sourceType === "wechat" \? undefined :/, "微信来源不回退到公众号链接");
});
