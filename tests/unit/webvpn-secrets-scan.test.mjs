/**
 * WebVPN 密钥卫生扫描（评审报告 R1 / 计划 §11 阶段 4）。
 *
 * 计划 §13 与 §7.3 要求「不保存或记录学校凭据、Cookie、一次性 token」。
 * 这些约束编译期发现不了、运行时也只在泄漏那一刻才暴露，因此用源码级断言兜住：
 *
 *  1. 桌面 shell 的日志调用不得引用敏感值 —— 新消息链路要把含 token 的完整
 *     `uploadUrl` 从客户端 postMessage 给 shell，而 index.html 有打日志的习惯，
 *     照抄就会把一次性 token 写进控制台（R1 的原始风险）；
 *  2. WebVpnConfig 不得出现凭据类字段 —— 登录态只能由专属 WebView2 profile 承载；
 *  3. WebVPN 模块不得读取或导出 profile 内容 —— 只允许整目录删除（清除登录状态）；
 *  4. WebVPN 日志只有一个写入点，且该写入点强制走脱敏。
 *
 * 注意 1 的用词：`\btoken\b` 不会匹配 `tokens`。index.html 里的 `payload.tokens`
 * 是**主题色**而非凭据，必须避开以免误报。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const shellSource = () => read("desktop/src/index.html");
const webvpnSource = () => read("desktop/src-tauri/src/webvpn.rs");
const configSource = () => read("desktop/src-tauri/src/runtime/config.rs");

/** 抓出所有 `console.*(...)` 的实参文本，按括号配对，支持跨行调用。 */
function consoleCallArgs(source) {
	const calls = [];
	let index = 0;
	while ((index = source.indexOf("console.", index)) !== -1) {
		const open = source.indexOf("(", index);
		if (open === -1) break;
		let depth = 0;
		let cursor = open;
		for (; cursor < source.length; cursor++) {
			if (source[cursor] === "(") depth++;
			else if (source[cursor] === ")") {
				depth--;
				if (depth === 0) break;
			}
		}
		calls.push(source.slice(open + 1, cursor));
		index = cursor;
	}
	return calls;
}

/** 截取 `pub struct X {` 到首个顶层 `}` 之间的函数体，并去掉注释行。 */
function structBody(source, structName) {
	const start = source.indexOf(`pub struct ${structName} {`);
	assert.notEqual(start, -1, `必须存在 pub struct ${structName}`);
	const end = source.indexOf("\n}", start);
	assert.notEqual(end, -1, `pub struct ${structName} 必须有闭合花括号`);
	return source
		.slice(start, end)
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n");
}

const SENSITIVE = /\b(token|cookie|password|passwd|secret|credential|credentials|authorization|ticket|jwt)\b/i;
const SENSITIVE_URL = /uploadUrl|targetUrl|upload_url|target_url/;

test("桌面 shell 的日志调用不得引用敏感值", async () => {
	const shell = await shellSource();
	const calls = consoleCallArgs(shell);
	// 先证明提取器真的抓到了东西，否则后面的断言会空转通过。
	assert.ok(calls.length > 0, `应至少提取到一个 console 调用，实际 ${calls.length} 个`);

	const offenders = calls.filter((args) => SENSITIVE_URL.test(args) || SENSITIVE.test(args));
	assert.deepEqual(
		offenders,
		[],
		`以下日志调用引用了敏感值，会把一次性 token / 凭据写进控制台：\n${offenders.join("\n---\n")}`
	);
});

test("WebVpnConfig 不得出现凭据类字段", async () => {
	const body = structBody(await configSource(), "WebVpnConfig");
	// 断言的是**字段声明**，不是文档措辞：注释已在 structBody 里剥掉，
	// 否则 "不得存放任何凭据、Cookie" 这类说明性文字会被误判为违规。
	const offenders = body
		.split("\n")
		.filter((line) => /^\s*(pub\s+)?[a-z_0-9]+\s*:/.test(line))
		.filter((line) => SENSITIVE.test(line) || /profile|storage/i.test(line));
	assert.deepEqual(offenders, [], `WebVpnConfig 不应有凭据/存储类字段：\n${offenders.join("\n")}`);
	// 正向确认：导航策略字段确实在（防止上面的过滤条件写错导致空转通过）。
	assert.match(body, /portal_url\s*:/);
	assert.match(body, /allowed_hosts\s*:/);
	assert.match(body, /enforce_navigation\s*:/);
});

test("WebVPN 模块不得读取或导出浏览器 profile 内容", async () => {
	const [webvpn, main] = await Promise.all([
		webvpnSource(),
		read("desktop/src-tauri/src/main.rs"),
	]);
	// 登录态只由 WebView2 独占使用：我们的代码可以创建/删除这个目录，
	// 但一旦开始读取它，就等于把 Cookie / Local Storage 纳入自己的数据面。
	for (const forbidden of ["read_dir", "read_to_string", "read_to_end", "File::open"]) {
		assert.doesNotMatch(
			webvpn,
			new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			`WebVPN 模块不得出现 ${forbidden}：profile 内容不可进入应用数据面`
		);
	}
	// 下载捕获允许读取 on_download 生成的精确临时文件；不得用 profile 路径读取。
	assert.match(webvpn, /fs::read\(&upload\.path\)/, "捕获上传应只读取下载回调确认的临时文件");
	assert.doesNotMatch(webvpn, /fs::read\([^\n]*(profile|PROFILE_DIR_NAME)/i);
	// 唯一允许的目录操作是整体删除（清除登录状态）。删除动作在命令层
	// （main.rs::webvpn_clear_session），webvpn.rs 只负责解析并校验路径。
	const clear = main.match(/fn webvpn_clear_session\([\s\S]*?\n\}/);
	assert.ok(clear, "必须存在 webvpn_clear_session 命令");
	assert.match(clear[0], /resolve_profile_dir\(/, "删除前必须先解析并校验目录边界");
	assert.match(clear[0], /remove_dir_all/, "清除登录状态需要能整体删除 profile 目录");
});

test("WebVPN 日志只有一个写入点，且强制脱敏", async () => {
	const webvpn = await webvpnSource();
	assert.match(webvpn, /const LOG_FILE: &str = "webvpn\.log"/);
	const writePoints = webvpn.match(/logger\(\)\.write/g) ?? [];
	assert.equal(writePoints.length, 1, "只能有一个落日志点，否则脱敏约定会被绕过");

	// 该写入点必须位于 record 内，且写的是已脱敏的 url。
	const record = webvpn.match(
		/fn record\(app: &AppHandle, kind: &str, raw_url: &str, detail: &str\)[\s\S]*?\n\}/
	);
	assert.ok(record, "必须存在模块级 record 落日志入口");
	assert.match(record[0], /logger\(\)\.write/);
	assert.match(record[0], /let url = redact_for_log\(raw_url\);/);
	// 只在写入语句之后检查 raw_url：签名里本来就有这个形参名，全局匹配会误报。
	assert.doesNotMatch(
		record[0],
		/logger\(\)\.write[\s\S]*?raw_url/,
		"写入语句不得引用未脱敏的 raw_url"
	);
});
