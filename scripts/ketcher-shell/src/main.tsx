import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";

// 与宿主的 postMessage 协议（合成路线工作台 Ketcher 弹层）：
//   宿主 → 子：{ type:'setMolecule', smiles }   载入现有结构（打开编辑前）
//              { type:'render', smiles, requestId, format?: 'png'|'svg' }  由 SMILES 直接导出（缩略图显示用）
//              { type:'getImage', requestId, format?: 'png'|'svg' }   导出当前结构（缩略图显示用）
//   子 → 宿主：{ type:'ready' }                 Ketcher 初始化完成（onInit）
//              { type:'molecule', smiles }      点击「保存结构」回传当前 SMILES
//              { type:'image', requestId, dataUrl, format }  导出 base64（PNG dataURL / SVG dataURL）
//              { type:'image:error', requestId, message }   导出失败（明确失败，不伪造成功）
//              { type:'cancel' }                点击取消
//
// 0.4.0-rc.4（§8）：支持 PNG 与 SVG 两种导出格式；导出超时（exportTimeoutMs）
// 与载入超时（loadTimeoutMs）各自独立，不共用单一合并计时器。
const provider = new StandaloneStructServiceProvider();

const btn = { border: "1px solid", borderRadius: 6, color: "#fff", padding: "4px 12px", fontSize: 12, cursor: "pointer" };

/** 导出一张图：png → dataURL；svg → text。ketcher generateImage 返回 Blob（png）
 *  或 string（svg）。svg 需要包成 data:image/svg+xml;base64 以便 <img> 直接显示。 */
const normalizedSize = (value, fallback) => Math.min(2048, Math.max(64, Number(value) || fallback));

/** Indigo 的 render-background-color 使用 0..1 RGB 三元组，不接受 CSS #hex。 */
function toIndigoColor(cssColor) {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(cssColor ?? "").trim());
	if (!hex) return String(cssColor).toLowerCase() === "black" ? "0,0,0" : "1,1,1";
	const value = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
	return [0, 2, 4].map((offset) => (parseInt(value.slice(offset, offset + 2), 16) / 255).toFixed(4)).join(",");
}

async function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/** 将 Ketcher 的自适应 PNG 放进指定画布，保证宿主请求的尺寸真正生效。 */
async function resizePng(blob, width, height, backgroundColor) {
	const objectUrl = URL.createObjectURL(blob);
	try {
		const image = await new Promise((resolve, reject) => {
			const element = new Image();
			element.onload = () => resolve(element);
			element.onerror = () => reject(new Error("ketcher png decode failed"));
			element.src = objectUrl;
		});
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("canvas 2d context unavailable");
		context.fillStyle = backgroundColor;
		context.fillRect(0, 0, width, height);
		const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
		const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale));
		const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale));
		context.drawImage(image, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight);
		return canvas.toDataURL("image/png");
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

async function generateExport(ketcher, smiles, format = "png", options = {}) {
	if (!ketcher) throw new Error("ketcher not ready");
	const width = normalizedSize(options.width, 560);
	const height = normalizedSize(options.height, 420);
	const backgroundColor = typeof options.theme === "string" && options.theme.trim() ? options.theme.trim() : "#ffffff";
	const indigoBackground = toIndigoColor(backgroundColor);
	if (format === "svg") {
		const svg = await ketcher.generateImage(smiles, { outputFormat: "svg", backgroundColor: indigoBackground });
		const text = typeof svg === "string" ? svg : await svg.text();
		if (!text || !text.includes("<svg")) throw new Error("ketcher svg export returned no svg");
		const doc = new DOMParser().parseFromString(text, "image/svg+xml");
		const root = doc.documentElement;
		if (root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("ketcher svg export is invalid");
		root.setAttribute("width", String(width));
		root.setAttribute("height", String(height));
		root.setAttribute("preserveAspectRatio", "xMidYMid meet");
		const sized = new XMLSerializer().serializeToString(root);
		return { dataUrl: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(sized)))}`, format: "svg" };
	}
	const blob = await ketcher.generateImage(smiles, { outputFormat: "png", backgroundColor: indigoBackground });
	const dataUrl = options.width || options.height
		? await resizePng(blob, width, height, backgroundColor)
		: await blobToDataUrl(blob);
	return { dataUrl, format: "png" };
}

function App() {
	const ketcherRef = useRef(null);
	const [init, setInit] = useState(false);
	const [busy, setBusy] = useState(false);
	const post = (msg) => { try { window.parent.postMessage(msg, window.location.origin); } catch { /* noop */ } };
	// 单个任务级别的阶段超时：载入结构 loadTimeoutMs、导出 exportTimeoutMs，
	// 任何阶段超时都发 image:error（不无限挂起，不伪造成功）。
	const withStageTimeout = (promise, ms, label) =>
		new Promise((resolvePromise, rejectPromise) => {
			const timer = setTimeout(() => rejectPromise(new Error(`${label} timed out after ${ms}ms`)), ms);
			Promise.resolve(promise)
				.then((value) => { clearTimeout(timer); resolvePromise(value); })
				.catch((error) => { clearTimeout(timer); rejectPromise(error); });
		});
	useEffect(() => {
		const onMsg = async (e) => {
			const d = e.data || {};
			const ketcher = ketcherRef.current;
			const requestId = d?.requestId;
			const format = d?.format === "svg" ? "svg" : "png";
			const exportOptions = { width: d?.width, height: d?.height, theme: d?.theme };
			if (!ketcher) {
				if (requestId) post({ type: "image:error", requestId, message: "ketcher not ready" });
				return;
			}
			const fail = (message) => {
				if (requestId) post({ type: "image:error", requestId, message: String(message || "export failed") });
			};
			try {
				if (d?.type === "setMolecule") {
					await withStageTimeout(ketcher.setMolecule(d.smiles), 15000, "load molecule");
					return;
				}
				if (d?.type === "render" || d?.type === "getImage") {
					try {
						if (d?.type === "render" && d.smiles) {
							// rc.4 review（§10.2）：把当前阶段回传宿主，宿主按阶段重置
							// 超时，不再用短于所有子阶段之和的单一整单计时器误杀合法任务。
							post({ type: "phase", requestId, phase: "loading" });
							await withStageTimeout(ketcher.setMolecule(d.smiles), 15000, "load molecule");
						}
						post({ type: "phase", requestId, phase: "exporting" });
						const smiles = d?.type === "render" ? d.smiles : await ketcher.getSmiles();
						const out = await withStageTimeout(generateExport(ketcher, smiles, format, exportOptions), 20000, "export image");
						post({ type: "image", requestId, dataUrl: out.dataUrl, format: out.format });
					} catch (error) {
						fail(error?.message || "render failed");
					}
					return;
				}
			} catch {
				fail("message handling failed");
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
