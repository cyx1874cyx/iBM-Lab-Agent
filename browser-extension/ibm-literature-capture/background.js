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

// ── 状态持久化（SW 可能被随时杀死，任务必须落 storage）──────────────────
function loadTask() {
  return chrome.storage.local.get(STATE_KEY).then((data) => data[STATE_KEY] || null);
}
function saveTask(task) {
  return chrome.storage.local.set({ [STATE_KEY]: task });
}
async function updateTask(patch) {
  const task = await loadTask();
  if (!task) return null;
  const next = { ...task, ...patch, updatedAt: Date.now() };
  await saveTask(next);
  return next;
}
async function clearTask() {
  await chrome.storage.local.remove(STATE_KEY);
}

// ── 页面通知（经 content script → window.postMessage 回给 iBM 页面）────────
function notifyPages(message) {
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }).catch(() => {});
}

const KIND_EXTENSIONS = {
  pdf: ["pdf"],
  si: ["pdf", "zip", "docx", "xlsx", "csv", "txt", "cif", "sdf"]
};
function matchesKind(kind, fileName) {
  const list = KIND_EXTENSIONS[kind];
  if (!list) return false;
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  return list.includes(ext);
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
  await updateTask({ status: "expired", error: "捕获任务已过期" });
  updateBadge();
  notifyPages({ type: "CAPTURE_FAILED", payload: { error: "捕获任务已过期，请重新点击按钮" } });
}

async function failTask(message) {
  await updateTask({ status: "failed", error: String(message || "未知错误") });
  updateBadge();
}

// ── 布防 ────────────────────────────────────────────────────────────────
async function handleArm(payload, sender) {
  const existing = await loadTask();
  if (existing && existing.status === "armed" && !isExpired(existing)) {
    return { ok: false, error: `已有一个待捕获任务（${existing.id}，${existing.kind.toUpperCase()}）；请先完成或取消` };
  }
  const uploadUrl = String(payload?.uploadUrl || "");
  if (!uploadUrl || !/^https?:\/\//.test(uploadUrl)) {
    return { ok: false, error: "布防失败：缺少合法的上传地址" };
  }
  const task = {
    id: String(payload?.id || ""),
    kind: String(payload?.kind || "") === "si" ? "si" : "pdf",
    uploadUrl,
    expiresAt: payload?.expiresAt || new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    status: "armed",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (!task.id) return { ok: false, error: "布防失败：缺少任务编号" };
  await saveTask(task);
  updateBadge();
  scheduleExpiry();
  return { ok: true, task };
}

async function handleCancel() {
  const task = await loadTask();
  if (!task) return { ok: false, error: "当前没有进行中的捕获任务" };
  await updateTask({ status: "cancelled", error: "用户已取消捕获" });
  updateBadge();
  notifyPages({ type: "CAPTURE_FAILED", payload: { error: "捕获已取消" } });
  return { ok: true };
}

// ── 下载监听：只在 armed 时处理布防之后的下一份匹配下载 ──────────────────
chrome.downloads.onChanged.addListener((delta) => {
  void (async () => {
    const task = await loadTask();
    if (!task || task.status !== "armed") return;
    if (delta.state) {
      if (delta.state.current === "interrupted") {
        await failTask("下载被中断，请重新点击按钮布防");
        notifyPages({ type: "CAPTURE_FAILED", payload: { error: "下载被中断，请重新点击按钮布防" } });
        return;
      }
      if (delta.state.current !== "complete") return;
    }
    const items = await chrome.downloads.search({ id: delta.id });
    const item = items?.[0];
    if (!item) return;
    // 只捕获匹配类型的下载；不匹配就继续等待下一份（不取消布防）。
    if (!matchesKind(task.kind, item.filename)) return;
    // 布防后出现的第一份匹配下载才捕获：立即置 uploading，避免重入。
    if ((await loadTask())?.status !== "armed") return;
    await updateTask({ status: "uploading", fileName: item.filename, size: item.fileSize || 0 });
    updateBadge();
    notifyPages({ type: "CAPTURE_UPLOADING", payload: { taskId: task.id } });
    try {
      const result = await uploadViaBridge(task, item);
      if (!result || result.ok !== true) {
        throw new Error(result?.error || "本地桥接上传失败");
      }
      await updateTask({ status: "completed", fileName: item.filename, size: item.fileSize || 0 });
      updateBadge();
      notifyPages({ type: "CAPTURE_COMPLETED", payload: { taskId: task.id, fileName: item.filename } });
    } catch (error) {
      await failTask(error?.message || String(error));
      notifyPages({ type: "CAPTURE_FAILED", payload: { error: error?.message || String(error) } });
    }
  })();
});

/**
 * 上传：经 Native Messaging 交给本地桥接（读取 file:// + PUT 上传）。
 * 桥接只接收一次性上传地址、任务编号与下载文件相对路径。
 */
function uploadViaBridge(task, item) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative("com.ibm.lab.capture");
    } catch (error) {
      reject(new Error("无法连接本地桥接程序。请在扩展目录 native-bridge 下运行：python install-bridge.py <扩展id>，再刷新扩展"));
      return;
    }
    const timer = setTimeout(() => {
      try { port.disconnect(); } catch { /* noop */ }
      reject(new Error("本地桥接上传超时（5 分钟）"));
    }, 5 * 60 * 1000);
    port.onMessage.addListener((message) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch { /* noop */ }
      resolve(message);
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      const detail = chrome.runtime.lastError?.message || "";
      if (/not found/i.test(detail)) {
        reject(new Error("本地桥接未注册：请在扩展目录 native-bridge 下运行 python install-bridge.py <扩展id>（id 在 chrome://extensions 查看），再刷新扩展"));
      } else if (detail) {
        reject(new Error("本地桥接连接已断开：" + detail));
      }
    });
    port.postMessage({
      cmd: "upload",
      taskId: task.id,
      uploadUrl: task.uploadUrl,
      relativePath: String(item.filename || ""),
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
    loadTask().then((task) => sendResponse({ ok: true, task })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
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
void loadTask().then((task) => {
  if (task && isExpired(task)) {
    void expireTask();
  } else {
    updateBadge();
    scheduleExpiry();
  }
});
