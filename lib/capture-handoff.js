/**
 * dsh-lab-agent: Edge capture handoff 页面服务（desktop-edge-handoff）。
 *
 * Windows 桌面版中，Tauri WebView2 不是 Edge/Chrome 扩展宿主，Content Script
 * 不会注入 WebView2。因此“获取 PDF / 获取 SI”不再由 WebView2 直接 ARM_CAPTURE，
 * 而是：
 *
 *   1. client 创建一次性捕获任务（captureId / token / expiresAt / publisherUrl）；
 *   2. Desktop 调用 open_in_edge() 打开本地 handoff 页面
 *      http://127.0.0.1:<port>/lab/capture/?taskId=<captureId>#t=<token>；
 *   3. handoff 页面运行在 Edge 标签页中（扩展 Content Script 可以注入），
 *      向扩展发送 ARM_CAPTURE 并等待 ACK；
 *   4. 布防成功后页面跳转 DOI/出版社页面；用户完成登录与下载；
 *   5. 扩展监听 chrome.downloads 并把匹配的 PDF/SI 经 Native Messaging 上传，
 *      DSH 校验并登记 bundle；client 以 capture task 状态为事实来源。
 *
 * 安全：
 *   - 页面 HTML 只内嵌任务元数据（id/kind/expiresAt/publisherUrl），不含令牌；
 *   - 一次性令牌经 URL fragment（#t=...）传入，fragment 不进浏览器历史、
 *     不发往服务器、不落日志；
 *   - 扩展侧仍校验上传地址 origin === 当前页面 origin && pathname 为捕获接口；
 *   - 页面只响应 loopback（127.0.0.1/localhost）请求。
 */

import { Service } from "@deepseek-ai/cordis";

/** handoff 固定路由；captureId 放在查询参数中，避免底层 Web 路由不匹配子路径。 */
export const HANDOFF_PATH = "/lab/capture/";

const CAPTURE_ID_RE = /^capture-[a-z0-9]+$/;

const HANDOFF_PAGE = (task) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iBM Lab 文献捕获 · ${task.kind === "pdf" ? "PDF" : "SI"}</title>
<style>
  :root { color-scheme: light; --ink:#17382f; --muted:#70867e; --line:rgba(45,130,101,.22); --accent:#2e8b6d; --bg:#f4f7f6; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:linear-gradient(160deg,#eef4f1,#f8faf9); color:var(--ink); font:14px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  .card { width:min(560px,calc(100vw - 40px)); background:#fff; border:1px solid var(--line); border-radius:16px; padding:30px 34px; box-shadow:0 18px 50px rgba(23,56,47,.08); }
  .logo { width:44px; height:44px; border-radius:12px; display:grid; place-items:center; background:linear-gradient(145deg,#41c797,#27866d); color:#fff; font-weight:800; font-size:18px; margin-bottom:16px; }
  h1 { font-size:19px; margin:0 0 8px; }
  p  { color:var(--muted); margin:0 0 18px; font-size:13px; }
  .state { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:12px; background:#fafcfb; padding:13px 16px; margin-bottom:14px; font-size:13px; }
  .dot { width:10px; height:10px; border-radius:50%; background:#c9d4cf; flex:none; }
  .dot[data-state=armed]   { background:#e4a354; box-shadow:0 0 0 4px rgba(228,163,84,.18); }
  .dot[data-state=working] { background:#2e8b6d; box-shadow:0 0 0 4px rgba(46,139,109,.18); }
  .dot[data-state=ok]      { background:#2e8b6d; }
  .dot[data-state=error]   { background:#c05a5a; }
  .row { display:grid; grid-template-columns:84px 1fr; gap:8px; font-size:12.5px; margin-bottom:6px; }
  .row b { color:var(--muted); font-weight:500; }
  .row span { overflow-wrap:anywhere; }
  .actions { display:flex; gap:9px; margin-top:18px; }
  button { flex:1; border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:10px; padding:11px; font-size:13px; cursor:pointer; }
  button[data-primary] { border-color:transparent; background:linear-gradient(135deg,#41c797,#27866d); color:#fff; font-weight:600; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .error { margin-top:12px; border:1px solid rgba(192,90,90,.28); background:rgba(192,90,90,.06); color:#9c4a4a; border-radius:10px; padding:10px 13px; font-size:12px; white-space:pre-wrap; display:none; }
  .meta { margin-top:16px; padding-top:14px; border-top:1px solid rgba(45,130,101,.12); color:#8aa098; font-size:11px; }
</style>
</head>
<body>
<main class="card">
  <div class="logo">iBM</div>
  <h1>正在通过 Microsoft Edge 捕获${task.kind === "pdf" ? " PDF" : " SI 补充材料"}</h1>
  <p>本页运行在 Microsoft Edge 中，iBM 文献捕获扩展可以在这里布防下载监听。完成后请关闭本标签页。</p>
  <div class="state"><span class="dot" id="dot"></span><span id="stateText">正在准备…</span></div>
  <div class="row"><b>任务</b><span id="taskId">${task.id}</span></div>
  <div class="row"><b>类型</b><span>${task.kind === "pdf" ? "PDF 原文" : "SI 补充材料"}</span></div>
  <div class="row"><b>出版社</b><span id="publisherUrl">${escapeHtml(task.publisherUrl || "")}</span></div>
  <div class="row"><b>有效期至</b><span id="expiresAt"></span></div>
  <div class="actions">
    <button id="retryBtn" data-primary>重试布防</button>
  </div>
  <div class="error" id="error"></div>
  <div class="meta" id="meta"></div>
</main>
<script>
(() => {
  const TASK = ${JSON.stringify(task)};
  const $ = (id) => document.getElementById(id);
  const expires = new Date(TASK.expiresAt || 0);
  $("expiresAt").textContent = Number.isFinite(expires.getTime()) ? expires.toLocaleString() : "—";
  const state = (value) => {
    $("dot").dataset.state = value;
    $("stateText").textContent = {
      armed: "已在扩展中布防，正在打开出版社页面…",
      working: "已捕获匹配下载，正在上传并校验…",
      ok: "捕获完成，文件已归档到课题，可以关闭本标签页",
      error: "捕获失败，请重试或回到客户端查看原因"
    }[value] || "准备中…";
  };
  const showError = (message) => {
    const box = $("error");
    box.textContent = message || "";
    box.style.display = message ? "block" : "none";
  };
  /** 从 location.hash 提取一次性令牌：#t=<token>（fragment 不进历史、不上服务器）。 */
  const tokenFromHash = () => {
    try {
      const params = new URLSearchParams(location.hash.replace(/^#/, ""));
      return params.get("t") || "";
    } catch { return ""; }
  };
  const armCapture = () => new Promise((resolve, reject) => {
    const token = tokenFromHash();
    if (!token) { reject(new Error("缺少一次性捕获令牌。请回到 iBM Lab Agent 客户端重新点击按钮，而不是直接打开本地址。")); return; }
    const uploadUrl = location.origin + "/api/lab-capture-upload?token=" + encodeURIComponent(token);
    const requestId = (globalThis.crypto && globalThis.crypto.randomUUID) ? crypto.randomUUID() : ("capture-" + Date.now());
    let settled = false;
    const finish = (cb, v) => { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener("message", onResult); cb(v); };
    const onResult = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.source !== "ibm-lit-capture-ext" || data.type !== "ARM_CAPTURE_RESULT" || data.requestId !== requestId) return;
      if (data.payload && data.payload.ok) finish(resolve, data.payload);
      else finish(reject, new Error((data.payload && data.payload.error) || "扩展布防失败"));
    };
    const timer = setTimeout(() => finish(reject, new Error("未检测到 iBM 文献下载桥。请在 edge://extensions 确认 0.5.2 或更高版本已安装并重新加载，然后点击重试。")), 8000);
    window.addEventListener("message", onResult);
    try {
      window.postMessage({ source: "ibm-lab-agent", type: "ARM_CAPTURE", requestId, payload: { id: TASK.id, kind: TASK.kind, expiresAt: TASK.expiresAt, uploadUrl } }, location.origin);
    } catch (reason) { finish(reject, reason); }
  });
  const proceed = () => {
    if (!TASK.publisherUrl) { showError("该任务没有登记出版社页面，无法跳转。请回到客户端查看。"); return; }
    location.assign(TASK.publisherUrl);
  };
  const start = async () => {
    showError("");
    state("armed");
    try {
      await armCapture();
      $("retryBtn").textContent = "重新打开出版社页面";
      proceed();
    } catch (reason) {
      state("error");
      showError(String(reason && reason.message ? reason.message : reason));
      $("retryBtn").textContent = "重试布防";
    }
  };
  $("retryBtn").addEventListener("click", () => void start());
  start();
})();
</script>
</body>
</html>
`;

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 判断请求是否来自本机 loopback。 */
export function isLoopbackRequest(req) {
	const host = String(req?.headers?.host ?? "");
	return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
}

export class CaptureHandoffService extends Service {
	static inject = ["labCapture"];

	/** handoff 页面固定路由；测试可借用此常量断言路径。 */
	static HANDOFF_PATH = HANDOFF_PATH;

	constructor(ctx, config = {}) {
		super(ctx, "labCaptureHandoff");
		this.config = config ?? {};
	}

	async [Service.init]() {
		const webServer = this.ctx.get?.("webServer") ?? this.ctx.webServer;
		if (webServer?.register) {
			this.ctx.effect(() => webServer.register({
				kind: "prefix",
				path: HANDOFF_PATH,
				handler: (req, res) => void this.handleHandoff(req, res)
			}), "lab-agent.capture-handoff");
		}
	}

	requireCapture() {
		const capture = this.ctx.labCapture;
		if (!capture) throw new Error("labCapture unavailable");
		return capture;
	}

	/** 从固定 handoff URL 的唯一 taskId 查询参数解析任务 id。 */
	parseTaskId(requestUrl) {
		let url;
		try {
			url = new URL(String(requestUrl ?? ""), "http://localhost");
		} catch {
			return undefined;
		}
		if (url.pathname !== HANDOFF_PATH) return undefined;
		const keys = [...url.searchParams.keys()];
		if (keys.length !== 1 || keys[0] !== "taskId") return undefined;
		const id = url.searchParams.get("taskId") ?? "";
		return CAPTURE_ID_RE.test(id) ? id : undefined;
	}

	async handleHandoff(req, res) {
		try {
			if (!isLoopbackRequest(req)) {
				this.send(res, 403, "text/plain;charset=utf-8", "capture handoff is only served on loopback");
				return;
			}
			const taskId = this.parseTaskId(req.url ?? HANDOFF_PATH);
			if (!taskId) {
				this.send(res, 404, "text/plain;charset=utf-8", "capture task not found");
				return;
			}
			const capture = this.requireCapture();
			const task = capture.getTask(taskId);
			if (!task) {
				this.send(res, 404, "text/plain;charset=utf-8", "capture task not found");
				return;
			}
			const publicTask = {
				id: task.id,
				kind: task.kind,
				expiresAt: task.expiresAt,
				publisherUrl: task.publisherUrl ?? "",
				status: task.status
			};
			const body = HANDOFF_PAGE(publicTask);
			this.send(res, 200, "text/html;charset=utf-8", body);
		} catch (error) {
			this.send(res, 500, "text/plain;charset=utf-8", String(error?.message ?? error ?? "capture handoff failed"));
		}
	}

	send(res, status, contentType, body) {
		const buffer = Buffer.from(body, "utf8");
		res.writeHead(status, {
			"content-type": contentType,
			"content-length": String(buffer.byteLength),
			"cache-control": "no-store",
			"x-content-type-options": "nosniff"
		});
		res.end(buffer);
	}
}

export default CaptureHandoffService;
