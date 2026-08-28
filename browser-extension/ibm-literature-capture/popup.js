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

  function render(task) {
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
    if (area === "local" && changes.ibmCaptureTask) {
      render(changes.ibmCaptureTask.newValue || null);
    }
  });

  void refresh();
})();
