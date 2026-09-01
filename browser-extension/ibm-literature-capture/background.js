/**
 * iBM Lab 文献捕获 — 桌面应用专用下载桥（MV3 Service Worker）。
 *
 * 唯一职责：
 *   1. 接受本机 /lab/capture/?taskId=<taskId> handoff 页的一次性布防；
 *   2. 监听布防后出现的下一份匹配 PDF/SI 下载；
 *   3. 通过 Native Messaging 把文件上传给桌面应用的 loopback 捕获接口，
 *      由服务端归档到任务绑定的项目目录。
 *
 * 扩展不管理可信网页、不注入出版社页面、不保存 PPTX/DOCX、不读取 Cookie、
 * 浏览历史或未布防的下载文件。
 */

const STATE_KEY = "ibmCaptureTask";
const CAPTURE_UPLOAD_PATH = "/api/lab-capture-upload";
const CAPTURE_TASK_RE = /^capture-[a-z0-9]+$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function parseUrl(value) {
  try { return new URL(String(value || "")); } catch { return null; }
}

function isLoopbackUrl(url) {
  return !!url && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

function validateHandoffSender(sender, taskId) {
  if (!Number.isInteger(sender?.tab?.id) || sender?.frameId !== 0) {
    throw new Error("布防失败：请求不是来自桌面 handoff 顶层页面");
  }
  const senderUrl = parseUrl(sender.tab.url);
  if (!isLoopbackUrl(senderUrl) || senderUrl.username || senderUrl.password) {
    throw new Error("布防失败：只接受桌面应用的本机 handoff 页面");
  }
  const queryKeys = [...senderUrl.searchParams.keys()];
  if (!CAPTURE_TASK_RE.test(taskId)
      || senderUrl.pathname !== "/lab/capture/"
      || queryKeys.length !== 1
      || queryKeys[0] !== "taskId"
      || senderUrl.searchParams.get("taskId") !== taskId) {
    throw new Error("布防失败：handoff 页面与任务编号不匹配");
  }
  return senderUrl;
}

function validateUploadUrl(raw, senderUrl) {
  const url = parseUrl(raw);
  if (!isLoopbackUrl(url) || url.origin !== senderUrl.origin || url.pathname !== CAPTURE_UPLOAD_PATH) {
    throw new Error("布防失败：上传地址不是当前桌面应用的捕获接口");
  }
  if (url.username || url.password || url.hash) throw new Error("布防失败：上传地址含有未授权部分");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "token" || !url.searchParams.get("token")) {
    throw new Error("布防失败：上传地址必须只包含一次性令牌");
  }
  return url.href;
}

function loadTask() {
  return chrome.storage.local.get(STATE_KEY).then((data) => data[STATE_KEY] || null);
}

function saveTask(task) {
  return chrome.storage.local.set({ [STATE_KEY]: task });
}

async function updateTask(patch, expectedTaskId) {
  const task = await loadTask();
  if (!task || (expectedTaskId && task.id !== expectedTaskId)) return null;
  const next = { ...task, ...patch, updatedAt: Date.now() };
  await saveTask(next);
  return next;
}

const KIND_EXTENSIONS = {
  pdf: ["pdf"],
  si: ["pdf", "zip", "docx", "xlsx", "csv", "txt", "cif", "sdf"]
};

function matchesKind(kind, item) {
  const extensions = KIND_EXTENSIONS[kind];
  if (!extensions) return false;
  const fileName = String(item?.filename || "");
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  if (!extensions.includes(extension)) return false;
  if (kind !== "si" || extension !== "pdf") return true;
  const evidence = [fileName, item?.url, item?.finalUrl].filter(Boolean).join(" ").toLowerCase();
  return /(?:supp(?:lement(?:ary)?)?|support(?:ing)?|[_-]si(?:[_\-.]|$)|esm|moesm|mmc\d*|supinfo|additional[_-]?file|[_-]s\d{3}\.pdf)/i.test(evidence);
}

function isExpired(task, now = Date.now()) {
  return task?.status === "armed" && task.expiresAt && new Date(task.expiresAt).getTime() <= now;
}

let expiryTimer = null;
function scheduleExpiry() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  void loadTask().then((task) => {
    if (!task || task.status !== "armed" || !task.expiresAt) return;
    const remaining = new Date(task.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      void expireTask();
      return;
    }
    expiryTimer = setTimeout(() => void expireTask(), Math.min(remaining, 2_147_000_000));
  });
}

async function expireTask() {
  const task = await loadTask();
  if (isExpired(task)) {
    await updateTask({ status: "expired", error: "捕获任务已过期，请从桌面应用重新点击" }, task.id);
    await updateBadge();
  }
}

async function failTask(message, taskId) {
  await updateTask({ status: "failed", error: String(message || "未知错误") }, taskId);
  await updateBadge();
}

async function handleArm(payload, sender) {
  const taskId = String(payload?.id || "");
  let senderUrl;
  let uploadUrl;
  try {
    senderUrl = validateHandoffSender(sender, taskId);
    uploadUrl = validateUploadUrl(payload?.uploadUrl, senderUrl);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const kind = String(payload?.kind || "");
  if (!KIND_EXTENSIONS[kind]) return { ok: false, error: "布防失败：捕获类型必须是 PDF 或 SI" };
  const expiresAtMs = new Date(payload?.expiresAt || "").getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 30 * 60 * 1000) {
    return { ok: false, error: "布防失败：任务到期时间无效" };
  }

  const existing = await loadTask();
  if (existing?.status === "uploading") return { ok: false, error: "上一份文献仍在归档，请稍后重试" };
  if (existing?.status === "armed") {
    await updateTask({ status: "cancelled", error: "桌面应用已发起新任务，旧布防作废" }, existing.id);
  }

  const task = {
    id: taskId,
    kind,
    uploadUrl,
    expiresAt: new Date(expiresAtMs).toISOString(),
    status: "armed",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveTask(task);
  await updateBadge();
  scheduleExpiry();
  return { ok: true, taskId };
}

async function handleCancel() {
  const task = await loadTask();
  if (!task || task.status !== "armed") return { ok: false, error: "当前没有等待中的捕获任务" };
  await updateTask({ status: "cancelled", error: "用户已取消捕获" }, task.id);
  await updateBadge();
  return { ok: true };
}

function requestNativeBridge(message) {
  return new Promise((resolve, reject) => {
    let port;
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    try {
      port = chrome.runtime.connectNative("com.ibm.lab.capture");
    } catch {
      reject(new Error("无法连接桌面桥接程序；请退出并重新启动 iBM Lab Agent"));
      return;
    }
    timer = setTimeout(() => {
      finish(reject, new Error("桌面桥接归档超时（5 分钟）"));
      try { port.disconnect(); } catch { /* noop */ }
    }, 5 * 60 * 1000);
    port.onMessage.addListener((response) => {
      finish(resolve, response);
      try { port.disconnect(); } catch { /* noop */ }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      const detail = chrome.runtime.lastError?.message || "";
      finish(reject, new Error(detail
        ? `桌面桥接连接已断开：${detail}；请重启 iBM Lab Agent`
        : "桌面桥接未返回结果即断开"));
    });
    port.postMessage(message);
  });
}

function uploadViaBridge(task, item) {
  const downloadPath = String(item.filename || "");
  return requestNativeBridge({
    cmd: "upload",
    taskId: task.id,
    uploadUrl: task.uploadUrl,
    downloadPath,
    fileName: downloadPath.split("/").pop()?.split("\\").pop() || "download.bin"
  });
}

let activeUploadTaskId = null;
chrome.downloads.onChanged.addListener((delta) => {
  void (async () => {
    const task = await loadTask();
    if (!task || task.status !== "armed") return;
    const state = delta.state?.current;
    if (state !== "complete" && state !== "interrupted") return;
    const item = (await chrome.downloads.search({ id: delta.id }))?.[0];
    if (!item) return;
    const startedAt = new Date(item.startTime || 0).getTime();
    if (!Number.isFinite(startedAt) || startedAt + 1000 < task.createdAt || !matchesKind(task.kind, item)) return;
    if (state === "interrupted") {
      await failTask("匹配的下载被中断，请从桌面应用重新点击", task.id);
      return;
    }
    if (activeUploadTaskId) return;
    activeUploadTaskId = task.id;
    try {
      if ((await loadTask())?.status !== "armed") return;
      await updateTask({ status: "uploading", fileName: item.filename, size: item.fileSize || 0 }, task.id);
      await updateBadge();
      const result = await uploadViaBridge(task, item);
      if (!result || result.ok !== true) throw new Error(result?.error || "桌面桥接归档失败");
      await updateTask({ status: "completed", fileName: item.filename, size: item.fileSize || 0, error: "" }, task.id);
      await updateBadge();
    } catch (error) {
      await failTask(error?.message || String(error), task.id);
    } finally {
      activeUploadTaskId = null;
    }
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARM_CAPTURE") {
    handleArm(message.payload, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "CANCEL_CAPTURE") {
    handleCancel().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GET_STATE") {
    loadTask().then((task) => sendResponse({ ok: true, task })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

async function updateBadge() {
  const task = await loadTask();
  const labels = { armed: "等待", uploading: "归档" };
  await chrome.action.setBadgeText({ text: labels[task?.status] || "" });
  if (labels[task?.status]) {
    await chrome.action.setBadgeBackgroundColor({ color: task.status === "armed" ? "#27866d" : "#c0802a" });
  }
}

function restoreState() {
  void loadTask().then((task) => {
    if (isExpired(task)) void expireTask();
    else {
      void updateBadge();
      scheduleExpiry();
    }
  });
}

chrome.runtime.onStartup.addListener(restoreState);
chrome.runtime.onInstalled.addListener(restoreState);
restoreState();
