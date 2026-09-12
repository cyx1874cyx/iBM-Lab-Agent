import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const shellSource = () => read("desktop/src/index.html");
const mainSource = () => read("desktop/src-tauri/src/main.rs");
const webvpnSource = () => read("desktop/src-tauri/src/webvpn.rs");

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

test("阶段 0 探测无法从 release 构建抵达", async () => {
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
	// 面板默认隐藏，只在探测可用时才展开。
	assert.match(shell, /id="webvpn-probe"\s+style="display:none"/);
	assert.match(shell, /invoke\('webvpn_probe_available'\)[\s\S]{0,220}?\$\('webvpn-probe'\)\.style\.display = ''/);
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
	assert.match(webvpn, /pub fn hide_sidebar\([\s\S]*?webview\.hide\(\)[\s\S]*?main\.set_bounds\(/, "收起后保留 WebView 并恢复主界面全宽");
});

test("导航白名单的逃生阀存在：被拒域名可诊断且可放行", async () => {
	const [shell, webvpn, main] = await Promise.all([shellSource(), webvpnSource(), mainSource()]);
	// 被拦域名必须被记住，否则用户只会看到静默空白页，无从自救。
	assert.match(webvpn, /denied_hosts/);
	assert.match(webvpn, /pub fn allow_host\(/);
	// 放行要写回配置，否则重启后又被拦一次。
	assert.match(main, /webvpn_allow_host[\s\S]*?save_webvpn_config\(/);
	// UI 必须真的把「待放行」渲染成可点击入口。
	assert.match(shell, /deniedHosts[\s\S]{0,900}?invoke\('webvpn_allow_host'/);
});

test("文献捕获通过受限 shell 契约进入 WebVPN", async () => {
	const [shell, main, webvpn, client] = await Promise.all([
		shellSource(),
		mainSource(),
		webvpnSource(),
		read("client/src/lib.js"),
	]);
	assert.match(client, /WEBVPN_STATUS/);
	assert.match(client, /WEBVPN_OPEN_CAPTURE/);
	assert.match(client, /WEBVPN_CLEAR_SESSION/);
	assert.match(shell, /invoke\('webvpn_open_capture'/);
	assert.match(shell, /invoke\('webvpn_clear_session'/);
	assert.match(main, /fn webvpn_open_capture\(/);
	assert.match(main, /fn webvpn_cancel_capture\(/);
	assert.match(webvpn, /build_wrd_proxy_url/);
	assert.match(webvpn, /download_destination/);
	assert.match(webvpn, /upload_capture/);
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
		"webvpn_hide",
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
