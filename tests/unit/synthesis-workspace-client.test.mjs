/**
 * Unit / 结构验收：0.4.0 三组件工作台客户端契约（client/index.js）。
 *
 * 仓库的客户端测试基线是“源码结构 + 远程描述符 + 服务端集成行为”三层：
 * 真实 DOM 交互由服务端集成测试与安装版人工验收覆盖（见 0.4.0_COMPLETION_PLAN
 * §4）。本文件锁住完成书 WP1–WP4 在 client 的硬约束：
 *  - WP2：三个全宽主组件真实渲染（非 CSS 隐藏），路线总览为 Ketcher 结构图流程；
 *  - WP1：缩略图缓存键含规范化结构/宽高/主题/渲染协议版本；失败可重试不无限渲染；
 *  - WP3：PubChem-only 自动写入口已降级删除；双源登记持久化 CAS/InChIKey；
 *  - WP4：三按钮（确认/修正/无法确认）、修正保留 userCorrection、批次远程描述符、
 *        无截图不确认、锁定三条件提示、全部完成才提交。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const clientPath = fileURLToPath(new URL("../../client/index.js", import.meta.url));
const remotePath = fileURLToPath(new URL("../../lib/remote.js", import.meta.url));

test("0.4.0 workspace: three full-width panels are genuinely rendered (no CSS-hide simulation)", async () => {
	const source = await readFile(clientPath, "utf8");
	// 三个主要组件：组件一（sw-graph 结构图路线）、组件二（sw04-detail）、组件三（sw04-fact）
	assert.match(source, /className: "sw-graph"/);
	assert.match(source, /className: "sw-sec sw04-detail"/);
	assert.match(source, /className: "sw-sec sw04-fact"/);
	// 步骤详情/事实核验组件只在选中步骤时渲染（联动）
	assert.match(source, /selectedStep && detail\s*\? h\("section", \{ className: "sw-sec sw04-detail"/);
	// StepReactionLayout 真实挂载在第二组件
	const mounts = source.match(/h\(StepReactionLayout/g) ?? [];
	assert.ok(mounts.length >= 1, "StepReactionLayout 必须有挂载调用点");
	// 旧版指标墙/分析块不再渲染（CSS 定义可留作死代码，但渲染层与隐藏冒充必须清除）
	assert.doesNotMatch(source, /className: "sw-metrics"/);
	assert.doesNotMatch(source, /className: "sw-analy-block"/);
	assert.doesNotMatch(source, /sw04-analysis/);
	assert.doesNotMatch(source, /Blocking Issues/);
	// 不允许以 display:none 把旧组件“藏起来冒充完成”
	assert.doesNotMatch(source, /\.sw-metrics[^}]*display:\s*none/);
	assert.doesNotMatch(source, /\.sw-analy-block[^}]*display:\s*none/);
	assert.doesNotMatch(source, /\.sw-cond\{[^}]*display:\s*none/);
	assert.doesNotMatch(source, /\.sw04-analysis[^}]*display:\s*none/);
});

test("0.4.0 workspace: overview flows by Ketcher structure nodes, not plain text cards", async () => {
	const source = await readFile(clientPath, "utf8");
	// 步骤卡渲染结构图流程：化合物节点（sw-step-chem-node）+ 反应箭头 + 条件摘要
	assert.match(source, /className: "sw-step-chem"/);
	assert.match(source, /sw-step-chem-node/);
	// rc.4 §3.1：总览点结构图先选中该步骤再用该步骤打开编辑器；StructureCard 本体可点击
	assert.match(source, /onClick: \(\) => openOverviewStructure\(step, entry\)/);
	assert.match(source, /const openOverviewStructure = \(targetStep, entry\) =>/);
	assert.match(source, /className: compact \? "sw-struct-card sw-struct-compact" : "sw-struct-card", "data-missing"/);
	assert.match(source, /"data-clickable": onClick \? "true" : undefined/);
	assert.match(source, /"sw-step-chem-arrow"/);
	// rc.4 §3.1：产物结构必须挂载，不可只显示反应物或被截掉
	assert.match(source, /className: "sw-step-chem-reactants", "data-role": "reactants"/);
	assert.match(source, /className: "sw-step-chem-products", "data-role": "products"/);
	assert.match(source, /structureRow\(productEntries, step\.products, "products"\)/);
	assert.doesNotMatch(source, /entries\.slice\(0, 3\)/, "总览结构不允许 slice 截断");
	// 旧文字 flow 不再作为步骤卡主体渲染（sw-step-flow 只剩死 CSS 定义）
	assert.doesNotMatch(source, /className: "sw-step-flow"/);
	// 结构节点携带名称与 CAS（所有结构显示名称/CAS）
	assert.match(source, /entry\.casNumber \? `CAS \$\{entry\.casNumber\}` : "CAS 待确认"/);
	// rc.4 §7：步骤卡不再常驻 Evidence 数量与审核状态标签（sw-step-foot 渲染已删除）
	assert.doesNotMatch(source, /h\("span", \{ className: "sw-step-foot"/);
	assert.doesNotMatch(source, /`Evidence \$\{stepEv\.length\}`/);
	assert.doesNotMatch(source, /"已人工确认"/);
});

test("0.4.0 workspace: two-column reaction layout with full condition coverage", async () => {
	const source = await readFile(clientPath, "utf8");
	// StepReactionLayout：反应物 → 条件网格 → 产物
	assert.match(source, /sw04-reaction/);
	assert.match(source, /"sw04-cond-grid"/);
	// 中栏覆盖 11 类条件字段（STEP_FIELD_DEFS 全量渲染）
	for (const label of ["试剂", "催化剂", "溶剂", "温度", "时间", "气氛", "浓度", "收率", "后处理", "纯化", "监测"]) {
		assert.ok(source.includes(`label: "${label}"`), `STEP_FIELD_DEFS 应覆盖「${label}」`);
	}
	// 不再追加旧式长条件表（删除 sw-cond 表格渲染）
	assert.doesNotMatch(source, /h\("table", \{ className: "sw-cond"/);
	// 分析与决策只保留 ≤50 字难点
	assert.match(source, /difficultySummary/);
	assert.match(source, /sw04-difficulty/);
});

test("0.4.0 review: three human decisions, correction keeps original+correction, submit gate", async () => {
	const source = await readFile(clientPath, "utf8");
	// 三项人工决定：确认 / 修正 / 无法确认
	assert.match(source, /"确认"/);
	assert.match(source, /"修正"/);
	assert.match(source, /"无法确认"/);
	// 修正：保存 userCorrection 且保留 originalExtract
	assert.match(source, /status: "corrected", correction/);
	assert.match(source, /userCorrection/);
	assert.match(source, /originalExtract/);
	// 无截图依据不能“确认”（截图核验门禁），缺截图原因在 UI 明示
	assert.match(source, /不能计为截图核验完成/);
	assert.match(source, /截图核验不可用/);
	// 全部事实完成前不能提交给 Agent
	assert.match(source, /全部事实完成后才能提交/);
	assert.match(source, /交给 Agent 更新未确定项/);
});

test("0.4.0 review batches: remote descriptors + server apply are wired", async () => {
	const [client, remote] = await Promise.all([readFile(clientPath, "utf8"), readFile(remotePath, "utf8")]);
	for (const method of ["synth_review_batch_create", "synth_review_batch_get", "synth_review_batch_complete", "synth_review_uncertain_apply"]) {
		assert.ok(client.includes(`direct("${method}", ["request"])`), `client 需注册 ${method}`);
		assert.ok(remote.includes(`markRemote(LabRemoteService.prototype, "${method}")`), `remote 需 markRemote ${method}`);
	}
	// 锁定阻断原因在 UI 呈现（待审事实/运行中批次/缺截图）
	assert.match(client, /lockBlockers/);
	assert.match(client, /锁定被阻断/);
});

test("0.4.0 dual-source: pubchem-only auto-write entry removed and registration persists CAS/InChIKey", async () => {
	const source = await readFile(clientPath, "utf8");
	// PubChem 单源自动写入入口已从工作台删除（只能经双源候选/人工确认登记）
	assert.doesNotMatch(source, /resolveStepSmiles/);
	assert.doesNotMatch(source, /synth_step_resolve_smiles/);
	// 双源登记携带 CAS / InChIKey / verification（最终结构记录持久化）
	assert.match(source, /casNumber: item\.casNumber \|\| undefined/);
	assert.match(source, /inchiKey: item\.inchiKey \|\| undefined/);
	assert.match(source, /verification: \{ status: item\.status/);
	assert.match(source, /"双源核验 · PubChem \/ CACTUS"/);
});

test("0.4.0 ketcher: cache key covers structure/width/height/theme/protocol/format and failures retry", async () => {
	const source = await readFile(clientPath, "utf8");
	// 渲染协议版本常量 + 缓存键函数（规范化结构 | 宽高 | 主题 | 导出格式 | 协议版本）
	assert.match(source, /const KETCHER_RENDER_PROTOCOL = 1/);
	assert.match(source, /function ketcherCacheKey\(smiles, \{ width = 560, height = 420, theme = KETCHER_DEFAULT_THEME, format = "png" \}/);
	assert.match(source, /`v\$\{KETCHER_RENDER_PROTOCOL\}\|\$\{normName\(smiles\)\}\|\$\{Number\(width\) \|\| 560\}x\$\{Number\(height\) \|\| 420\}\|\$\{String\(theme/);
	assert.match(source, /\$\{format === "svg" \? "svg" : "png"\}\`/, "缓存键必须含导出格式（§8：PNG/SVG 不混用）");
	// ready 与渲染分别超时；失败只 resolve(null) 不阻塞队列（不伪造 ready）；
	// rc.4 §8：ready 永不来的任务从队列彻底移除，不遗留 cancelled job 堆积
	assert.match(source, /readyTimeoutMs = 20000/);
	// rc.4 review §10.2：不再用短于子阶段之和的单一整单 30s——总护栏 75s（>
	// 15s 载入 + 20s 导出 + 通信余量），首段 25s，iframe 回传 phase 后按阶段重置
	assert.match(source, /const KETCHER_OVERALL_MS = 75000/, "总护栏必须大于各子阶段之和");
	assert.match(source, /const KETCHER_STAGE_LOADING_MS = 25000/);
	assert.match(source, /const KETCHER_STAGE_EXPORT_MS = 30000/);
	assert.match(source, /timeoutMs = KETCHER_OVERALL_MS/, "渲染默认护栏引用常量");
	assert.match(source, /宿主按阶段\*\*重置\*\*超时/, "iframe 回传 phase 后宿主按阶段重置计时器");
	assert.match(source, /pending\.timer = setTimeout\(/, "phase 消息重置当前阶段计时器");
	assert.match(source, /data\.phase === "loading" \? KETCHER_STAGE_LOADING_MS : KETCHER_STAGE_EXPORT_MS/, "loading/exporting 阶段分别宽限");
	assert.match(source, /ready 可能因资源缺失\/加载失败永远不来/);
	assert.match(source, /绝不伪造 ready/);
	assert.match(source, /const index = ketcherModule\.queue\.indexOf\(queuedJob\)/);
	assert.match(source, /ketcherModule\.queue\.splice\(index, 1\)/);
	// 失败结果不缓存（允许卡片重试），卡片有独立重试按钮；
	// rc.4：成功才缓存（image 且 dataUrl），image:error / dataUrl=null 一律不缓存
	assert.match(source, /失败项不缓存以便点击重试/);
	assert.match(source, /if \(data\.type === "image" && data\.dataUrl\) ketcherModule\.cache\[pending\.key\] = data\.dataUrl;/);
	assert.match(source, /pending\.resolve\(data\.type === "image" \? \(data\.dataUrl \|\| null\) : null, data\.type === "image:error"\)/);
	assert.match(source, /function resetKetcherHiddenFrame\(\)/, "超时/失败后重建 iframe，防止迟到操作污染后续渲染");
	assert.match(source, /row\.resolve\(null, true\)/, "阶段超时必须触发 iframe 隔离重建");
	assert.match(source, /"重试预览"/);
	// 同一结构不同尺寸/主题/格式不会错误复用缩略图
	assert.match(source, /同一结构不同尺寸\/主题\/格式不会错误复用彼此缩略图/);
});

test("rc.4 review §3: EvidenceShot Object URL lifecycle — probe must not revoke/confirm early; ready gated on visible img", async () => {
	const source = await readFile(clientPath, "utf8");
	// 探测成功后不允许立即 revoke（同一 URL 交给实际展示 <img>）
	assert.doesNotMatch(source, /probe\.onload = \(\) => \{ URL\.revokeObjectURL\(objectUrl\); resolve\(objectUrl\); \};/);
	assert.match(source, /probe\.onload = \(\) => resolve\(objectUrl\);/, "probe 成功只解析 URL，不 revoke、不触发 ready");
	assert.match(source, /此处成功\*\*不得\*\* revoke/, "probe 成功后保留 URL 供实际展示");
	// onReady 由实际展示 <img>.onLoad（handleImageLoad）触发，而非隐藏 probe
	assert.match(source, /const handleImageLoad = \(\) => \{/, "存在实际图片 onLoad 处理器");
	assert.match(source, /onReady\?\.\(row\.id\)/, "onReady 在展示层触发");
	assert.match(source, /「用户实际看到」的仲裁点：仅实际展示 <img> 成功解码渲染才放行/);
	// 实际 <img> onError 撤销 ready 并上报 onFailed
	assert.match(source, /const handleImageError = \(\) => \{/, "存在实际图片 onError 处理器");
	assert.match(source, /h\("img", \{ src, alt: caption, title: caption, onLoad: handleImageLoad, onError: handleImageError \}\)/, "展示 <img> 同时挂 onLoad/onError");
	// 展示 <img> 加载失败撤销 ready（即便 probe 曾成功）
	assert.match(source, /截图实际显示失败（图片加载错误）/, "img onError 撤销 ready 并给出可行动原因");
	// Object URL 用 ref 保存（cleanup 不捕获旧 src）；卸载/切换/重载时释放
	assert.match(source, /const objectUrlRef = useRef\(null\); \/\/ 当前展示中的 Object URL/);
	assert.match(source, /const releaseCurrentUrl = \(\) => \{/, "统一释放入口");
	assert.match(source, /loadSeqRef\.current \+= 1; \/\/ 使任何在途响应过期/, "卸载/重载使在途请求过期");
	// 竞态防护：请求序号 + AbortController，旧请求不得覆盖新 Evidence 状态
	assert.match(source, /const abortRef = useRef\(null\); \/\/ 在途 fetch 的 AbortController/);
	assert.match(source, /seq !== loadSeqRef\.current/, "旧请求晚回被序号丢弃");
	assert.match(source, /reason\?\.name === "AbortError"/, "主动取消不改变 UI");
	assert.match(source, /setState\("off"\)/, "Evidence 失去原文定位后必须显式回到 off 状态");
	assert.doesNotMatch(source, /row\?\.shotVerification\?\.status === "ready"\) return true/, "历史 ready 不得绕过本次可见截图加载");
	assert.match(source, /kind=\$\{documentKind\}/, "截图请求必须区分正文与 SI");
});

test("rc.4 review §5: route lock leaves the remote gateway — client locks via loopback user-action endpoint", async () => {
	const source = await readFile(clientPath, "utf8");
	// 描述符清单不再声明 synth_route_lock（锁定已移出 Remote/Agent 网关）
	assert.doesNotMatch(source, /direct\("synth_route_lock"/, "client 不再经 ctx.remote.lab 调用锁定");
	assert.doesNotMatch(source, /call\("synth_route_lock"/, "锁定动作不再走通用 remote 通道");
	// 锁定按钮改 POST 专用 user-action 端点（同源 + 意图 header + 显式 POST）
	assert.match(source, /fetch\("\/api\/lab-user-action\/lock-route"/, "锁定走专用 user-action 端点");
	assert.match(source, /"x-lab-user-action": "lock-route"/, "携带意图 header（CSRF 防护）");
	assert.match(source, /method: "POST"/, "显式 POST（浏览器同源动作）");
	// 结构化阻断原因仍在 UI 展示（服务端三条件门禁）
	assert.match(source, /setLockBlockers\(result\.blockers\)/, "409 blockers 仍映射到阻断面板");
	assert.match(source, /setLockBlockers\(\[\]\)/, "成功后清除阻断面板");
});
