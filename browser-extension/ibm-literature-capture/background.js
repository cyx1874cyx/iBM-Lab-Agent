/**
 * iBM Lab 文献捕获 — Service Worker（MV3）。
 *
 * 安全设计：
 *   - 只有收到 iBM 页面明确的 ARM_CAPTURE 消息后才开始监听下载；
 *   - 一次只允许一个待捕获任务（armed）；任务完成/失败/过期/取消后立即清理；
 *   - 只捕获布防之后出现的下一份**匹配**下载（PDF 任务只匹配 .pdf，SI 任务
 *     匹配允许的补充材料类型），不匹配的下载不处理、也不重新布防；
 *   - 文件读取与上传交给 Native Messaging 本地桥接（Chrome 扩展 SW 无法
 *     读取 file://，downloads API 也只返回相对路径）；桥接只接收一次性上传
 *     地址、任务编号与下载文件相对路径，不接触 Cookie/历史/其他文件。
 */

const STATE_KEY = "ibmCaptureTask";
const TRUSTED_ORIGIN_KEY = "ibmTrustedOrigin";
const PENDING_TRUST_KEY = "ibmPendingTrustedOrigin";
const CONTENT_SCRIPT_ID = "ibm-literature-capture-trusted";
const CAPTURE_UPLOAD_PATH = "/api/lab-capture-upload";

function normalizedWebOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function permissionPatternForOrigin(origin) {
  const url = new URL(origin);
  // Chrome match patterns do not carry ports; 后台仍以完整 origin（含端口）做精确校验。
  return `${url.protocol}//${url.hostname}/*`;
}

async function loadTrustedOrigin() {
  const data = await chrome.storage.local.get(TRUSTED_ORIGIN_KEY);
  return normalizedWebOrigin(data[TRUSTED_ORIGIN_KEY]);
}

async function registerTrustedContentScript(origin) {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => []);
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (!origin) return;
  const matches = [permissionPatternForOrigin(origin)];
  const permitted = await chrome.permissions.contains({ origins: matches });
  if (!permitted) throw new Error("可信站点尚未授予扩展访问权限，请从扩展弹窗重新授权");
  await chrome.scripting.registerContentScripts([{
    id: CONTENT_SCRIPT_ID,
    matches,
    js: ["content.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true
  }]);
}

async function setTrustedOrigin(value) {
  const origin = normalizedWebOrigin(value);
  if (!origin) throw new Error("可信站点必须是 HTTP/HTTPS 地址");
  const currentTask = await loadTask();
  if (currentTask?.status === "uploading") throw new Error("文献正在上传，完成后才能更换可信站点");
  if (currentTask?.status === "armed") {
    await updateTask({ status: "cancelled", error: "可信站点已更换，旧布防作废" }, currentTask.id);
  }
  await chrome.storage.local.set({ [TRUSTED_ORIGIN_KEY]: origin });
  await registerTrustedContentScript(origin);
  return origin;
}

async function prepareTrustedOrigin(value, tabId) {
  const origin = normalizedWebOrigin(value);
  if (!origin || !Number.isInteger(tabId)) throw new Error("无法识别当前 iBM 页面");
  const tab = await chrome.tabs.get(tabId);
  if (normalizedWebOrigin(tab?.url) !== origin) throw new Error("当前标签页地址已变化，请重新授权");
  await chrome.storage.local.set({
    [PENDING_TRUST_KEY]: { origin, tabId, createdAt: Date.now() }
  });
  return { origin, pattern: permissionPatternForOrigin(origin) };
}

let trustFinalization = null;
async function completeTrustedOrigin(value, tabId) {
  if (trustFinalization) return trustFinalization;
  trustFinalization = (async () => {
    const origin = normalizedWebOrigin(value);
    if (!origin) throw new Error("可信站点必须是 HTTP/HTTPS 地址");
    const pattern = permissionPatternForOrigin(origin);
    if (!await chrome.permissions.contains({ origins: [pattern] })) {
      throw new Error("当前站点访问权限尚未授予");
    }
    const trustedOrigin = await setTrustedOrigin(origin);
    let warning = "";
    if (Number.isInteger(tabId)) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (normalizedWebOrigin(tab?.url) === trustedOrigin) {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        } else {
          warning = "页面地址已变化；重新打开 iBM 页面后桥接会自动生效";
        }
      } catch (error) {
        warning = `当前页面即时启用失败：${error?.message || error}；重新打开页面后会自动生效`;
      }
    }
    await chrome.storage.local.remove(PENDING_TRUST_KEY);
    return { trustedOrigin, warning };
  })();
  try {
    return await trustFinalization;
  } finally {
    trustFinalization = null;
  }
}

async function completePendingTrustedOrigin() {
  const data = await chrome.storage.local.get(PENDING_TRUST_KEY);
  const pending = data[PENDING_TRUST_KEY];
  if (!pending) return null;
  if (!pending.createdAt || Date.now() - pending.createdAt > 5 * 60 * 1000) {
    await chrome.storage.local.remove(PENDING_TRUST_KEY);
    return null;
  }
  const origin = normalizedWebOrigin(pending.origin);
  if (!origin || !await chrome.permissions.contains({ origins: [permissionPatternForOrigin(origin)] })) return null;
  return completeTrustedOrigin(origin, pending.tabId);
}

function validateUploadUrl(raw, trustedOrigin) {
  let url;
  try { url = new URL(String(raw || "")); } catch { throw new Error("布防失败：上传地址格式无效"); }
  if (url.origin !== trustedOrigin || url.pathname !== CAPTURE_UPLOAD_PATH) {
    throw new Error("布防失败：上传地址不是可信 iBM 站点的捕获接口");
  }
  if (!url.searchParams.get("token")) throw new Error("布防失败：上传地址缺少一次性令牌");
  return url.href;
}

// ── 状态持久化（SW 可能被随时杀死，任务必须落 storage）──────────────────
function loadTask() {
  return chrome.storage.local.get(STATE_KEY).then((data) => data[STATE_KEY] || null);
}
function saveTask(task) {
  return chrome.storage.local.set({ [STATE_KEY]: task });
}
async function updateTask(patch, expectedTaskId) {
  const task = await loadTask();
  if (!task) return null;
  if (expectedTaskId && task.id !== expectedTaskId) return null;
  const next = { ...task, ...patch, updatedAt: Date.now() };
  await saveTask(next);
  return next;
}
async function clearTask() {
  await chrome.storage.local.remove(STATE_KEY);
}

// ── 页面通知（经 content script → window.postMessage 回给 iBM 页面）────────
function notifyTaskPage(task, message) {
  if (!Number.isInteger(task?.armTabId)) return;
  chrome.tabs.sendMessage(task.armTabId, message).catch(() => {});
}

const KIND_EXTENSIONS = {
  pdf: ["pdf"],
  si: ["pdf", "zip", "docx", "xlsx", "csv", "txt", "cif", "sdf"]
};
function matchesKind(kind, item) {
  const list = KIND_EXTENSIONS[kind];
  if (!list) return false;
  const fileName = String(item?.filename || "");
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  if (!list.includes(ext)) return false;
  if (kind !== "si" || ext !== "pdf") return true;
  const haystack = [fileName, item?.url, item?.finalUrl].filter(Boolean).join(" ").toLowerCase();
  return /(?:supp(?:lement(?:ary)?)?|support(?:ing)?|[_-]si(?:[_\-.]|$)|esm|moesm|mmc\d*|supinfo|additional[_-]?file|[_-]s\d{3}\.pdf)/i.test(haystack);
}

function isExpired(task, now = Date.now()) {
  return task.status === "armed" && task.expiresAt && new Date(task.expiresAt).getTime() <= now;
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
  const current = await loadTask();
  if (!current || !isExpired(current)) return;
  const task = await updateTask({ status: "expired", error: "捕获任务已过期" }, current.id);
  updateBadge();
  notifyTaskPage(task, { type: "CAPTURE_FAILED", payload: { taskId: task?.id, error: "捕获任务已过期，请重新点击按钮" } });
}

async function failTask(message, taskId) {
  await updateTask({ status: "failed", error: String(message || "未知错误") }, taskId);
  updateBadge();
}

// ── 布防 ────────────────────────────────────────────────────────────────
async function handleArm(payload, sender) {
  const trustedOrigin = await loadTrustedOrigin();
  const senderOrigin = normalizedWebOrigin(sender?.tab?.url);
  if (!trustedOrigin) return { ok: false, error: "请先打开扩展弹窗并信任当前 iBM 页面" };
  if (!Number.isInteger(sender?.tab?.id) || sender?.frameId !== 0 || senderOrigin !== trustedOrigin) {
    return { ok: false, error: "布防失败：消息不是来自可信 iBM 页面" };
  }
  const existing = await loadTask();
  // 用户再次点击按钮 = 重新捕获意图：作废旧布防（服务端也已作废旧任务，
  // 旧 token 已失效），接受新布防。仍保持「一次只允许一个待捕获任务」。
  if (existing && existing.status === "armed" && !isExpired(existing)) {
    await updateTask({ status: "cancelled", error: "用户重新发起捕获，旧布防作废" }, existing.id);
  } else if (existing?.status === "uploading") {
    return { ok: false, error: "上一份文献仍在上传，请完成后再布防新任务" };
  }
  let uploadUrl;
  try { uploadUrl = validateUploadUrl(payload?.uploadUrl, trustedOrigin); }
  catch (error) { return { ok: false, error: error.message }; }
  const kind = String(payload?.kind || "");
  if (!KIND_EXTENSIONS[kind]) return { ok: false, error: "布防失败：捕获类型必须是 PDF 或 SI" };
  const expiresAtMs = new Date(payload?.expiresAt || "").getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 30 * 60 * 1000) {
    return { ok: false, error: "布防失败：任务到期时间无效" };
  }
  const task = {
    id: String(payload?.id || ""),
    kind,
    uploadUrl,
    expiresAt: new Date(expiresAtMs).toISOString(),
    status: "armed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    armTabId: sender.tab.id,
    trustedOrigin
  };
  if (!task.id) return { ok: false, error: "布防失败：缺少任务编号" };
  await saveTask(task);
  updateBadge();
  scheduleExpiry();
  return { ok: true, taskId: task.id };
}

async function handleCancel() {
  const task = await loadTask();
  if (!task) return { ok: false, error: "当前没有进行中的捕获任务" };
  await updateTask({ status: "cancelled", error: "用户已取消捕获" }, task.id);
  updateBadge();
  notifyTaskPage(task, { type: "CAPTURE_FAILED", payload: { taskId: task.id, error: "捕获已取消" } });
  return { ok: true };
}

// ── 下载监听：只在 armed 时处理布防之后的下一份匹配下载 ──────────────────
let activeUploadTaskId = null;
chrome.downloads.onChanged.addListener((delta) => {
  void (async () => {
    const task = await loadTask();
    if (!task || task.status !== "armed") return;
    if (task.trustedOrigin !== await loadTrustedOrigin()) {
      await failTask("可信站点已变化，请重新点击按钮布防", task.id);
      return;
    }
    const state = delta.state?.current;
    if (state !== "complete" && state !== "interrupted") return;
    const items = await chrome.downloads.search({ id: delta.id });
    const item = items?.[0];
    if (!item) return;
    const startedAt = new Date(item.startTime || 0).getTime();
    if (!Number.isFinite(startedAt) || startedAt + 1000 < task.createdAt) return;
    // 只捕获匹配类型的下载；不匹配就继续等待下一份（不取消布防）。
    if (!matchesKind(task.kind, item)) return;
    if (state === "interrupted") {
      await failTask("匹配的下载被中断，请重新点击按钮布防", task.id);
      notifyTaskPage(task, { type: "CAPTURE_FAILED", payload: { taskId: task.id, error: "匹配的下载被中断，请重新点击按钮布防" } });
      return;
    }
    // 布防后出现的第一份匹配下载才捕获：立即置 uploading，避免重入。
    if (activeUploadTaskId) return;
    activeUploadTaskId = task.id;
    if ((await loadTask())?.status !== "armed") {
      activeUploadTaskId = null;
      return;
    }
    try {
      await updateTask({ status: "uploading", fileName: item.filename, size: item.fileSize || 0 }, task.id);
      updateBadge();
      notifyTaskPage(task, { type: "CAPTURE_UPLOADING", payload: { taskId: task.id } });
      const result = await uploadViaBridge(task, item);
      if (!result || result.ok !== true) {
        throw new Error(result?.error || "本地桥接上传失败");
      }
      await updateTask({ status: "completed", fileName: item.filename, size: item.fileSize || 0 }, task.id);
      updateBadge();
      notifyTaskPage(task, { type: "CAPTURE_COMPLETED", payload: { taskId: task.id, fileName: item.filename } });
    } catch (error) {
      await failTask(error?.message || String(error), task.id);
      notifyTaskPage(task, { type: "CAPTURE_FAILED", payload: { taskId: task.id, error: error?.message || String(error) } });
    } finally {
      activeUploadTaskId = null;
    }
  })();
});

/**
 * 上传：经 Native Messaging 交给本地桥接（读取 file:// + PUT 上传）。
 * 桥接只接收一次性上传地址、任务编号与 Chrome 返回的绝对下载路径；桥接会再次
 * 校验该路径必须位于批准的下载目录内。
 */
function uploadViaBridge(task, item) {
  return new Promise((resolve, reject) => {
    let port;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    try {
      port = chrome.runtime.connectNative("com.ibm.lab.capture");
    } catch (error) {
      reject(new Error("无法连接本地桥接程序。请在扩展目录 native-bridge 下运行：python install-bridge.py <扩展id>，再刷新扩展"));
      return;
    }
    const timer = setTimeout(() => {
      finish(reject, new Error("本地桥接上传超时（5 分钟）"));
      try { port.disconnect(); } catch { /* noop */ }
    }, 5 * 60 * 1000);
    port.onMessage.addListener((message) => {
      finish(resolve, message);
      try { port.disconnect(); } catch { /* noop */ }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      const detail = chrome.runtime.lastError?.message || "";
      if (/not found/i.test(detail)) {
        finish(reject, new Error("本地桥接未注册：请在扩展目录 native-bridge 下运行 python install-bridge.py <扩展id>（id 在 chrome://extensions 查看），再刷新扩展"));
      } else if (detail) {
        finish(reject, new Error("本地桥接连接已断开：" + detail));
      } else {
        finish(reject, new Error("本地桥接未返回结果即断开"));
      }
    });
    port.postMessage({
      cmd: "upload",
      taskId: task.id,
      uploadUrl: task.uploadUrl,
      downloadPath: String(item.filename || ""),
      fileName: String(item.filename || "").split("/").pop()?.split("\\").pop() || "download.bin"
    });
  });
}

// ── 消息入口 ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (type === "ARM_CAPTURE") {
    handleArm(message.payload, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "CANCEL_CAPTURE") {
    handleCancel().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "GET_STATE") {
    Promise.all([loadTask(), loadTrustedOrigin()])
      .then(([task, trustedOrigin]) => sendResponse({ ok: true, task, trustedOrigin }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "SET_TRUSTED_ORIGIN") {
    if (sender?.tab) {
      sendResponse({ ok: false, error: "可信站点只能从扩展弹窗设置" });
      return false;
    }
    completeTrustedOrigin(message.origin, message.tabId)
      .then(({ trustedOrigin, warning }) => sendResponse({ ok: true, trustedOrigin, warning }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "PREPARE_TRUSTED_ORIGIN") {
    if (sender?.tab) {
      sendResponse({ ok: false, error: "可信站点只能从扩展弹窗设置" });
      return false;
    }
    prepareTrustedOrigin(message.origin, message.tabId)
      .then((prepared) => sendResponse({ ok: true, ...prepared }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (type === "CANCEL_PENDING_TRUST") {
    chrome.storage.local.remove(PENDING_TRUST_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

// Chrome 的权限确认框可能关闭扩展弹窗。授权信息预先持久化后，即使弹窗被销毁，
// Service Worker 仍会在权限加入时完成注册与当前页面注入。
chrome.permissions.onAdded.addListener(() => {
  void completePendingTrustedOrigin().catch(() => {});
});

// ── Badge：armed=布防中 / uploading=上传中 / 其他=清空 ──────────────────
async function updateBadge() {
  const task = await loadTask();
  if (!task) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const labels = { armed: "等待", uploading: "上传" };
  chrome.action.setBadgeText({ text: labels[task.status] || "" });
  chrome.action.setBadgeBackgroundColor({ color: task.status === "armed" ? "#27866d" : "#c0802a" });
}

// 启动时：恢复存储中的任务（含过期判定）并设置徽标与到期定时器。
chrome.runtime.onStartup.addListener(() => {
  void loadTrustedOrigin().then(registerTrustedContentScript).catch(() => {});
  void loadTask().then((task) => {
    if (!task) return;
    if (isExpired(task)) {
      void expireTask();
      return;
    }
    updateBadge();
    scheduleExpiry();
  });
});
chrome.runtime.onInstalled.addListener(() => {
  void loadTrustedOrigin().then(registerTrustedContentScript).catch(() => {});
});
void loadTrustedOrigin().then(registerTrustedContentScript).catch(() => {});
void loadTask().then((task) => {
  if (task && isExpired(task)) {
    void expireTask();
  } else {
    updateBadge();
    scheduleExpiry();
  }
});
