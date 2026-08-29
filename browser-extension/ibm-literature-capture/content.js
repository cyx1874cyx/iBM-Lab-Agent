/**
 * iBM Lab 文献捕获 — content script。
 * 双向桥：iBM 页面（window.postMessage）↔ 扩展 Service Worker（chrome.runtime）。
 * 只转发用户主动发起的 ARM_CAPTURE / SAVE_ARTIFACT 消息与扩展结果通知，
 * 不注入任何公众号链接，也不读取页面 Cookie/凭据。
 */
(() => {
  // 授权弹窗会把桥接立即注入当前页面；后续导航时，动态 content script 还会
  // 自动运行。使用隔离世界内的标记避免同一页面重复注册消息监听器。
  if (globalThis.__ibmLiteratureCaptureContentLoaded) return;
  globalThis.__ibmLiteratureCaptureContentLoaded = true;

  // 页面 → SW：布防下一次下载捕获，或请求本地桥接保存 Office 产物。
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
    if (data.type === "SAVE_ARTIFACT") {
      reply("SAVE_ARTIFACT_ACK", { ok: true });
      chrome.runtime.sendMessage({ type: "SAVE_ARTIFACT", payload: data.payload })
        .then((response) => reply("SAVE_ARTIFACT_RESULT", response?.ok
          ? response
          : { ok: false, error: response?.error || "本地桥接保存失败" }))
        .catch((error) => reply("SAVE_ARTIFACT_RESULT", { ok: false, error: String(error?.message || error || "扩展不可用") }));
    }
  });

  // SW → 页面：上传完成/失败/进行中
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (["CAPTURE_COMPLETED", "CAPTURE_FAILED", "CAPTURE_UPLOADING"].includes(message.type)) {
      window.postMessage({ source: "ibm-lit-capture-ext", type: message.type, payload: message.payload || {} }, location.origin);
    }
  });
})();
