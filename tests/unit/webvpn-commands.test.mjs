import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const shellSource = () => read("desktop/src/index.html");
const mainSource = () => read("desktop/src-tauri/src/main.rs");
const webvpnSource = () => read("desktop/src-tauri/src/webvpn.rs");

test("内部命令不得用 location.href 导航，必须走 window.open", async () => {
	const webvpn = await webvpnSource();
	const chrome = webvpn.match(/const WEBVPN_CHROME_SCRIPT: &str = r#"([\s\S]*?)"#;/)?.[1];
	assert.ok(chrome, "必须能提取注入的工具栏脚本");
	assert.doesNotMatch(chrome, /location\.href = 'ibm-webvpn/, "不得再用导航发送内部命令");
	assert.doesNotMatch(chrome, /location\.href = `ibm-webvpn/, "不得再用导航发送内部命令");
	assert.match(
		chrome,
		/const notifyShell = \(target\) => \{[\s\S]*?window\.open\(`ibm-webvpn:\/\/\$\{target\}`, '_blank'\)/,
		"工具栏壳必须用 window.open 送回内部命令",
	);
	// 命令要能在新窗口路径上被处理（页面改用 window.open 后走 on_new_window）。
	assert.match(webvpn, /fn handle_internal_command\(app: &AppHandle, url: &url::Url\) -> bool/);
	assert.match(
		webvpn,
		/on_new_window[\s\S]*?handle_internal_command\(&window_app, &url\)[\s\S]*?NewWindowResponse::Deny/,
		"on_new_window 必须处理内部命令并拒绝弹窗",
	);
	assert.match(webvpn, /on_navigation[\s\S]*?handle_internal_command\(&navigation_app, &url\)/);
});

test("捕获小球显示队列、可逐条删除、完成后不消失", async () => {
	const [webvpn, shell, main, client] = await Promise.all([
		webvpnSource(), shellSource(), mainSource(), read("client/src/components-literature.js"),
	]);
	// 小球：队列 DOM、逐条删除、结束态保留并可关闭。
	assert.match(webvpn, /class="queue"/);
	assert.match(webvpn, /captureBall\.dataset\.settled = finished \? 'true' : 'false'/);
	assert.match(webvpn, /notifyShell\('cancel-task\/' \+ encodeURIComponent\(id\)\)/);
	assert.match(webvpn, /notifyShell\('notice-dismiss\/'\)/);
	assert.doesNotMatch(webvpn, /captureBall\.disabled = finished/, "结束后不能禁用小球（否则关不掉）");
	// Rust：负载带队列与 pendingId；队列非空时不再返回 null。
	assert.match(webvpn, /"queue": queue,/);
	assert.match(webvpn, /"pendingId": pending\.task_id/);
	assert.match(webvpn, /pub fn set_capture_queue/);
	assert.match(webvpn, /if queue\.is_empty\(\) \{\s*return "null"\.to_string\(\);/);
	// 通道：客户端上报 → 壳 invoke → Rust 命令已注册；删除 → 壳钩子 → 客户端 → 插件。
	assert.match(shell, /invoke\('webvpn_set_capture_queue'/);
	assert.match(shell, /window\.__ibmBallCancelTask/);
	assert.match(main, /fn webvpn_set_capture_queue\(/);
	assert.match(client, /sendWebVpnBallQueue\(listed\?\.tasks \|\| \[\], listed\?\.notice\)/);
	assert.match(await read("client/src/lib.js"), /WEBVPN_CANCEL_TASK/);
	// 页面不可信：删除只接受当前队列快照里的 id。
	assert.match(webvpn, /url\.host_str\(\) == Some\("cancel-task"\)/);
	assert.match(webvpn, /state\.queue_contains\(&task_id\)/);
});


test("空白弹窗不能覆盖唯一文献 WebView", async () => {
	const webvpn = await webvpnSource();
	assert.match(webvpn, /on_new_window[\s\S]*?if !matches!\(url\.scheme\(\), "http" \| "https"\)[\s\S]*?return NewWindowResponse::Deny;/);
});

/** `invoke('name', ...)` 里的命令名。辅助函数本身是 `invoke(command, args)`，不含引号，不会被收录。 */
const invokedCommands = (shell) =>
	[...new Set([...shell.matchAll(/invoke\('([^']+)'/g)].map((match) => match[1]))];

/** `generate_handler![...]` 里已注册的命令。 */
const registeredCommands = (main) => {
	const block = main.match(/generate_handler!\[([\s\S]*?)\]/);
	assert.ok(block, "main.rs 必须存在 generate_handler![...] 注册块");
	return new Set(
		block[1]
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	);
};

test("desktop shell 调用的每个命令都已在 Rust 端注册", async () => {
	const [shell, main] = await Promise.all([shellSource(), mainSource()]);
	const registered = registeredCommands(main);
	const missing = invokedCommands(shell).filter((name) => !registered.has(name));
	// 漏注册不会编译报错，只在用户点下去的那一刻才炸——所以必须由测试兜住。
	assert.deepEqual(missing, [], `以下命令被 shell 调用但未注册进 generate_handler!: ${missing.join(", ")}`);
});

test("开发探测后端无法从 release 构建抵达，且诊断页不再暴露探测界面", async () => {
	const [shell, main, webvpn] = await Promise.all([shellSource(), mainSource(), webvpnSource()]);
	// 探测模式判定的唯一来源必须是构建类型，不得由配置或运行时开关决定。
	assert.match(webvpn, /pub fn probe_available\(\) -> bool \{\s*cfg!\(debug_assertions\)\s*\}/);
	// 唯一会以「只记录不拦截」策略打开窗口的命令必须显式拒绝 release。
	const probeCommand = main.match(/fn webvpn_probe_open\([\s\S]*?\n\}/);
	assert.ok(probeCommand, "必须存在 webvpn_probe_open 命令");
	assert.match(
		probeCommand[0],
		/if !webvpn::WebVpnState::probe_available\(\)\s*\{\s*return Err\(/,
		"打开探测窗口前必须校验 probe_available() 并拒绝",
	);
	// 已完成开发探测后，正式诊断页不再暴露实验面板或其命令入口。
	assert.doesNotMatch(shell, /id="webvpn-probe"|WebVPN 探测（仅开发构建）/);
	assert.doesNotMatch(shell, /invoke\('webvpn_probe_available'\)|invoke\('webvpn_probe_open'/);
});

test("WebVPN 日志只写脱敏后的 URL", async () => {
	const webvpn = await webvpnSource();
	// 注意：文件里有两个 `fn record(`——`WebVpnState::record` 方法与模块级落日志入口，
	// 因此必须按完整签名定位，否则会抓到方法而去断言一个不存在的属性。
	const record = webvpn.match(
		/fn record\(app: &AppHandle, kind: &str, raw_url: &str, detail: &str\)[\s\S]*?\n\}/,
	);
	assert.ok(record, "必须存在模块级 record 这一唯一落日志入口");
	const body = record[0];
	assert.match(body, /let url = redact_for_log\(raw_url\);/, "记录前必须先脱敏");
	// 日志行里只能出现脱敏结果；出现 raw_url 就意味着原始 URL（含一次性令牌）会落盘。
	assert.doesNotMatch(body, /logger\(\)\.write[\s\S]*?raw_url/, "日志行不得引用未脱敏的 raw_url");
});

test("WebVPN 使用同窗子 WebView，登录 profile 隔离且可隐藏复用", async () => {
	const webvpn = await webvpnSource();
	// 专属 WebView2 profile：登录态不能和主窗口共用。
	assert.match(webvpn, /const PROFILE_DIR_NAME: &str = "webvpn-webview2"/);
	assert.match(webvpn, /\.data_directory\(profile_dir\)/);
	// 单例判定只认 label，不认标题或 URL。
	assert.match(webvpn, /pub const WINDOW_LABEL: &str = "webvpn"/);
	assert.match(webvpn, /main_window[\s\S]*?\.add_child\(/, "必须通过官方 add_child 创建同窗侧栏");
	assert.match(webvpn, /app\.get_webview\(WINDOW_LABEL\)/);
	// 收起：只隐藏、不销毁子 WebView（登录态不丢）。主 WebView 恢复全宽只属于旧的
	// 按比例分栏路径；DSH 右侧栏接管布局后主 WebView 本来就是全宽，不得再动它。
	const hideSidebar = webvpn.match(/pub fn hide_sidebar\([\s\S]*?\n\}/);
	assert.ok(hideSidebar, "必须存在 hide_sidebar");
	assert.match(hideSidebar[0], /webview\.hide\(\)/, "收起必须只隐藏、不销毁子 WebView");
	assert.match(
		hideSidebar[0],
		/if !client_layout \{[\s\S]*?main\.set_bounds\(/,
		"只有未由右侧栏接管布局时才恢复主界面全宽",
	);
});

test("导航白名单仍保留后端放行能力，但不再占用诊断页", async () => {
	const [shell, webvpn, main] = await Promise.all([shellSource(), webvpnSource(), mainSource()]);
	// 被拦域名必须被记住，否则用户只会看到静默空白页，无从自救。
	assert.match(webvpn, /denied_hosts/);
	assert.match(webvpn, /pub fn allow_host\(/);
	// 放行要写回配置，否则重启后又被拦一次。
	assert.match(main, /webvpn_allow_host[\s\S]*?save_webvpn_config\(/);
	// 开发探测 UI 已移除，正式用户流程由文献页的 WebVPN 状态入口负责。
	assert.doesNotMatch(shell, /deniedHosts|invoke\('webvpn_allow_host'/);
});

test("文献捕获通过受限 shell 契约进入 WebVPN", async () => {
	const [shell, main, webvpn, client, apply, projectPanel, literaturePanel, styles] = await Promise.all([
		shellSource(),
		mainSource(),
		webvpnSource(),
		read("client/src/lib.js"),
		read("client/src/apply.js"),
		read("client/src/components-project.js"),
		read("client/src/components-literature.js"),
		read("client/src/styles.js"),
	]);
	assert.match(client, /WEBVPN_STATUS/);
	assert.match(client, /WEBVPN_OPEN_CAPTURE/);
	assert.match(client, /WEBVPN_SHOW/);
	assert.match(client, /WEBVPN_CLEAR_SESSION/);
	assert.match(shell, /invoke\('webvpn_open_capture'/);
	assert.match(shell, /invoke\('webvpn_show'/);
	assert.match(shell, /invoke\('webvpn_clear_session'/);
	assert.match(main, /fn webvpn_open_capture\(/);
	assert.match(main, /fn webvpn_cancel_capture\(/);
	assert.match(webvpn, /build_wrd_proxy_url/);
	assert.match(webvpn, /claim_download_destination/);
	assert.match(webvpn, /upload_capture/);
	assert.match(webvpn, /downloaded_bytes/);
	assert.match(webvpn, /download_elapsed_ms/);
	assert.match(webvpn, /download_event_bytes/);
	assert.match(projectPanel, /status\.downloadEventBytes/);
	assert.match(webvpn, /DownloadDecision::Duplicate/);
	assert.match(webvpn, /WEBVPN_CHROME_SCRIPT/);
	assert.match(webvpn, /notifyShell\('session\/ready'\)/);
	assert.match(webvpn, /isForwardedPage/);
	assert.match(webvpn, /state\.mark_authenticated\(\)/);
	assert.match(webvpn, /AGENT_OBSERVE_SCRIPT/);
	assert.doesNotMatch(webvpn, /PUBLISHER_DOWNLOAD_AUTOMATION/);
	assert.match(webvpn, /PageLoadEvent::Finished/);
	assert.match(webvpn, /stampPDF\/getPDF/);
	assert.match(webvpn, /\/doi\/pdf\//);
	assert.match(webvpn, /\/pdfft/);
	assert.match(webvpn, /should_capture_direct_si_preview/);
	assert.match(webvpn, /download_springer_family_si_direct/);
	assert.match(webvpn, /已拦截 SI 预览导航并直接捕获附件/);
	assert.match(webvpn, /fs::remove_file\(&upload\.path\)/, "归档成功后必须删除唯一临时文件");
	assert.match(webvpn, /DownloadDecision::PassThrough => allow = false/, "侧栏不得把非捕获下载写进系统下载目录");
	assert.doesNotMatch(webvpn, /class="tabs"/, "标签切换应由 DSH 侧栏承担，不再覆盖第二层标签栏");
	assert.doesNotMatch(webvpn, /sessionStorage\.setItem\(stateKey/, "不再以网页 sessionStorage 模拟标签页");
	assert.match(webvpn, /aria-label="网址"/);
	assert.match(webvpn, /data-action="back"/);
	assert.match(webvpn, /data-action="forward"/);
	assert.match(webvpn, /data-action="reload"/);
	assert.match(webvpn, /收起导航栏/);
	assert.match(webvpn, /width \/ 3\.0/, "文献浏览器应占主窗口宽度的三分之一");
	assert.match(main, /None => \([\s\S]{0,120}?webvpn::open_window\(/, "点击正文应自动创建 WebVPN 侧栏");
	assert.doesNotMatch(projectPanel, /正文尚未创建下载任务/, "面板下载必须先创建任务，由用户在侧栏中手动完成后续操作");
	assert.doesNotMatch(projectPanel, /点击“我已登录”/);
	// 指示器已按人工审核移到桌面壳顶栏（课题页里不再有）。
	// 连接状态是**两个独立控件**（不做合并入口）：各自一个状态点，
	// 红点 WebVPN 点击打开机构认证页，红点 iWAN 点击拉起 iWAN 客户端。
	assert.doesNotMatch(literaturePanel, /ib-webvpn-dot/);
	assert.match(shell, /id="webvpn-indicator"/);
	assert.match(shell, /id="iwan-indicator"/);
	assert.match(shell, /id="webvpn-indicator-dot"/);
	assert.match(shell, /id="iwan-indicator-dot"/);
	assert.match(shell, /invoke\('open_iwan'\)/);
	assert.match(shell, /invoke\('webvpn_status'\)/);
	assert.match(shell, /invoke\('iwan_status'\)/);
	assert.match(shell, /postToFrame\('OPEN_WEBVPN_REQUEST'\)/);
	assert.match(client, /installShellRequestBridge/);
	assert.match(apply, /installShellRequestBridge\(\)/);
	assert.doesNotMatch(literaturePanel, /webvpn\?\.windowOpen && webvpn\?\.authenticated/, "课题页不再自己渲染 WebVPN 登录态");
	// 但是「AI 下载队列在领取令牌前复核桌面状态」这条链路必须留着——它不依赖那个面板。
	assert.match(literaturePanel, /manual_capture_desktop_status_update/);
	assert.match(projectPanel, /已在 WebVPN 侧栏打开出版社页面，请手动点击/);
	assert.doesNotMatch(styles, /\.ib-webvpn-dot/, "指示器样式随功能一起搬去桌面壳");
	assert.match(shell, /\.indicator i\s*\{[^}]*background:\s*#ef4444/);
	assert.match(shell, /\[data-online=true\][^{]*\{[^}]*background:\s*#22c55e/);
	assert.match(projectPanel, /ib-capture-progress/);
	assert.match(projectPanel, /status\.downloadEventBytes/);
	assert.match(projectPanel, /下载并归档完成/);
	assert.match(projectPanel, /task\.size/);
	assert.match(projectPanel, /directSpringerSi/);
	assert.match(projectPanel, /manual_capture_cancel/);
	assert.match(projectPanel, /终止下载/);
	assert.match(projectPanel, /showWebVpnViaShell/);
	// 这条不变量的落点已移到 webvpn::cancel_capture_and_close（见下一条测试）。
	// 原来直接断言 main.rs 里的 webvpn_cancel_capture 函数体，但 `[\s\S]*?` 会一路
	// 跨到别的命令里去匹配 webview.close()——命令一旦只做转发就会"因为别处有"而通过。
	assert.match(main, /cancel_capture_and_close\(&app, Some\(&task_id\)\)/, "命令必须转发到唯一实现");
	assert.match(projectPanel, /正在查找出版社下载入口/);
	assert.match(projectPanel, /已点击下载入口/);
	assert.match(projectPanel, /等待浏览器确认文件下载/);
	assert.match(projectPanel, /"wiley"\]\.includes\(publisher\)/);
	assert.match(projectPanel, /已适配出版社固定在软件内/);
	assert.match(projectPanel, /tasks_report_delete/);
	assert.doesNotMatch(shell, /id="webvpn-toggle"/);
	assert.doesNotMatch(shell, /关闭侧栏 ×/);
	assert.match(shell, /directAccess:\s*data\.payload\?\.directAccess === true/);
	assert.match(main, /direct_access:\s*bool/);
	assert.match(webvpn, /is_direct_springer_family_si/);
	assert.doesNotMatch(shell, /automate:/);
	assert.doesNotMatch(main, /automate:\s*bool/);
	assert.match(shell, /IWAN_STATUS/);
	assert.match(main, /fn iwan_status/);
	assert.match(main, /let use_iwan = iwan\.usable/);
	assert.match(main, /!use_iwan && direct_access/, "iWAN 下不得启用 Springer SI 的后端拦截直取");
	assert.match(main, /use_iwan \|\| direct_springer_si/);
	// iWAN 状态文案与字段：随指示器一起搬到了桌面壳顶栏。
	assert.match(shell, /iWAN 全局模式可用/);
	assert.match(shell, /status\.usable/);
	assert.match(literaturePanel, /iwanUsable/, "AI 下载队列仍要按 iWAN 可用性选择路由");
});

test("原生 PDF 通过 WebView2 Save As 写入任务文件，校验后归档", async () => {
	const webvpn = await webvpnSource();
	assert.match(webvpn, /core25\.ShowSaveAsUI\(&handler\)/);
	assert.match(webvpn, /args\.SetSuppressDefaultDialog\(true\)/);
	assert.match(webvpn, /args\.SetSaveAsFilePath/);
	assert.match(webvpn, /args\.ContentMimeType/);
	assert.match(webvpn, /file_is_whole\(&poll_path\)/);
	assert.match(webvpn, /claim_native_saved_file\(task_id\)/);
	assert.match(webvpn, /claim_download_destination\(\)/);
	assert.match(webvpn, /请在侧栏 PDF 查看器按 Ctrl\+S/);
	assert.doesNotMatch(webvpn, /SendInput\(/);
	assert.doesNotMatch(webvpn, /Network\.loadNetworkResource/);
});

test("原生另存为失败可交接人工，并在验证页阻止 Agent 点击", async () => {
	const webvpn = await webvpnSource();
	assert.match(webvpn, /原生另存为未写出完整 PDF/);
	assert.match(webvpn, /clear_viewer_save_action\(task_id\)/);
	assert.match(webvpn, /observation_requires_verification\(&value\)/);
	assert.match(webvpn, /state\.verification_pending\(\)/);
	assert.match(webvpn, /"verificationRequired"/);
});

/**
 * 2026-09-11 实测缺陷：点「打开 WebVPN」跳出一个**纯白、看不到任何 UI** 的窗口。
 *
 * 根因是 Tauri 2.11.5 `WebviewWindowBuilder::new` 的 Windows 已知问题——
 * 在**同步命令**里建 WebView 窗口会死锁（wry#583）。窗口先建出来，WebView 挂不上，
 * 于是只剩一个白框；同时 `build()` 永不返回，`record()` 也到不了，webvpn.log 里
 * 一行都没有——"只出白窗、日志空白"正是这个缺陷的指纹。
 *
 * 编译期、命令注册表检查、既有全部测试都抓不到它，只能由下面两条断言兜住。
 */
test("建窗与操作窗口的 WebVPN 命令必须是 async", async () => {
	const main = await mainSource();
	// 覆盖全部会回到主线程操作窗口/WebView 的命令；`webvpn_status` 这类只读内存状态的
	// 命令不在其列，保持同步。
	for (const name of [
		"webvpn_probe_open",
		"webvpn_open_login",
		"webvpn_open_capture",
		"webvpn_cancel_capture",
		"webvpn_show",
		"webvpn_hide",
		"webvpn_set_rect",
		"webvpn_sync_capture_ball",
		"webvpn_clear_session",
	]) {
		const signature = main.match(new RegExp(`(async\\s+)?fn ${name}\\(`));
		assert.ok(signature, `必须存在命令 ${name}`);
		assert.ok(
			signature[1],
			`${name} 必须是 async 命令：Windows 上同步命令里建窗/操作窗口会死锁，表现为纯白空窗（Tauri 2.11.5 已知问题）`,
		);
	}
});

test("子 WebView 创建失败会清理残留并记录可诊断错误", async () => {
	const webvpn = await webvpnSource();
	const openWindow = webvpn.match(/pub fn open_window\([\s\S]*?\n\}/);
	assert.ok(openWindow, "必须存在 open_window");
	const body = openWindow[0];
	assert.match(body, /main_window[\s\S]*?\.add_child\(/, "必须使用同窗子 WebView API");
	assert.match(body, /show_sidebar\(app, &webview\)/, "创建成功后必须应用同窗布局并显示");
	assert.ok(
		body.indexOf("destroy_orphan_webview(app)") !== -1 &&
			/record\(\s*app,\s*"error"/.test(body),
		"创建失败必须回收残留 WebView 并把原因落进 webvpn.log",
	);
});

/**
 * 需求合并：WebVPN 浏览器不再由 Rust 自己按 width/3 分栏，而是作为**一类 DSH 右侧栏
 * 页面 tab**挂进 @deepseek-ai/dsh-client-ui-sidebar-right 的公开扩展面。
 *
 * 布局责任因此一分为二：DSH 右侧栏负责让位（push presentation），Rust 只按 tab 正文
 * 上报的矩形摆原生子 WebView。任何一半退化，都会表现为「浏览器浮在错误位置」或
 * 「主界面被莫名收窄」——这两条都由下面的断言兜住。
 */
test("文献浏览器作为 DSH 右侧栏 tab 接入，Rust 不再自行分栏", async () => {
	const [shell, webvpn, main, apply, tab, bridge] = await Promise.all([
		shellSource(),
		webvpnSource(),
		mainSource(),
		read("client/src/apply.js"),
		read("client/src/webvpn-tab.js"),
		read("client/src/webvpn-bridge.js"),
	]);

	// 1) 客户端：注册页面 tab 类型 + 同 key 的正文座位（与自带 sidebar-files 同一条公开路径）。
	assert.match(tab, /ctx\.sidebarRightTabs\.register\(\{/, "必须通过公开注册表登记 tab 类型");
	assert.match(tab, /id:\s*WEBVPN_TAB_ID/);
	assert.match(tab, /kind:\s*WEBVPN_TAB_KIND/);
	assert.match(tab, /ctx\.slots\.inject\("sidebar\.right\.pane\.tab"/, "正文必须注册到右侧栏 tab 座位");
	assert.match(tab, /key:\s*WEBVPN_TAB_ID/, "正文的 key 必须是类型的 id，否则座位找不到实现");
	// 只断言真正的注册对象，不看文件里的说明性注释。
	const definition = tab.match(/ctx\.sidebarRightTabs\.register\(\{([\s\S]*?)\n\t\}\)/);
	assert.ok(definition, "必须能提取 tab 类型定义");
	// 贡献 guide 条目 = 右侧栏「+」的类型列表里出现「文献浏览器」（更正需求）。
	// 代价：guide 条目从 1 变 2，宿主默认页由「文件」变为指南页——这是唯一扩展点。
	assert.match(definition[1], /guide:\s*\[\{/, "必须贡献 guide 条目，否则「+」里选不到浏览器");
	// 0.1.7 起 SidebarRightGuideEntry.id 必填且同一 provider 内唯一，register() 对重复 id 抛错。
	assert.match(definition[1], /guide:\s*\[\{\s*\n\s*id:\s*"[^"]+"/, "guide 条目必须带 0.1.7 要求的 id");
	assert.match(definition[1], /order:\s*\d+/);
	assert.match(definition[1], /title:\s*\(\)\s*=>/);
	// 初始页：正文首次可见时要主动把门户打开（「+」打开时没有目标地址）。
	assert.match(tab, /openWebVpnPortalViaShell/);
	assert.match(tab, /status\.windowOpen/, "载体已存在时不得重新导航到门户，否则会打断正在看的页面");
	// 注册与注销都在 ctx.effect 里，随插件生命周期起落。
	assert.match(tab, /ctx\.effect\(\(\) => \(\) => setWebVpnTabOpener\(null\)/);
	assert.match(apply, /ctx\.inject\(\["slots", "sidebarRightTabs", "sidebarRight"\]/, "右侧栏服务单独注入，缺失时不阻塞其余面板");
	assert.match(apply, /sidebarRight\.openTab\(WEBVPN_TAB_KIND\)/);

	// 2) 必须先等首次矩形上报，否则 webvpn_open_login 会先触发一次旧的分栏。
	assert.match(bridge, /await waitForWebVpnRect\(\)/);
	assert.match(bridge, /requestId:/, "桌面壳要求 requestId 非空，否则整条消息被丢弃");

	// 3) 桌面壳：把 tab 相对视口的坐标换算成主窗口客户区坐标。
	assert.match(shell, /data\.type === 'WEBVPN_SET_RECT'/);
	assert.match(shell, /frame\.getBoundingClientRect\(\)/);
	assert.match(shell, /x:\s*box\.left \+ Number\(payload\.x \|\| 0\)/);
	assert.match(shell, /y:\s*box\.top \+ Number\(payload\.y \|\| 0\)/);
	assert.match(shell, /invoke\('webvpn_set_rect'/);

	// 4) Rust：接管后主 WebView 完全不动，坏矩形一律按隐藏处理。
	const applyRect = webvpn.match(/pub fn apply_client_rect\([\s\S]*?\n\}/);
	assert.ok(applyRect, "必须存在 apply_client_rect");
	assert.doesNotMatch(applyRect[0], /main\.set_bounds|MAIN_WINDOW_LABEL/, "接管布局后不得再改动主 WebView");
	assert.match(applyRect[0], /state\.mark_client_layout\(\)/);
	assert.match(webvpn, /fn sanitize_client_rect\([\s\S]*?is_finite\(\)[\s\S]*?return None;/);
	assert.match(webvpn, /pub fn client_layout\(&self\)/, "show/hide/resize 需要读这个标志来分支");
	assert.match(webvpn, /if state\.as_ref\(\)\.map\(\|state\| state\.client_layout\(\)\)/, "show_sidebar 必须分支");
	assert.match(webvpn, /if !client_layout \{[\s\S]*?main\.set_bounds\(/, "旧分栏只在不接管时执行");
	assert.match(main, /async fn webvpn_set_rect\(/);
});

/**
 * 2026-09-22 人工审核缺陷：面板里点「尚未获取正文/SI」有时什么都不发生，用户只能靠
 * 顶部的「打开 WebVPN」自救。根因是 armCaptureFor 的两条分支只弹提示：
 *   * 已有任务在处理（pendingTaskId）时直接 return——浏览器被关掉后就再也回不来；
 *   * 未登记 DOI/出版社页面时只 notify——用户点它本意就是「去把它找来」。
 * 这两条路径都必须真的打开/带回软件内浏览器，下面按分支逐一断言。
 */
test("点「尚未获取」文献时一定会打开软件内浏览器（含两条只弹提示的旧分支）", async () => {
	const [projectPanel, literaturePanel, lib] = await Promise.all([
		read("client/src/components-project.js"),
		read("client/src/components-literature.js"),
		read("client/src/lib.js"),
	]);
	const arm = projectPanel.match(/const armCaptureFor = \(event, bundle, kind\) => \{[\s\S]*?\n\t\t\t\};/);
	assert.ok(arm, "必须能提取 armCaptureFor");
	const body = arm[0];

	// 未登记 DOI/出版社页面：必须打开门户，而不是只提示。
	const noPublisher = body.match(/if \(!publisherUrl\) \{[\s\S]*?\n\t\t\t\t\}/);
	assert.ok(noPublisher, "必须存在 !publisherUrl 分支");
	assert.match(noPublisher[0], /openWebVpnLoginViaShell\(\)/, "该分支必须真的打开浏览器到 WebVPN 门户");
	assert.doesNotMatch(noPublisher[0], /^\s*notify\([^)]*\);\s*return;/m, "不得退回成只弹提示");

	// 已有任务在处理：载体还在就必须把它带回前台。
	// 2026-09-23 回归：门只看「是否真在捕获中」；空闲时（含 WebVPN 登录后回到
	// ready）必须继续创建任务并导航，否则会停在门户首页——旧实现对同一篇直接
	// 早退，只显示浏览器不重新导航。
	const gate = body.match(/const captureInProgress =[\s\S]*?if \(captureInProgress\) \{[\s\S]*?\n\t\t\t\t\t\t\}/);
	assert.ok(gate, "必须存在 captureInProgress 门");
	assert.match(gate[0], /active\?\.pendingTaskId/, "门必须含 pendingTaskId");
	assert.match(gate[0], /waiting-download/, "门必须含会话中间态");
	assert.match(gate[0], /showWebVpnViaShell\(\)/, "已有任务时也必须把浏览器带回前台");
	assert.doesNotMatch(
		body,
		/captureHint\?\.bundleId === bundle\.id && captureHint\?\.kind === kind && active\?\.windowOpen/,
		"不得再对同一篇直接早退：空闲时必须重新导航，否则登录后停在门户",
	);
	assert.match(body, /await call\("manual_capture_create"/, "空闲路径必须能走到创建捕获任务");

	// 所有打开浏览器的出口都要经过 withWebVpnTab：先开右侧栏 tab，再调原生命令。
	for (const name of ["openWebVpnLoginViaShell", "openWebVpnCaptureViaShell", "showWebVpnViaShell"]) {
		assert.match(lib, new RegExp(`${name} = \\(\\)?[^\\n]*withWebVpnTab`), `${name} 必须先打开右侧栏 tab`);
	}
	// 正文自用的门户入口不重复 openTab，避免从 tab 内部再打开自己。
	assert.match(lib, /openWebVpnPortalViaShell = \(\) => webVpnShellRequest\("WEBVPN_OPEN_LOGIN"\)/);

	// 面板与对话徽章都不得存在「只提示、不打开」的旁路。
	assert.doesNotMatch(literaturePanel, /notify\([^)]*请在右侧 WebVPN[^)]*\);\s*return;/);
});

/**
 * 2026-09-22 人工审核缺陷 2：出版社 PDF 预览页里看不到预览器自己的工具栏按钮
 * （只能右键另存）。根因是注入的浏览器工具栏是 `position:fixed` 覆盖层，
 * 旧版高度 76px 且没有把页面推下去——预览器工具栏正好落在那条带里被盖住。
 *
 * 2026-09-23 回归：对 html 的**无条件**位移会让按视口居中的验证组件
 * （Cloudflare Turnstile 一类）上下抖动、渲染不出来（ScienceDirect 实测，
 * 外部 Edge 正常）。因此位移改为只在确认进入 PDF 预览器时由
 * `window.__ibmWebVpnSetPageOffset(true)` 打开，并带看门狗自动撤销。
 */
test("注入壳只在 PDF 预览器开启页面位移，且捕获小球可终止捕获", async () => {
	const webvpn = await webvpnSource();
	assert.match(webvpn, /const CHROME_HEIGHT = 42;/, "导航栏高度必须集中成一个常量");
	// 位移规则本身保留：对 html 施加 transform，它因此成为 position:fixed 后代的
	// 包含块，PDF 预览器那种 fixed;inset:0 的整屏容器才会一起下移。
	assert.match(
		webvpn,
		/html\{transform:translateY\(\$\{CHROME_HEIGHT\}px\) !important;height:calc\(100% - \$\{CHROME_HEIGHT\}px\) !important;overflow:auto !important\}/,
	);
	// 默认不位移：只能由显式开关打开，mount() 不得直接调用；白屏看门狗要能撤销。
	assert.match(webvpn, /window\.__ibmWebVpnSetPageOffset = \(enabled\) =>/);
	assert.match(webvpn, /notifyShell\('offset-reverted\/'\)/);
	const mountBody = webvpn.split("const mount = () => {")[1].split("if (document.readyState")[0];
	assert.doesNotMatch(mountBody, /applyPageOffset/, "mount() 不得对所有页面无条件位移");
	// Rust 侧只在**确证顶层文档是 PDF** 时才打开位移。
	assert.match(
		webvpn,
		/\.on_page_load[\s\S]*?is_pdf_document_url[\s\S]*?if pdf_document \{[\s\S]*?__ibmWebVpnSetPageOffset/,
		"只有 PDF 页面加载完成才开位移",
	);
	assert.match(webvpn, /is_pdf_document_url/);
	// 工具栏不能只等 DOMContentLoaded：验证页/被拦页面不会触发它，用户会连地址栏都看不到。
	assert.match(webvpn, /const mountNow = \(\) =>/, "工具栏必须能立即挂载并重试");
	assert.match(webvpn, /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', mountNow/);
	assert.match(webvpn, /mountNow\(\);\s*\n\s*\[250, 1200, 4000\]\.forEach/);
	// 工具栏自身必须等量反向抵消，否则会跟着 html 一起下移出屏幕。
	assert.match(webvpn, /translateY\(-\$\{CHROME_HEIGHT\}px\)/);
	assert.match(webvpn, /const syncChromeShift = \(\) =>/);

	// 捕获小球：独立浮标（不放在被反向位移的工具栏里）+ 状态入口 + 点击终止。
	assert.match(webvpn, /id = '__ibm_webvpn_capture'/);
	assert.match(webvpn, /window\.__ibmWebVpnCapture = \(payload\) =>/);
	assert.match(webvpn, /notifyShell\('cancel-capture\/'\)/);
	// 小球必须相对**窗口**固定在左下角。页面根元素有 transform，position:fixed 的后代
	// 会改以 html 为包含块（跟着页面滚动）；popover 的 top layer 不受祖先 transform
	// 影响，用它跳出。位置与逃逸方式都要被钉住——只改位置不改逃逸仍会滚走。
	assert.match(webvpn, /left:16px;bottom:16px;top:auto;right:auto/);
	// 右下角留给「保存到课题」浮层（2026-09-27 需求 R1）；小球自己必须钉在左下角。
	assert.match(webvpn, /notifyShell\('viewer-download\/'\)/, "右下角浮层必须能触发保存");
	assert.match(webvpn, /right:16px;bottom:16px;left:auto;top:auto/, "保存浮层固定在右下角");
	// 位置与逃逸方式都要被钉住：只改位置不改逃逸，按钮会跟着页面滚走。
	assert.match(webvpn, /host\.setAttribute\('popover', 'manual'\)/);
	assert.match(webvpn, /id = '__ibm_webvpn_save'/, "保存浮层要有自己的宿主元素");
	assert.match(webvpn, /syncCaptureSaveButton/, "保存浮层要由同一次状态推送驱动");
	assert.match(webvpn, /if \(!host\.matches\(':popover-open'\)\) host\.showPopover\(\)/);
	// 页面每次导航都会重新注入脚本、小球随之重建 → 加载完成后必须重推一次状态。
	assert.match(webvpn, /push_capture_ball\(&page_app, &webview\)/);
	// 导航拦截：点击小球 → 取消当前任务并关闭载体（不带 taskId，与按钮共用出口）。
	assert.match(webvpn, /url\.host_str\(\) == Some\("cancel-capture"\)/);
	assert.match(webvpn, /cancel_capture_and_close\(&action_app, None\)/);

	// 小球状态只暴露阶段/类别/字节，绝不能把令牌或临时路径送到页面里。
	const ball = webvpn.match(/pub fn capture_ball_json\(&self\) -> String \{[\s\S]*?\n    \}/);
	assert.ok(ball, "必须存在 capture_ball_json");
	// 只看真正发给页面的那份 JSON：函数体里读 temp_path 只是为了取文件大小。
	const payloads = [...ball[0].matchAll(/serde_json::json!\(\{[\s\S]*?\}\)/g)];
	// 队列条目映射 1 份 + 小球形态 4 份（新增归档冲突）。
	assert.equal(payloads.length, 5, "队列条目映射与四种小球形态都要有载荷");
	const shapes = payloads.filter((payload) => /"queue": queue/.test(payload[0]));
	assert.equal(shapes.length, 4, "四种小球形态都必须带队列");
	// 活动任务形态必须带实际阶段：优先用插件推导的 ballPhase（C20，工具与小球同源），
	// 客户端还没上报过这条任务时兜底成壳自己的 phase。
	assert.ok(
		shapes.some((shape) => /unwrap_or\(phase\)/.test(shape[0])),
		"活动任务形态必须带实际阶段"
	);
	assert.ok(
		shapes.some((shape) => /"ballText":/.test(shape[0])),
		"活动任务形态必须带插件推导的小球文案"
	);
	for (const payload of payloads) assert.doesNotMatch(payload[0], /"(?:token|tempPath|uploadUrl|path)"\s*:/, "载荷不得携带令牌或临时路径");
});

test("终止捕获只有一条实现：必须关闭 WebView2 且两处共用", async () => {
	const webvpn = await webvpnSource();
	const helper = webvpn.match(/pub fn cancel_capture_and_close\([\s\S]*?\n\}/);
	assert.ok(helper, "必须存在 cancel_capture_and_close");
	// WebView2 没有暴露取消下载句柄；不销毁子 WebView 就停不住网络传输。
	assert.match(helper[0], /webview\.close\(\)/, "终止捕获必须关闭 WebView2 以停止实际网络下载");
	assert.match(helper[0], /state\.mark_closed\(\)/, "窗口销毁后会话状态必须同步归位");
	assert.match(helper[0], /None => state\.cancel_pending_capture\(\)\?/, "小球不带 taskId 也要能取消");
});

test("iWAN 可用时不再强制先过 WebVPN 门户，捕获布防期间也不抢导航", async () => {
	const [tab, bridge, lib] = await Promise.all([
		read("client/src/webvpn-tab.js"),
		read("client/src/webvpn-bridge.js"),
		read("client/src/lib.js"),
	]);
	// 布防登记必须发生在「打开 tab」之前：正文首次可见时会在同一拍决定初始页。
	assert.match(lib, /if \(armingCapture\) armWebVpnCaptureWindow\(\);\s*\n\s*await openWebVpnTab\(\);/);
	assert.match(lib, /openWebVpnCaptureViaShell = \(payload\) => withWebVpnTab\([\s\S]*?\{ armingCapture: true \}\)/);
	assert.match(bridge, /export function armWebVpnCaptureWindow\(\)/);
	assert.match(bridge, /export function isWebVpnCaptureArmed\(\)/);

	const seed = tab.match(/const portalSeeded = useRef\(false\);[\s\S]*?\}, \[visible, inShell\]\);/);
	assert.ok(seed, "必须能提取门户初始页逻辑");
	// 布防中：控制器马上要把载体开往出版社页，门户晚一步就会把它盖掉。
	assert.match(seed[0], /if \(isWebVpnCaptureArmed\(\)\) return;/);
	// 载体已存在：保留登录态与当前页面，绝不重新导航。
	assert.match(seed[0], /if \(!status \|\| status\.windowOpen\) return;/);
	// iWAN 全部路由可用时机构可直接访问，不需要先绕门户。
	assert.match(seed[0], /if \(iwan\?\.usable\) return;/);
	assert.match(tab, /iwanStatusViaShell\(\)/, "判定 iWAN 需要查一次状态");
});
