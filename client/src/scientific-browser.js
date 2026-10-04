import { useState, useEffect } from "react";
import { h } from "./h.js";
export function ScientificBrowser({ call, projectId }) {
 const [state, setState] = useState({ available: false, window: null }), [url, setUrl] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
 useEffect(() => {
  let disposed = false, timer;
  const poll = async () => {
   try { const next = await call("desktop_browser", { request: { action: "status", projectId } }); if (!disposed) setState(next); }
   catch { if (!disposed) setState({ available: false, window: null }); }
   if (!disposed) timer = setTimeout(poll, 2000);
  };
  void poll(); return () => { disposed = true; clearTimeout(timer); };
 }, [call, projectId]);
 const act = async action => {
  setBusy(true); setNote("");
  try {
   await call("desktop_browser", { request: { action, projectId, ...(url.trim() && action === "navigate" ? { url: url.trim() } : {}) } });
   setState(await call("desktop_browser", { request: { action: "status", projectId } }));
  } catch (error) { setNote(error.message); } finally { setBusy(false); }
 };
 if (!state.available) return null;
 return h("section", { className: "ib-scientific-browser", style: { marginBottom: 18 } },
  h("div", { className: "ib-actions", style: { flexWrap: "wrap" } },
   h("button", { className: "ib-btn", disabled: busy, onClick: () => void act("open") }, state.window ? "显示科研浏览器" : "打开科研浏览器"),
   h("input", { value: url, onChange: event => setUrl(event.target.value), placeholder: "输入机构资源或文献页面地址", "aria-label": "科研页面地址", style: { flex: "1 1 260px", minWidth: 0 } }),
   h("button", { className: "ib-btn", disabled: busy || !state.window || !url.trim(), onClick: () => void act("navigate") }, "前往"),
   h("button", { className: "ib-btn", disabled: busy || !state.window, onClick: () => void act("close") }, "关闭浏览器")),
  h("p", { className: "ib-muted" }, state.window ? state.window.title || "科研窗口已打开；登录和下载请在该窗口完成。" : "登录在独立科研窗口中完成。关闭窗口后不会自动重新打开。"),
  note ? h("div", { className: "ib-error", role: "status" }, note) : null);
}
