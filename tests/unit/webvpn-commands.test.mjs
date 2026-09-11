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

test("WebVPN 窗口与主窗口隔离，且关闭即隐藏", async () => {
	const webvpn = await webvpnSource();
	// 专属 WebView2 profile：登录态不能和主窗口共用。
	assert.match(webvpn, /const PROFILE_DIR_NAME: &str = "webvpn-webview2"/);
	assert.match(webvpn, /\.data_directory\(profile_dir\)/);
	// 单例判定只认 label，不认标题或 URL。
	assert.match(webvpn, /pub const WINDOW_LABEL: &str = "webvpn"/);
	assert.match(webvpn, /app\.get_webview_window\(WINDOW_LABEL\)/);
	// 关闭按钮必须变成隐藏，否则每次关窗都要重新登录。
	assert.match(webvpn, /WindowEvent::CloseRequested \{ api, \.\. \}[\s\S]*?api\.prevent_close\(\);[\s\S]*?window\.hide\(\)/);
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
