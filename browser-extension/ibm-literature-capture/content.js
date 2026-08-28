/**
 * iBM Lab 文献捕获 — content script。
 * 双向桥：iBM 页面（window.postMessage）↔ 扩展 Service Worker（chrome.runtime）。
 * 只转发用户主动发起的 ARM_CAPTURE 布防消息与扩展的上传结果通知，
 * 不注入任何公众号链接，也不读取页面 Cookie/凭据。
 */
(() => {
  // 页面 → SW：布防下一次下载捕获
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "ibm-lab-agent" || data.type !== "ARM_CAPTURE") return;
    const requestId = String(data.requestId || "");
    const reply = (payload) => window.postMessage({
      source: "ibm-lit-capture-ext",
      type: "ARM_CAPTURE_RESULT",
      requestId,
      payload
    }, location.origin);
    chrome.runtime.sendMessage({ type: "ARM_CAPTURE", payload: data.payload })
      .then((response) => {
        reply(response?.ok
          ? { ok: true, taskId: response.taskId }
          : { ok: false, error: response?.error || "扩展布防失败" });
      })
      .catch((error) => {
        reply({ ok: false, error: String(error?.message || error || "扩展不可用") });
      });
  });

  // SW → 页面：上传完成/失败/进行中
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (["CAPTURE_COMPLETED", "CAPTURE_FAILED", "CAPTURE_UPLOADING"].includes(message.type)) {
      window.postMessage({ source: "ibm-lit-capture-ext", type: message.type, payload: message.payload || {} }, location.origin);
    }
  });
})();
