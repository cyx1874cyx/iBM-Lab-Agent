import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";

// 与宿主的 postMessage 协议（合成路线工作台 Ketcher 弹层）：
//   宿主 → 子：{ type:'setMolecule', smiles }   载入现有结构（打开编辑前）
//              { type:'render', smiles, requestId }  由 SMILES 直接导出 PNG（缩略图显示用）
//              { type:'getImage', requestId }   导出当前结构 PNG dataURL（缩略图显示用）
//   子 → 宿主：{ type:'ready' }                 Ketcher 初始化完成（onInit）
//              { type:'molecule', smiles }      点击「保存结构」回传当前 SMILES
//              { type:'image', requestId, dataUrl }  导出 PNG base64（宿主可 <img> 展示）
//              { type:'cancel' }                点击取消
const provider = new StandaloneStructServiceProvider();

const btn = { border: "1px solid", borderRadius: 6, color: "#fff", padding: "4px 12px", fontSize: 12, cursor: "pointer" };

function App() {
  const ketcherRef = useRef(null);
  const [init, setInit] = useState(false);
  const [busy, setBusy] = useState(false);
  const post = (msg) => { try { window.parent.postMessage(msg, "*"); } catch { /* noop */ } };
  const exportPng = async () => {
    const ketcher = ketcherRef.current;
    if (!ketcher) return null;
    const smiles = await ketcher.getSmiles();
    const blob = await ketcher.generateImage(smiles, { outputFormat: "png", backgroundColor: "#ffffff" });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };
  useEffect(() => {
    const onMsg = async (e) => {
      const d = e.data || {};
      const ketcher = ketcherRef.current;
      if (!ketcher) return;
      if (d?.type === "setMolecule") {
        try { await ketcher.setMolecule(d.smiles); } catch { /* 无效结构忽略 */ }
        return;
      }
      if (d?.type === "render" || d?.type === "getImage") {
        try {
          if (d?.type === "render" && d.smiles) await ketcher.setMolecule(d.smiles);
          const dataUrl = await exportPng();
          post({ type: "image", requestId: d.requestId, dataUrl });
        } catch {
          post({ type: "image", requestId: d.requestId, dataUrl: null });
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [init]);
  const save = async () => {
    if (!ketcherRef.current || busy) return;
    setBusy(true);
    try { post({ type: "molecule", smiles: await ketcherRef.current.getSmiles() }); }
    finally { setBusy(false); }
  };
  const cancel = () => post({ type: "cancel" });
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 8, padding: "6px 10px", background: "#0b2531", color: "#eaf6ff", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e4a63", zIndex: 5, flex: "none" }}>
        <span style={{ fontSize: 12, opacity: 0.85 }}>Ketcher 结构编辑器</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button onClick={save} style={{ ...btn, background: "#1f6f43", borderColor: "#2f9b63" }} disabled={busy || !init}>{busy ? "读取中…" : "保存结构"}</button>
          <button onClick={cancel} style={{ ...btn, background: "#3a4b58" }}>取消</button>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {!init ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#7fb3d9", fontSize: 13 }}>正在加载 Ketcher…</div>
        ) : null}
        <Editor
          structServiceProvider={provider}
          onInit={(ketcher) => { ketcherRef.current = ketcher; setInit(true); post({ type: "ready" }); }}
          staticResourcesUrl="./"
          buttons={{ hidden: [] }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
