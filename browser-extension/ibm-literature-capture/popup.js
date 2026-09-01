/* iBM Lab 文献捕获 — 桌面下载桥状态与取消。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const labels = {
    armed: "等待下载",
    uploading: "归档中",
    completed: "已归档",
    failed: "失败",
    expired: "已过期",
    cancelled: "已取消"
  };

  function render(task) {
    const status = task?.status || "idle";
    $("stateDot").dataset.state = status;
    $("stateText").textContent = task ? (labels[status] || status) : "待命";
    $("emptyCard").classList.toggle("hidden", !!task);
    $("taskCard").classList.toggle("hidden", !task);
    if (!task) return;
    $("taskId").textContent = task.id || "—";
    $("taskKind").textContent = task.kind === "si" ? "SI 补充材料" : "PDF 原文";
    $("taskExpires").textContent = task.expiresAt ? new Date(task.expiresAt).toLocaleString() : "—";
    $("taskFile").textContent = task.fileName || "—";
    const error = task.error || "";
    $("taskError").textContent = error;
    $("taskError").classList.toggle("hidden", !error);
    $("cancelBtn").classList.toggle("hidden", status !== "armed");
  }

  async function refresh() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      render(response?.ok ? response.task : null);
    } catch {
      render(null);
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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.ibmCaptureTask) void refresh();
  });

  $("extensionVersion").textContent = ` v${chrome.runtime.getManifest().version}`;
  void refresh();
})();
