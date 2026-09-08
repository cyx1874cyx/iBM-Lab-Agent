import {normalizeWithMap, normalizeText, exactMatch, fuzzyMatch} from "./text-match.js";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist";

// ─────────────────────────────────────────────────────────────────────────────
// iBM Lab Agent — Evidence 原文 PDF 定位查看器（RC2）
//
// 这是「合成路线工作台」审核抽屉内嵌的 PDF 定位 shell。宿主（client/index.js）
// 通过 iframe + postMessage 与它通信：
//
//   宿主 → 子：{ type:"open", bundleId, kind, page, quote }
//               bundleId  已归档原文的 bundle id（用于 /api/lab-artifacts 取 PDF 流）
//               kind      "pdf"（正文）或 "si"（补充材料）
//               page      1-based 目标页码（evidence.page 归一化后的整数）
//               quote     系统提取的原文摘录（用于文本定位，可空）
//   子 → 宿主：{ type:"ready" }                    PDF.js 初始化完成
//               { type:"loaded", page }             目标页渲染完成
//               { type:"highlight", status, detail? }
//                 status: "matched" | "notfound" | "noquote"
//                 detail: 匹配到的行/归一化文本（调试用）
//               { type:"error", message }
//
// RC2 约束（对接文档 §9/§11）：
//   - 宁可不高亮，也不错高亮；精确失败→保守模糊→仍失败仅跳页+展示 quote。
//   - 高亮跨多个 TextLayer span；切换 evidence 时清理旧高亮。
//   - 高亮失败不阻塞人工审核流程。
// ─────────────────────────────────────────────────────────────────────────────

// PDF.js worker：显式指定同源托管的 worker，保证离线可用 + 不阻塞主线程。
// 产物由 vite 构建入库，服务端 /api/lab-pdf-viewer/ 静态托管（见 lib/pdf-viewer-assets.js）。
const WORKER_SRC = new URL("/api/lab-pdf-viewer/pdf.worker.mjs?v=worker-v2", window.location.origin).href;
// pdfjs-dist v4 在创建 PDFWorker 前读取全局配置；getDocument 的普通选项里传
// workerSrc 不会生效，并会抛出 No "GlobalWorkerOptions.workerSrc" specified。
function configurePdfWorker() {
  // WebView2 恢复休眠页面或命中旧模块缓存时，模块初始化阶段的赋值可能不再可靠。
  // 在每次 getDocument 前重新登记，并立即读取校验，避免整个审核页统一失效。
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  if (pdfjsLib.GlobalWorkerOptions.workerSrc !== WORKER_SRC) {
    throw new Error("PDF worker 配置失败，请重新打开原文定位");
  }
}
configurePdfWorker();

// 文本归一化：统一换行、断词、连字符、非标准空格、标点与大小写。
// 用于把 page 文本和 quote 映射到同一可比形式。
// 从 PDF.js 的 textContent.items 重建页面级文本 + 每个 item 的字符区间映射。
// PDF.js 把文本拆成大量 span（item），每个 item 有 str 和 transform（坐标）。
// 我们把所有 item 按阅读顺序拼成一个扁平字符序列，并记录每个字符归属哪个 item，
// 从而支持「一句话跨多个 span」的连续高亮。
function buildPageTextModel(textContent) {
  const items = (textContent.items || []).filter((item) => item.str && item.str.trim() !== "");
  const flat = [];
  const charToItem = []; // char index → item index
  items.forEach((item, itemIndex) => {
    const str = item.str || "";
    for (let i = 0; i < str.length; i++) {
      flat.push(str[i]);
      charToItem.push(itemIndex);
    }
    // item 之间插入空格分隔符（模拟视觉词间距），标记为 -1（无归属）
    flat.push(" ");
    charToItem.push(-1);
  });
  return { items, flat, charToItem, raw: flat.join("") };
}

// 归一化：同时产出「归一化文本」与「每个归一化字符 → 原始 flat 索引」的映射。
// 规则与 quote 侧的 normalizeText 保持完全一致，保证可逆回溯：
//   1. 软连字符删除；
//   2. 连字符断行（"-" 后跟空白、且前后非空）删除连字符与后续空白；
//   3. 连续空白折叠为单个空格；
//   4. 标点替换为空格；
//   5. 字母小写。
// 每个归一化输出字符记录其首个原始字符索引；被删除的字符不产生输出。
function buildNormalizationMap(model) {return normalizeWithMap(model.raw);}

// 把归一化索引区间 [start, end) 映射回「命中的 item 索引集合」。
// 对区间内每个归一化字符，通过 normToRaw 回溯到原始 flat 索引，再用
// charToItem 得到归属的 item；归并去重，支持「一句话跨多个 span」连续高亮。
function mapToItemIndexes(model, normToRaw, start, end) {
  const hit = new Set();
  if (start >= end || start < 0 || end > normToRaw.length) return hit;
  for (let k = start; k < end; k++) {
    const rawIdx = normToRaw[k];
    if (rawIdx == null || rawIdx < 0) continue;
    const itemIdx = model.charToItem[rawIdx];
    if (itemIdx != null && itemIdx >= 0) hit.add(itemIdx);
  }
  return hit;
}

function App() {
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef = useRef(null);
  const pageRef = useRef(null);
  const loadingTaskRef = useRef(null);
  const renderTaskRef = useRef(null);
  const requestSeqRef = useRef(0);
  const hostRequestRef = useRef(null);
  const pageTextCache = useRef(new WeakMap());
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [message, setMessage] = useState("");
  const [pageNote, setPageNote] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const quoteRef=useRef("");
  const docKeyRef=useRef("");
  const [zoom,setZoom]=useState(1);
  const zoomRef=useRef(1);
  const [locateResult, setLocateResult] = useState(null); // { status, detail }

  const post = (msg) => { try { window.parent.postMessage({ ...msg, requestId: hostRequestRef.current }, "*"); } catch { /* noop */ } };

  // 清理旧渲染
  const clearRender = () => {
    try { renderTaskRef.current?.cancel?.(); } catch { /* noop */ }
    renderTaskRef.current = null;
    if (textLayerRef.current) { textLayerRef.current.innerHTML = ""; }
    if (pageRef.current) { pageRef.current = null; }
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext("2d"); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
  };

  // Evidence.page 可能是期刊印刷页码（如 17619），并不是 PDF 的 1-based
  // 物理页码。超出范围时用摘录全文检索实际页，禁止直接交给 doc.getPage。
  const findPageByQuote = async (doc, quoteText, requestSeq) => {
    const normQuote = normalizeText(quoteText);
    if (!normQuote) return null;
    let cache = pageTextCache.current.get(doc);
    if (!cache) { cache = new Map(); pageTextCache.current.set(doc, cache); }
    const exactPages = [], fuzzyPages = [];
    for (let candidate = 1; candidate <= doc.numPages; candidate += 1) {
      if (requestSeq !== requestSeqRef.current) return null;
      let norm = cache.get(candidate);
      if (norm === undefined) {
        const candidatePage = await doc.getPage(candidate);
        const textContent = await candidatePage.getTextContent();
        norm = buildNormalizationMap(buildPageTextModel(textContent)).norm;
        cache.set(candidate, norm);
      }
      if (exactMatch(norm, normQuote)) exactPages.push(candidate);
      else if (fuzzyMatch(norm, normQuote)) fuzzyPages.push(candidate);
    }
    return exactPages.length === 1 ? exactPages[0] : exactPages.length === 0 && fuzzyPages.length === 1 ? fuzzyPages[0] : null;
  };

  // 渲染 PDF 某页到 canvas + 建立文本层
  const renderPage = async (doc, pageNumber, quoteText, requestSeq) => {
    clearRender();
    let page;
    try {
      page = await doc.getPage(pageNumber);
    } catch {
      throw new Error(`页码 ${pageNumber} 超出范围（PDF 共 ${doc.numPages} 页）`);
    }
    if (requestSeq !== requestSeqRef.current) return false;
    pageRef.current = page;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) throw new Error("PDF 画布尚未就绪");

    // 自适应容器宽度缩放
    const containerWidth = Math.max(320, container.clientWidth || 600);
    const viewport = page.getViewport({ scale: 1 });
    const scale = (containerWidth-24) / viewport.width * zoomRef.current;
    const scaledViewport = page.getViewport({ scale });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    canvas.style.width = `${scaledViewport.width}px`;
    canvas.style.height = `${scaledViewport.height}px`;

    const context = canvas.getContext("2d");
    const renderTask = page.render({ canvasContext: context, viewport: scaledViewport });
    renderTaskRef.current = renderTask;
    await renderTask.promise;
    if (requestSeq !== requestSeqRef.current) return false;
    renderTaskRef.current = null;

    // 建立文本层（用于高亮，透明度覆盖在 canvas 上）
    const textContent = await page.getTextContent();
    if (requestSeq !== requestSeqRef.current) return false;
    const textLayer = textLayerRef.current;
    if (textLayer) {
      textLayer.innerHTML = "";
      // 使用 PDF.js 的 TextLayer 渲染（需要 CSS）；这里手动画 span 覆盖层
      const model = buildPageTextModel(textContent);
      const { norm, normToRaw } = buildNormalizationMap(model);
      window.__pageModel = { model, norm, normToRaw, viewport: scaledViewport, pageNumber };
      // 渲染文本层 span（透明，仅用于高亮坐标）
      renderTextLayerSpans(model, scaledViewport);
    }

    setCurrentPage(pageNumber);
    post({ type: "loaded", page: pageNumber });

    // 定位 quote
    if (quoteText) {
      locateAndHighlight(quoteText);
    } else {
      setLocateResult({ status: "noquote" });
      post({ type: "highlight", status: "noquote", detail: "" });
    }
    return true;
  };

  // 渲染文本层 span（用 item 坐标放置），供高亮定位
  const renderTextLayerSpans = (model, viewport) => {
    const textLayer = textLayerRef.current;
    if (!textLayer) return;
    const container = document.createElement("div");
    container.style.position = "relative";
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;
    container.style.pointerEvents = "none";
    container.style.color = "transparent";
    container.style.lineHeight = "1";
    container.style.textAlign = "left";
    container.style.verticalAlign = "top";
    container.style.transformOrigin = "0 0";
    // PDF.js textContent 的 transform 是 PDF 坐标（y 向下），需要翻转
    const items = model.items;
    const spans = [];
    items.forEach((item, idx) => {
      const tx = item.transform;
      if (!tx) return;
      const fontSize = Math.hypot(tx[2], tx[3]);
      const x = tx[4];
      const y = tx[5];
      const span = document.createElement("span");
      span.textContent = item.str || "";
      span.setAttribute("data-item", String(idx));
      span.style.position = "absolute";
      const [vx,vy]=viewport.convertToViewportPoint(x,y);
      span.style.left = `${vx}px`;
      span.style.top = `${vy-fontSize*viewport.scale}px`;
      span.style.width = `${Math.abs(item.width||0)*viewport.scale}px`;
      span.style.height = `${fontSize*viewport.scale}px`;
      span.style.fontSize = `${fontSize * viewport.scale}px`;
      span.style.transformOrigin = "left bottom";
      span.style.whiteSpace = "pre";
      span.style.fontFamily = "sans-serif";
      span.style.color = "transparent";
      container.appendChild(span);
      spans.push({ item, idx, span, x, y, fontSize, width: item.width || 0 });
    });
    textLayer.appendChild(container);
    window.__pageSpans = spans;
  };

  // 定位并高亮 quote
  const locateAndHighlight = (quoteText) => {
    const model = window.__pageModel;
    if (!model) return;
    const normQuote = normalizeText(quoteText);
    if (!normQuote) {
      setLocateResult({ status: "noquote" });
      post({ type: "highlight", status: "noquote", detail: "" });
      return;
    }
    const normText = model.norm;
    // 1. 精确匹配
    let match = exactMatch(normText, normQuote);
    // 2. 保守模糊匹配
    if (!match) {
      match = fuzzyMatch(normText, normQuote);
    }
    if (!match) {
      setLocateResult({ status: "notfound" });
      post({ type: "highlight", status: "notfound", detail: normQuote });
      return;
    }
    // 映射回 item 并高亮
    const hitItemIdx = mapToItemIndexes(model.model, model.normToRaw, match.start, match.end);
    applyHighlight(hitItemIdx);
    setLocateResult({ status: match.fuzzy ? "candidate" : "matched", detail: normQuote, fuzzy: match.fuzzy });
    post({ type: "highlight", status: match.fuzzy ? "candidate" : "matched", detail: normQuote, fuzzy: match.fuzzy });
  };

  // 应用高亮：把命中的 item span 背景设为半透明
  const applyHighlight = (hitItemIdx) => {
    // hitItemIdx 是 item 索引集合；直接高亮这些 item 的 span
    const spans = window.__pageSpans || [];
    spans.forEach(({ idx, span }) => {
      if (hitItemIdx.has(idx)) {
        span.style.color = "transparent";
        span.style.background = "rgba(255, 213, 79, 0.45)";
        span.style.boxShadow = "0 0 2px rgba(255, 193, 7, 0.6)";
        span.style.borderRadius = "2px";
      } else {
        span.style.color = "transparent";
        span.style.background = "transparent";
        span.style.boxShadow = "none";
      }
    });
    // 滚动到第一个高亮位置
    const first = spans.find(({ idx }) => hitItemIdx.has(idx));
    if (first && containerRef.current) {
      const top = parseFloat(first.span.style.top) || 0;
      containerRef.current?.scrollTo?.({ top: Math.max(0, top - 120), behavior: "smooth" });
    }
  };

  // 接收宿主消息
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== window.parent) return;
      const d = e.data || {};
      if (d?.type === "open") {
        hostRequestRef.current = d.requestId;
        for (const [key, value] of Object.entries(d.theme || {})) { if (["bg-base", "bg-layer-1", "border-l2", "label-primary", "label-secondary", "state-warn-primary"].includes(key) && typeof value === "string" && CSS.supports("color", value)) document.documentElement.style.setProperty(`--viewer-${key}`, value); }
        const bundleId = d.bundleId;
        const kind = d.kind === "si" ? "si" : "pdf";
        const page = d.pageLabel || String(d.page || 1);
        const q = d.quote || "";
        setLocateResult(null);
        setMessage("");
        void openPdf(bundleId, kind, page, q);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const openPdf = async (bundleId, kind, page, q) => {
    if (!bundleId) {
      setStatus("error");
      setMessage("未提供 bundleId，无法加载原文");
      post({ type: "error", message: "未提供 bundleId" });
      return;
    }
    const requestSeq = ++requestSeqRef.current;
    clearRender();
    const docKey=`${bundleId}:${kind}`;
    const reused=docKeyRef.current===docKey ? pdfDocRef.current : null;
    if(!reused){try { await loadingTaskRef.current?.destroy?.(); } catch {} loadingTaskRef.current=null;try {await pdfDocRef.current?.destroy?.();}catch{}pdfDocRef.current=null;}
    quoteRef.current=q;
    setStatus("loading");
    setMessage("正在加载原文…");
    setPageNote("");
    try {
      // 复用 /api/lab-artifacts 取 PDF 流（PDF.js 可直接消费同源 URL）
      const pdfUrl = `/api/lab-artifacts?kind=${kind}&bundleId=${encodeURIComponent(bundleId)}&preview=1`;
      configurePdfWorker();
      const loadingTask = reused ? {promise:Promise.resolve(reused)} : pdfjsLib.getDocument({ url: pdfUrl });
      loadingTaskRef.current = loadingTask;
      const doc = await loadingTask.promise;
      if (requestSeq !== requestSeqRef.current) { await doc.destroy().catch(() => {}); return; }
      loadingTaskRef.current = null;
      pdfDocRef.current = doc;
      docKeyRef.current=docKey;
      setMessage(`已加载（共 ${doc.numPages} 页）`);
      const pageLabels=await doc.getPageLabels().catch(()=>null);
      const labelIndex=pageLabels?.indexOf(String(page)) ?? -1;
      let resolvedPage=labelIndex>=0?labelIndex+1:Number(page);
      // Search even when the supplied number is in range: printed and physical pages can differ.
      if(q){const located=await findPageByQuote(doc, q, requestSeq);if(requestSeq!==requestSeqRef.current)return;if(located){resolvedPage=located;setPageNote(`原标签 ${page} · PDF 第 ${located} 页`);}}
      if(!Number.isInteger(resolvedPage)||resolvedPage<1||resolvedPage>doc.numPages){resolvedPage=1;setPageNote(`页标签 ${page} 未匹配，请选页核对`);}
      const rendered = await renderPage(doc, resolvedPage, q, requestSeq);
      if (!rendered || requestSeq !== requestSeqRef.current) return;
      setStatus("ready");
    } catch (error) {
      if (requestSeq !== requestSeqRef.current || error?.name === "RenderingCancelledException") return;
      setStatus("error");
      const msg = error?.message || "PDF 加载失败";
      setMessage(msg);
      post({ type: "error", message: msg });
    }
  };

  // 初始化完成后发 ready
  useEffect(() => {
    post({ type: "ready" });
    return () => {
      requestSeqRef.current += 1;
      clearRender();
      try { loadingTaskRef.current?.destroy?.(); } catch { /* noop */ }
      try { pdfDocRef.current?.destroy?.(); } catch { /* noop */ }
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: 'Arial, "Microsoft YaHei", sans-serif', background: "var(--viewer-bg-base,#f7f7f8)", color: "var(--viewer-label-primary,#202124)" }}>
      <div style={{ flex: "none", padding: "8px 12px", background: "var(--viewer-bg-layer-1,#fff)", borderBottom: "1px solid var(--viewer-border-l2,#ddd)", fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 600 }}>原文定位</span>
        <button disabled={!currentPage||currentPage<=1} onClick={()=>void renderPage(pdfDocRef.current,currentPage-1,quoteRef.current,++requestSeqRef.current)}>上一页</button>
        <input aria-label="PDF 页码" type="number" min="1" max={pdfDocRef.current?.numPages||1} value={currentPage||1} style={{width:54}} onChange={e=>{const n=Number(e.target.value);if(pdfDocRef.current&&n>=1&&n<=pdfDocRef.current.numPages)void renderPage(pdfDocRef.current,n,quoteRef.current,++requestSeqRef.current);}}/>
        <button disabled={!currentPage||currentPage>=pdfDocRef.current?.numPages} onClick={()=>void renderPage(pdfDocRef.current,currentPage+1,quoteRef.current,++requestSeqRef.current)}>下一页</button>
        <select aria-label="缩放" value={zoom} onChange={e=>{const n=Number(e.target.value);setZoom(n);zoomRef.current=n;if(pdfDocRef.current)void renderPage(pdfDocRef.current,currentPage,quoteRef.current,++requestSeqRef.current);}}><option value={1}>适宽</option><option value={1.5}>150%</option><option value={2}>200%</option></select>
        {locateResult?.status==="candidate"&&<span>候选段落，请人工核对</span>}
        <span style={{ color: "var(--viewer-label-secondary,#666)", fontSize: 11 }}>
          {status === "loading" ? message : status === "error" ? `⚠ ${message}` : currentPage ? `第 ${currentPage} 页${pageNote ? ` · ${pageNote}` : ""}` : message}
        </span>
        {locateResult?.status === "notfound" && (
          <span style={{ color: "var(--viewer-state-warn-primary,#8a6d2f)", fontSize: 11 }}>未能自动定位原文，请在本页人工确认</span>
        )}
        {locateResult?.status === "matched" && (
          <span style={{ color: "var(--viewer-label-primary,#202124)", fontSize: 11 }}>已定位原文{locateResult.fuzzy ? "（模糊匹配）" : ""}</span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12, position: "relative" }} ref={(el) => { containerRef.current = el; }}>
        <div style={{ position: "relative", margin: "0 auto", width: "fit-content", background: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}>
          <canvas ref={canvasRef} style={{ display: "block" }} />
          <div ref={textLayerRef} style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
