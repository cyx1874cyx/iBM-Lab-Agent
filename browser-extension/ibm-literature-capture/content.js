/**
 * iBM Lab 文献捕获 — content script。
 * 单向布防桥：本机 handoff 页面（window.postMessage）→ 扩展 Service Worker。
 * 本文件只会由 manifest 注入 127.0.0.1/localhost 的 /lab/capture/* 页面；
 * 不注入出版社、机构或普通 iBM 页面，也不读取 Cookie/凭据。
 */
(() => {
  if (globalThis.__ibmLiteratureCaptureContentLoaded) return;
  globalThis.__ibmLiteratureCaptureContentLoaded = true;

  // handoff 页面 → SW：只允许布防下一次下载捕获。
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "ibm-lab-agent") return;
    const requestId = String(data.requestId || "");
    if (!requestId) return;
    const reply = (type, payload) => window.postMessage({
      source: "ibm-lit-capture-ext",
      type,
      requestId,
      payload
    }, location.origin);
    if (data.type === "ARM_CAPTURE") {
      chrome.runtime.sendMessage({ type: "ARM_CAPTURE", payload: data.payload })
        .then((response) => {
          reply("ARM_CAPTURE_RESULT", response?.ok
            ? { ok: true, taskId: response.taskId }
            : { ok: false, error: response?.error || "扩展布防失败" });
        })
        .catch((error) => {
          reply("ARM_CAPTURE_RESULT", { ok: false, error: String(error?.message || error || "扩展不可用") });
        });
      return;
    }
    // 其他页面消息一律忽略。
  });
})();
