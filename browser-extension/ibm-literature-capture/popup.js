/* iBM Lab 文献捕获 — Popup 逻辑：六状态渲染 + 取消按钮。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const stateText = (task) => {
    if (!task) return "未启动";
    const labels = {
      armed: "等待下载",
      uploading: "上传中",
      completed: "完成",
      failed: "失败",
      expired: "已过期",
      cancelled: "已取消"
    };
    return labels[task.status] || task.status;
  };
  const stateTone = (task) => (task ? task.status : "idle");

  function render(task, trustedOrigin) {
    $("trustedOrigin").textContent = trustedOrigin || "尚未设置";
    $("trustHelp").textContent = trustedOrigin
      ? "只有这个站点可以布防；更换服务器时在新页面重新授权。"
      : "请先在 iBM 页面打开此扩展，并点击下方按钮完成一次性授权。";
    const tone = stateTone(task);
    $("stateDot").dataset.state = tone;
    $("stateText").textContent = stateText(task);
    if (!task) {
      $("emptyCard").classList.remove("hidden");
      $("taskCard").classList.add("hidden");
      return;
    }
    $("emptyCard").classList.add("hidden");
    $("taskCard").classList.remove("hidden");
    $("taskId").textContent = task.id || "—";
    $("taskKind").textContent = task.kind === "si" ? "SI 补充材料" : "PDF 原文";
    $("taskExpires").textContent = task.expiresAt ? new Date(task.expiresAt).toLocaleString() : "—";
    $("taskFile").textContent = task.fileName || "—";
    const error = task.error || "";
    $("taskError").textContent = error;
    $("taskError").classList.toggle("hidden", !error);
    // 只有等待下载时可取消
    $("cancelBtn").classList.toggle("hidden", task.status !== "armed");
  }

  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      render(response?.ok ? response.task : null, response?.trustedOrigin || "");
    } catch {
      render(null, "");
    }
  }

  $("cancelBtn").addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: "CANCEL_CAPTURE" });
      await refresh();
    } catch (error) {
      $("taskError").textContent = String(error?.message || error);
      $("taskError").classList.remove("hidden");
    }
  });

  $("trustBtn").addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
        throw new Error("请先打开 iBM 网页，再点击扩展图标进行授权");
      }
      const origin = new URL(tab.url).origin;
      const currentUrl = new URL(tab.url);
      const pattern = `${currentUrl.protocol}//${currentUrl.hostname}/*`;
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error("未授予当前站点访问权限");
      const response = await chrome.runtime.sendMessage({ type: "SET_TRUSTED_ORIGIN", origin });
      if (!response?.ok) throw new Error(response?.error || "保存可信站点失败");
      // 动态注册的 content script 默认只会在后续导航时运行。当前页面无需刷新，
      // 直接注入即可立即接收“下载 PDF/SI”的布防消息；content.js 自带幂等保护。
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await refresh();
    } catch (error) {
      $("taskError").textContent = String(error?.message || error);
      $("taskError").classList.remove("hidden");
      $("taskCard").classList.remove("hidden");
      $("emptyCard").classList.add("hidden");
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.ibmCaptureTask || changes.ibmTrustedOrigin)) {
      void refresh();
    }
  });

  void refresh();
})();
