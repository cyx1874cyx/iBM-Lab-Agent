import { normName, KETCHER_URL, KETCHER_RENDER_PROTOCOL, KETCHER_DEFAULT_THEME, KETCHER_STAGE_LOADING_MS, KETCHER_STAGE_EXPORT_MS, KETCHER_OVERALL_MS } from "./constants.js";

// Ketcher 渲染基础设施 + 证据工具（从原 client/index.js 单文件抽离）。
/**
 * 缩略图缓存键：规范化结构 + 宽高 + 主题 + 导出格式 + 渲染协议版本。
 * 同一结构不同尺寸/主题/格式不会错误复用彼此缩略图（0.4.0 WP1/§8）；
 * 失败项不缓存（见 ketcherModule.cache 注释）。
 */
export function ketcherCacheKey(smiles, { width = 560, height = 420, theme = KETCHER_DEFAULT_THEME, format = "png" } = {}) {
			return `v${KETCHER_RENDER_PROTOCOL}|${normName(smiles)}|${Number(width) || 560}x${Number(height) || 420}|${String(theme ?? KETCHER_DEFAULT_THEME).replace(/\s+/g, "").toLowerCase() || "w"}|${format === "svg" ? "svg" : "png"}`;
		}
		// 隐藏缩略图 iframe 常驻：按需创建后只加载一次，排队逐个 render。
export const ketcherModule = {
			iframe: null,
			ready: false,
			queue: [],
			busy: false,
			seq: 0,
			pending: {}, // requestId → { key, smiles, resolve, timer, overall }
			// 缓存避免重复渲染同一 (结构,尺寸,主题,协议)：只缓存成功结果，
			// 失败项不缓存以便点击重试（dataURL 可能数 KB~上百 KB，适可而止）
			cache: {}
		};
export function ensureKetcherHiddenFrame() {
			if (ketcherModule.iframe && document.body.contains(ketcherModule.iframe)) return ketcherModule.iframe;
			const frame = document.createElement("iframe");
			frame.setAttribute("aria-hidden", "true");
			frame.tabIndex = -1;
			frame.style.cssText = "position:fixed;left:-9999px;top:0;width:560px;height:420px;border:0;opacity:0.01;pointer-events:none;z-index:-1";
			frame.src = KETCHER_URL;
			ketcherModule.iframe = frame;
			// 模块级 message 只处理隐藏缩略图框架的回执（模态弹层由组件自监听）。
			if (!ketcherModule.listenerInstalled) {
				ketcherModule.listenerInstalled = true;
				window.addEventListener("message", (event) => {
					if (!ketcherModule.iframe || event.source !== ketcherModule.iframe.contentWindow) return;
					const data = event.data || {};
					if (data?.type === "ready") {
						ketcherModule.ready = true;
						return;
					}
				if (data?.type === "image" || data?.type === "image:error") {
					const pending = ketcherModule.pending[data.requestId];
					if (pending) {
						// 成功才缓存（含 SVG dataURL）；失败（image:error / dataUrl=null）
						// 不缓存，卡片可单独重试
						if (data.type === "image" && data.dataUrl) ketcherModule.cache[pending.key] = data.dataUrl;
						pending.resolve(data.type === "image" ? (data.dataUrl || null) : null, data.type === "image:error");
					}
				}
				if (data?.type === "phase") {
					// rc.4 review（§10.2）：iframe 回传当前阶段（loading/exporting），
					// 宿主按阶段**重置**超时——合法任务可在 30s 内完成（载入 15s +
					// 导出 20s），单一 30s 整单计时器会误杀；阶段宽限取 shell 内部
					// 阶段超时 + 通信余量（loading 25s / exporting 30s），另设 75s
					// 总护栏（> 15+20+通信余量）兜底任何单阶段消息丢失的卡死。
					const pending = ketcherModule.pending[data.requestId];
					if (pending && data.phase) {
						clearTimeout(pending.timer);
						const stageMs = data.phase === "loading" ? KETCHER_STAGE_LOADING_MS : KETCHER_STAGE_EXPORT_MS;
						pending.timer = setTimeout(() => {
							const row = ketcherModule.pending[data.requestId];
							if (row) row.resolve(null, true); // 超时后重建 iframe，隔离迟到的 Ketcher 操作
						}, stageMs);
					}
				}
				});
			}
			document.body.appendChild(frame);
			return frame;
		}
		/** 丢弃可能仍在执行旧 setMolecule/generateImage 的 iframe。
		 * Promise 超时不能取消 Ketcher 内部操作；复用同一编辑器会让迟到操作污染下一任务。 */
export function resetKetcherHiddenFrame() {
			const old = ketcherModule.iframe;
			ketcherModule.iframe = null;
			ketcherModule.ready = false;
			try { old?.remove(); } catch { /* noop */ }
			return ensureKetcherHiddenFrame();
		}
		/** 队列渲染 smiles → dataURL；重复或 iframe 不可用时返回 null。
		 *  0.4.0 WP1 + rc.4 §8：ready/载入/渲染/导出各自独立超时；失败立即
		 *  返回（不无限"渲染中"），单项失败只 resolve(null) 不阻塞队列后续。
		 *  队列中因 iframe 永不 ready 而超时的任务会被**彻底移除**（含 pending
		 *  清理），不会遗留大量 cancelled job 堆积。 */
export function ketcherRenderSmiles(smiles, { width = 560, height = 420, theme = KETCHER_DEFAULT_THEME, format = "png", timeoutMs = KETCHER_OVERALL_MS, readyTimeoutMs = 20000 } = {}) {
			const key = ketcherCacheKey(smiles, { width, height, theme, format });
			if (ketcherModule.cache[key]) return Promise.resolve(ketcherModule.cache[key]);
			ensureKetcherHiddenFrame();
			return new Promise((resolve) => {
				const queuedJob = { key, smiles: normName(smiles), width, height, theme, format, resolve };
				ketcherModule.queue.push(queuedJob);
				const drain = () => {
					if (ketcherModule.busy || !ketcherModule.queue.length) return;
					const job = ketcherModule.queue.shift();
					ketcherModule.busy = true;
					const requestId = `k${++ketcherModule.seq}`;
					// rc.4 review（§10.2）：分阶段超时。首段（loading，默认 25s > shell
					// 内部载入 15s + 余量）发出后，iframe 回传 {type:'phase'} 时按阶段
					// **重置**计时器（exporting 30s > shell 导出 20s + 余量）；overall
					// 75s 总护栏兜底任何阶段消息丢失。任何超时/失败都彻底删除 pending
					// 并继续队列；失败不写缓存（§10）。
					const settle = (dataUrl, resetFrame = false) => {
						if (!ketcherModule.pending[requestId]) return;
						if (ketcherModule.pending[requestId]) delete ketcherModule.pending[requestId];
						clearTimeout(stageTimer);
						clearTimeout(overallTimer);
						job.resolve(dataUrl);
						ketcherModule.busy = false;
						if (resetFrame) resetKetcherHiddenFrame();
						else drain();
					};
					const stageTimer = setTimeout(() => settle(null, true), KETCHER_STAGE_LOADING_MS);
					const overallTimer = setTimeout(() => settle(null, true), timeoutMs);
					ketcherModule.pending[requestId] = { key: job.key, smiles: job.smiles, timer: stageTimer, overall: overallTimer, resolve: settle };
					try {
						const activeFrame = ensureKetcherHiddenFrame();
						activeFrame.contentWindow.postMessage({ type: "render", smiles: job.smiles, requestId, width: job.width, height: job.height, theme: job.theme, format: job.format }, location.origin);
					} catch (error) {
						settle(null);
					}
				};
				// 等待隐藏 iframe 内 Ketcher 初始化（自身发 {type:'ready'}）；
				// ready 可能因资源缺失/加载失败永远不来：等满 readyTimeoutMs 后
				// 把该 job 从队列移除并 resolve(null)——绝不伪造 ready，也不留下
				// 大量永远等不到的 cancelled 任务（§8）。
				const deadline = Date.now() + readyTimeoutMs;
				const waitReady = () => {
					if (ketcherModule.ready) { drain(); return; }
					if (Date.now() > deadline) {
						const index = ketcherModule.queue.indexOf(queuedJob);
						if (index >= 0) ketcherModule.queue.splice(index, 1);
						queuedJob.resolve(null);
						return;
					}
					setTimeout(waitReady, 300);
				};
				waitReady();
			});
		}

export function readStepFieldValue(step, def) {
			const procedure = step.procedure || {};
			const raw = procedure[def.key];
			if (raw === undefined) return "";
			if (Array.isArray(raw)) {
				const items = raw.map((row) => {
					if (typeof row === "string") return row;
					if (def.key === "reagents") return [row.name, row.equivalent ? `(${row.equivalent})` : "", row.amount ? row.amount : ""].filter(Boolean).join(" ");
					if (def.key === "catalysts") return [row.name, row.loading ? `(${row.loading})` : ""].filter(Boolean).join(" ");
					if (def.key === "solvents") return [row.name, row.ratio ? `(${row.ratio})` : "", row.volume ? row.volume : ""].filter(Boolean).join(" ");
					if (def.key === "temperature") return [row.value, row.stage ? `(${row.stage})` : ""].filter(Boolean).join(" ");
					return Object.values(row).filter((v) => v !== undefined && v !== "").join(" ");
				});
				return items.filter(Boolean).join("；");
			}
			if (typeof raw === "object") {
				return [raw.value, raw.unit, raw.type, raw.text].filter((v) => v !== undefined && v !== "").join(" ");
			}
			return String(raw ?? "");
		}

		/** 某字段的 Evidence 命中（弱匹配 supportsField）。 */
export function evidenceForField(evidenceRows, hints) {
			return (evidenceRows || []).filter((row) => hints.some((hint) => String(row.supportsField || "").toLowerCase().includes(String(hint).toLowerCase())));
		}

export function evidenceLocator(row) {
			const bits = [];
			if (row.page !== undefined && row.page !== null && row.page !== "") bits.push(`p.${row.page}`);
			if (row.figure) bits.push(`Fig. ${row.figure}`);
			if (row.table) bits.push(`Table ${row.table}`);
			if (row.documentId) bits.push(row.documentId);
			return bits.join(" · ");
		}

export function evidenceByStep(evidence, step) {
			return (evidence || []).filter((row) => row.stepId === step.id || (row.stepId === undefined && row.stepKey !== undefined && Number(row.stepKey) === step.step));
		}

export function routeLevelEvidence(evidence) {
			return (evidence || []).filter((row) => row.stepId === undefined && row.stepKey === undefined);
		}

export function stepIsStructured(step) {
			return !!step.procedure && Object.keys(step.procedure).length > 0;
		}

export function resolveCompoundPreview(entry) {
			if (!entry?.smiles) {
				return { state: "not_found", message: "该化合物尚无结构式，点击在 Ketcher 中补绘" };
			}
			return { state: "resolvable", message: "", smiles: entry.smiles };
		}

export function stepCompoundsByRole(step, roles) {
			const wanted = new Set(roles);
			const seen = new Set();
			const out = [];
			for (const row of step?.structures ?? []) {
				const role = row.role || "unknown";
				if (!wanted.has(role)) continue;
				const key = normName(row.name);
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(row);
			}
			return out;
		}
