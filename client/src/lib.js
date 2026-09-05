// 工具函数：格式化、下载、desktop shell 通信（从原 client/index.js 单文件抽离）。
export const when = (value) => value ? new Date(value).toLocaleString() : "—";
export const titleOf = (row) => row.title || row.name || row.query || row.id;
export const statusOf = (row) => ({ succeeded: "已审核", pending: "待处理", running: "生成中", failed: "已退回", draft: "草稿", "under-review": "已暂存·待审核", approved: "已批准", prepared: "待分析", "approved-written": "已审核", "visually-verified": "已确认" })[row.status] || row.status || "已登记";

		/** 深拷贝阅读笔记模板 → 表单可编辑形态（数组隔离，避免污染原始数据）。 */
export function cloneForm(source) {
			if (!source) return {};
			const { id = "", name = "", audience = "课题组组会", language = "zh", length = "", topics = [], tags = [], sections = [], styleRules = [], evidenceRequirements = [], outputRequirements = [], remark = "", version } = source;
			return { id, name, audience, language, length, topics: [...topics], tags: [...tags], sections: sections.map((s) => ({ ...s })), styleRules: [...styleRules], evidenceRequirements: [...evidenceRequirements], outputRequirements: [...outputRequirements], remark, version };
		}

		/** 浏览器下载助手：text / base64 二进制 两类 blob 触发下载任务。 */
export function downloadBlob(fileName, mime, blob) {
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		}
		/** Desktop 宿主文本另存为：用于内存中生成、没有下载 URL 的 RIS。 */
export function saveTextArtifactViaDesktop(fileName, text) {
			if (window.parent === window) return Promise.reject(new Error("RIS 另存为仅支持桌面客户端"));
			return new Promise((resolve, reject) => {
				const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-text-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				let settled = false;
				let acknowledged = false;
				const fail = (message, code) => { const error = new Error(message); error.code = code; return error; };
				const finish = (callback, value) => {
					if (settled) return;
					settled = true;
					clearTimeout(readyTimer); clearTimeout(completionTimer);
					window.removeEventListener("message", onResult);
					callback(value);
				};
				const onResult = (event) => {
					if (event.source !== window.parent) return;
					const data = event.data;
					if (!data || data.source !== "ibm-lab-agent-shell" || data.requestId !== requestId) return;
					if (data.type === "SAVE_TEXT_ARTIFACT_ACK") { acknowledged = true; clearTimeout(readyTimer); return; }
					if (data.type !== "SAVE_TEXT_ARTIFACT_RESULT") return;
					if (data.payload?.ok) finish(resolve, data.payload.saved);
					else finish(reject, fail(data.payload?.error || "桌面原生文本保存失败", acknowledged ? "DESKTOP_SAVE_FAILED" : "NO_DESKTOP_SHELL"));
				};
				const readyTimer = setTimeout(() => finish(reject, fail("未检测到桌面文件服务", "NO_DESKTOP_SHELL")), 1800);
				const completionTimer = setTimeout(() => finish(reject, fail("桌面原生保存超时（5 分钟）", "DESKTOP_SAVE_FAILED")), 5 * 60 * 1000);
				window.addEventListener("message", onResult);
				try { window.parent.postMessage({ source: "ibm-lab-agent", type: "SAVE_TEXT_ARTIFACT", requestId, payload: { fileName, text } }, "*"); }
				catch (reason) { finish(reject, reason); }
			});
		}
		/** RIS 统一交给 Desktop 显示系统另存为，不使用 WebView Blob 下载。 */
export async function saveRis(fileName, text) {
			const saved = await saveTextArtifactViaDesktop(fileName, text);
			if (saved?.cancelled) return { cancelled: true, fileName };
			return { ...saved, native: true };
		}
export const downloadBase64 = (fileName, mime, base64) => {
			const type = mime || "application/octet-stream";
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			downloadBlob(fileName, type, new Blob([bytes], { type }));
		};
		/** Web 宿主下载：先校验 Content-Length 与 SHA-256，再触发浏览器保存。 */
export async function browserDownloadVerifiedBinary(url) {
			const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
			if (!response.ok) throw new Error((await response.text()) || `下载失败（HTTP ${response.status}）`);
			const blob = await response.blob();
			const expectedBytes = Number(response.headers.get("content-length"));
			if (Number.isFinite(expectedBytes) && expectedBytes >= 0 && blob.size !== expectedBytes) {
				throw new Error(`下载不完整：应为 ${expectedBytes} 字节，实际 ${blob.size} 字节；文件未保存，请重试。`);
			}
			const expectedHash = response.headers.get("x-content-sha256");
			if (expectedHash && globalThis.crypto?.subtle) {
				const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
				const actualHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
				if (actualHash !== expectedHash) throw new Error("下载校验失败（SHA-256 不一致）；文件未保存，请重试。");
			}
			const encodedName = response.headers.get("x-file-name") || "artifact.bin";
			let fileName = encodedName;
			try { fileName = decodeURIComponent(encodedName); } catch { /* 保留服务端原值 */ }
			downloadBlob(fileName, blob.type || "application/octet-stream", blob);
			return fileName;
		}
		/** Desktop 宿主原生保存：iframe 请求顶层 Tauri shell 下载、校验并显示另存为。 */
export function saveArtifactViaDesktop(url) {
			return new Promise((resolve, reject) => {
				const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				let settled = false;
				let acknowledged = false;
				const fail = (message, code) => { const error = new Error(message); error.code = code; return error; };
				const finish = (callback, value) => {
					if (settled) return;
					settled = true;
					clearTimeout(readyTimer); clearTimeout(completionTimer);
					window.removeEventListener("message", onResult);
					callback(value);
				};
				const onResult = (event) => {
					if (event.source !== window.parent) return;
					const data = event.data;
					if (!data || data.source !== "ibm-lab-agent-shell" || data.requestId !== requestId) return;
					if (data.type === "SAVE_ARTIFACT_ACK") { acknowledged = true; clearTimeout(readyTimer); return; }
					if (data.type !== "SAVE_ARTIFACT_RESULT") return;
					if (data.payload?.ok) finish(resolve, data.payload.saved);
					else finish(reject, fail(data.payload?.error || "桌面原生保存失败", acknowledged ? "DESKTOP_SAVE_FAILED" : "NO_DESKTOP_SHELL"));
				};
				const readyTimer = setTimeout(() => finish(reject, fail("未检测到桌面文件服务", "NO_DESKTOP_SHELL")), 1800);
				const completionTimer = setTimeout(() => finish(reject, fail("桌面原生保存超时（5 分钟）", "DESKTOP_SAVE_FAILED")), 5 * 60 * 1000);
				window.addEventListener("message", onResult);
				try {
					const artifactUrl = new URL(url, location.origin).href;
					window.parent.postMessage({ source: "ibm-lab-agent", type: "SAVE_ARTIFACT", requestId, payload: { artifactUrl } }, "*");
				} catch (reason) { finish(reject, reason); }
			});
		}
		/** Ask the desktop shell to open a file that it saved in this session. */
export function openSavedPathViaDesktop(path) {
			return new Promise((resolve, reject) => {
				const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-open-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				let settled = false;
				const finish = (callback, value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					window.removeEventListener("message", onResult);
					callback(value);
				};
				const onResult = (event) => {
					if (event.source !== window.parent) return;
					const data = event.data;
					if (!data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_SAVED_PATH_RESULT" || data.requestId !== requestId) return;
					if (data.payload?.ok) finish(resolve, data.payload);
					else finish(reject, new Error(data.payload?.error || "桌面客户端未能打开文件"));
				};
				const timer = setTimeout(() => finish(reject, new Error("桌面客户端打开文件超时")), 10000);
				window.addEventListener("message", onResult);
				try { window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_SAVED_PATH", requestId, path }, "*"); }
				catch (reason) { finish(reject, reason); }
			});
		}
		/** 桌面优先走 Tauri 原生保存；Web 宿主保留浏览器校验下载。 */
export async function downloadVerifiedBinary(url) {
			if (window.parent !== window) {
				try {
					const saved = await saveArtifactViaDesktop(url);
					if (saved?.cancelled) throw new Error("已取消保存");
					return saved?.fileName || "artifact";
				} catch (error) {
					if (error?.code !== "NO_DESKTOP_SHELL") throw error;
				}
			}
			return browserDownloadVerifiedBinary(url);
		}
		/** Office 文件：Desktop 用 Tauri 原生另存为；Web 使用浏览器校验下载。 */
export async function downloadOfficeArtifact(url) {
			if (window.parent !== window) {
				try {
					const saved = await saveArtifactViaDesktop(url);
					if (saved?.cancelled) throw new Error("已取消保存");
					return { ...saved, native: true };
				} catch (error) {
					if (error?.code !== "NO_DESKTOP_SHELL") throw error;
				}
			}
			const fileName = await browserDownloadVerifiedBinary(url);
			return { fileName, native: false };
		}
		/** Desktop workflow: save the actual Office artifact, then use the Windows Office/WPS association to open it. */
export async function openOfficeArtifact(url) {
			if (window.parent !== window) {
				const requestId = globalThis.crypto?.randomUUID?.() ?? `desktop-open-artifact-${Date.now()}`;
				await new Promise((resolve, reject) => {
					let settled = false;
					const finish = (callback, value) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						window.removeEventListener("message", onResult);
						callback(value);
					};
					const onResult = (event) => {
						const data = event.data;
						if (event.source !== window.parent || !data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_ARTIFACT_RESULT" || data.requestId !== requestId) return;
						data.payload?.ok ? finish(resolve) : finish(reject, new Error(data.payload?.error || "无法打开文件"));
					};
					const timer = setTimeout(() => finish(reject, new Error("桌面客户端打开文件超时")), 120000);
					window.addEventListener("message", onResult);
					try {
						window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_ARTIFACT", requestId, payload: { artifactUrl: new URL(url, location.origin).href } }, "*");
					} catch (reason) { finish(reject, reason); }
				});
				return { native: true };
			}
			const fileName = await browserDownloadVerifiedBinary(url);
			return { fileName, native: false };
		}
		/** 已归档 PDF 使用浏览器原生 PDF 阅读器；桌面版走专用本地文献通道。 */
export async function openPdfPreview(url) {
			const previewUrl = new URL(url, location.origin);
			previewUrl.searchParams.set("preview", "1");
			if (window.parent === window) {
				window.open(previewUrl.href, "_blank", "noopener,noreferrer");
				return;
			}
			const kind = previewUrl.searchParams.get("kind");
			const bundleId = previewUrl.searchParams.get("bundleId");
			if (!bundleId || !["pdf", "si"].includes(kind)) throw new Error("文献阅读地址无效");
			return openArtifactInBrowserViaShell(kind, bundleId);
		}

export const openInEdgeViaShell = (url) => new Promise((resolve, reject) => {
			const requestId = globalThis.crypto?.randomUUID?.() ?? `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			let settled = false;
			const finish = (callback, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				window.removeEventListener("message", onResult);
				callback(value);
			};
			const onResult = (event) => {
				// 只接受顶层 shell（Tauri 页面）的回复；iframe 与 tauri:// 不同源，
				// 无法校验 event.origin，仅按 requestId 匹配并核对消息来源结构。
				if (event.source !== window.parent) return;
				const data = event.data;
				if (!data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_IN_EDGE_RESULT" || data.requestId !== requestId) return;
				if (data.payload?.ok) finish(resolve, data.payload);
				else finish(reject, new Error(data.payload?.error || "桌面客户端未能在 Edge 中打开页面"));
			};
			const timer = setTimeout(() => finish(reject, new Error("桌面客户端未响应（未收到 open_in_edge 确认）；请检查是否运行在 iBM Lab Agent 桌面版")), 4000);
			window.addEventListener("message", onResult);
			try { window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_IN_EDGE", requestId, url }, "*"); }
			catch (reason) { finish(reject, reason); }
		});
		/** 只向桌面 shell 传文献标识；本地阅读地址由 Rust 按当前运行端口生成。 */
export const openArtifactInBrowserViaShell = (kind, bundleId) => new Promise((resolve, reject) => {
			const requestId = globalThis.crypto?.randomUUID?.() ?? `artifact-browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			let settled = false;
			const finish = (callback, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				window.removeEventListener("message", onResult);
				callback(value);
			};
			const onResult = (event) => {
				if (event.source !== window.parent) return;
				const data = event.data;
				if (!data || data.source !== "ibm-lab-agent-shell" || data.type !== "OPEN_ARTIFACT_IN_BROWSER_RESULT" || data.requestId !== requestId) return;
				if (data.payload?.ok) finish(resolve, data.payload);
				else finish(reject, new Error(data.payload?.error || "桌面客户端未能打开文献阅读页"));
			};
			// Rust 侧会先对本地 PDF 端点做一次预检（最长 20 秒）再启动 Edge，
			// 超时必须大于该预检上限，否则会被误报成"桌面客户端未响应"。
			const timer = setTimeout(() => finish(reject, new Error("桌面客户端未响应，无法打开文献阅读页")), 30000);
			window.addEventListener("message", onResult);
			try { window.parent.postMessage({ source: "ibm-lab-agent", type: "OPEN_ARTIFACT_IN_BROWSER", requestId, payload: { kind, bundleId } }, "*"); }
			catch (reason) { finish(reject, reason); }
		});
		/** 统一外部 URL Router：Desktop 交给 Rust/Edge，Web 才使用 window.open。 */
export const openExternalUrl = async (url) => {
			if (!url) return;
			if (window.parent !== window) return openInEdgeViaShell(url);
			window.open(url, "_blank", "noopener,noreferrer");
		};
