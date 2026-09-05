// 共享 label 常量、ketcher 常量、状态映射（从原 client/index.js 单文件抽离）。
export const ROUTE_ORIGIN_LABEL = { "literature-extracted": "文献提取", "human-edited": "人工修改", "agent-optimized": "Agent 优化", retrosynthesis: "逆向候选" };
export const ROUTE_STATUS_LABEL = { draft: "draft·草稿", "under-review": "under-review·待审核", approved: "approved·已批准", rejected: "rejected·已驳回" };
export const EVIDENCE_SOURCE_LABEL = { "paper-si": "Supporting Info", "paper-main": "正文/Scheme", "cited-method": "引用方法", "similar-literature": "相似文献", patent: "专利", "reaction-db": "反应数据库", "compound-db": "化合物库", internal: "内部 SOP", "model-inference": "Agent 推断" };
export const EVIDENCE_REL_LABEL = { supports: "支持", conflicts: "冲突", context: "背景" };
export const EVIDENCE_REVIEW_LABEL = { pending: "待审", confirmed: "已确认", edited: "已修订", rejected: "已驳回" };
export const LEVEL_LABEL = { green: "绿·可行", yellow: "黄·需验证", red: "红·阻断", unknown: "未知" };
export const LEVEL_TEXT = { green: "🟢", yellow: "🟡", red: "🔴", unknown: "⚪" };

		/** 步骤展示行定义（结构化优先；legacy 兜底在 readStepRowValues 中处理）。 */
export const STEP_FIELD_DEFS = [
			{ key: "reagents", label: "试剂", hints: ["reagents", "试剂"] },
			{ key: "catalysts", label: "催化剂", hints: ["catalysts", "催化剂"] },
			{ key: "solvents", label: "溶剂", hints: ["solvents", "溶剂"] },
			{ key: "temperature", label: "温度", hints: ["temperature", "温度"] },
			{ key: "time", label: "时间", hints: ["time", "时间"] },
			{ key: "atmosphere", label: "气氛", hints: ["atmosphere", "气氛"] },
			{ key: "concentration", label: "浓度", hints: ["concentration", "浓度"] },
			{ key: "yield", label: "收率", hints: ["yield", "收率"] },
			{ key: "workup", label: "后处理", hints: ["workup", "后处理"] },
			{ key: "purification", label: "纯化", hints: ["purification", "纯化"] },
			{ key: "monitoring", label: "监测", hints: ["monitoring", "监测"] }
		];

		// ── 0.3.2 Ketcher 基础设施（模块级单例，供工作台各步骤复用）─────────
export const KETCHER_URL = "/api/lab-ketcher/index.html";
		// RC2：Evidence 原文 PDF 定位查看器（审核抽屉内嵌）。
export const PDF_VIEWER_URL = "/api/lab-pdf-viewer/index.html";
		// rc.4 review（§10.2）阶段宽限常量：shell 内部载入 15s/导出 20s，
		// 宿主侧宽限取阶段超时 + 通信余量；总护栏 75s 兜底阶段消息丢失。
export const KETCHER_STAGE_LOADING_MS = 25000;
export const KETCHER_STAGE_EXPORT_MS = 30000;
export const KETCHER_OVERALL_MS = 75000;
		// 渲染协议版本：宿主↔ketcher-shell 的消息约定；升级 shell 协议时递增，
		// 使旧缓存自动失效（0.4.0 WP1：缓存键包含渲染协议版本）。
export const KETCHER_RENDER_PROTOCOL = 1;
export const KETCHER_DEFAULT_THEME = "#ffffff";
		// 名称归一化：结构与服务端 hydrate 一致（去空白）。
export const normName = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const STRUCTURE_SOURCE_LABEL = { agent: "登记", pubchem: "PubChem", manual: "Ketcher", entity: "实体库" };
export const databaseState = (state) => ({ available: "可用", connected: "已连接", degraded: "受限", "auth-required": "需登录", "waiting-user": "等待登录", "agreement-required": "待勾选协议", "verification-required": "待验证", unavailable: "不可用", "not-supported": "不适用", idle: "未连接", "browser-open": "浏览器已打开", expired: "已过期", error: "异常", unknown: "未知" })[state] || state || "未知";
export const databaseStateTone = (state) => ({ "data-ok": ["available", "connected"].includes(state) ? "true" : undefined, "data-warn": ["auth-required", "waiting-user", "agreement-required", "verification-required", "degraded", "browser-open", "idle"].includes(state) ? "true" : undefined });
export const downloadState = (state) => ({ queued: "排队中", "resolving-oa": "查找 OA", "waiting-login": "等待登录", "opening-publisher": "打开出版商", "locating-pdf": "定位 PDF", downloading: "校验中", completed: "已完成", "no-access": "无订阅权限", "verification-required": "需人工验证", failed: "失败" })[state] || state;
