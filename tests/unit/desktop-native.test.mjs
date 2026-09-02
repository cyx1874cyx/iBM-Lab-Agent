import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("desktop shell routes artifact save and external URLs through Tauri", async () => {
	const [shell, main, client, manifest] = await Promise.all([
		read("desktop/src/index.html"),
		read("desktop/src-tauri/src/main.rs"),
		read("client/index.js"),
		read("package.json"),
	]);
	assert.match(shell, /event\.source !== frame\.contentWindow/);
	assert.match(shell, /event\.origin !== runtimeOrigin/);
	assert.match(shell, /invoke\('save_artifact'/);
	assert.match(main, /async fn save_artifact/);
	assert.match(main, /fn reveal_path/);
	assert.match(main, /fn open_workspace/);
	assert.match(client, /saveArtifactViaDesktop/);
	assert.match(shell, /invoke\('save_text_artifact'/);
	assert.match(main, /async fn save_text_artifact/);
	assert.match(client, /saveTextArtifactViaDesktop/);
	assert.match(client, /await saveRis\(result\.ris\.fileName, result\.ris\.text\)/);
	assert.doesNotMatch(client, /const downloadText/);
	assert.match(client, /RIS 另存为仅支持桌面客户端/);
	assert.match(client, /openExternalUrl/);
	assert.match(shell, /invoke\('open_artifact_in_browser'/);
	assert.match(main, /fn open_artifact_in_browser/);
	assert.match(client, /openArtifactInBrowserViaShell/);
	assert.equal(JSON.parse(manifest).exports["./capture-handoff"].default, "./lib/capture-handoff.js");
});

test("0.1.15 PDF/SI 打开链路：两个按钮都走 OPEN_ARTIFACT_IN_BROWSER 且错误可见", async () => {
	const [shell, main, client] = await Promise.all([
		read("desktop/src/index.html"),
		read("desktop/src-tauri/src/main.rs"),
		read("client/index.js"),
	]);
	// 精读条目：正文与 SI 按钮已登记后都进入 Edge 打开流程（openEntryInEdge → openPdfPreview → 桌面桥）
	assert.match(client, /bundlePdfUrl \? openEntryInEdge\(event, "pdf", bundlePdfUrl\)/);
	assert.match(client, /bundleSiIsPdf \? openEntryInEdge\(event, "si", bundleSiUrl\)/);
	// 检索条目同样走该流程
	assert.match(client, /openSearchInEdge\(event, "pdf", paper\.localPdfUrl\)/);
	assert.match(client, /openSearchInEdge\(event, "si", paper\.localSiUrl\)/);
	// 打开过程中必须显示"正在打开"，失败必须 toast（不得静默）
	assert.match(client, /data-opening/);
	assert.match(client, /无法打开/);
	// 前端只把 kind+bundleId 交给 shell，由 Rust 按运行时端口生成受限地址
	assert.match(client, /payload: \{ kind, bundleId \}/);
	// 前端超时必须大于 Rust 预检上限（20s），避免预检期间被误报"未响应"
	assert.match(client, /setTimeout\(\(\) => finish\(reject, new Error\("桌面客户端未响应，无法打开文献阅读页"\)\), 30000\)/);
	// shell 收到消息后 invoke 并分段回传结果；失败必须把具体错误回传 UI
	assert.match(shell, /收到打开请求 kind=/);
	assert.match(shell, /reply\('OPEN_ARTIFACT_IN_BROWSER_RESULT', \{ ok: false, error: message \}\)/);
	// Rust：只允许 pdf|si + 合法 bundleId；预检非 200 / 非 PDF 时明确失败
	assert.match(main, /fn validate_open_request/);
	assert.match(main, /fn preflight_pdf/);
	assert.match(main, /fn artifact_read_url/);
	assert.match(main, /fn launch_edge/);
	// 预检在启动 Edge 之前执行，失败时不启动 Edge（限定在 open_artifact_in_browser 函数体内判断）
	const fnStart = main.indexOf("fn open_artifact_in_browser");
	const fnBody = main.slice(fnStart, fnStart + 2200);
	const preflightIndex = fnBody.indexOf("preflight_pdf(&url)");
	const launchIndex = fnBody.indexOf("launch_edge(&url)");
	assert.ok(preflightIndex !== -1 && launchIndex !== -1 && preflightIndex < launchIndex, "预检必须先于 Edge 启动");
});

test("desktop stores secrets with DPAPI, owns DSH with a Job Object, and has a CSP", async () => {
	const [config, process, tauri] = await Promise.all([
		read("desktop/src-tauri/src/runtime/config.rs"),
		read("desktop/src-tauri/src/runtime/process.rs"),
		read("desktop/src-tauri/tauri.conf.json"),
	]);
	assert.match(config, /CryptProtectData/);
	assert.match(config, /CryptUnprotectData/);
	assert.match(config, /skip_serializing/);
	assert.match(process, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
	assert.match(process, /AssignProcessToJobObject/);
	const parsed = JSON.parse(tauri);
	assert.ok(parsed.app.security.csp);
	assert.match(parsed.app.security.csp, /object-src 'none'/);
});

test("desktop delegates model configuration to DSH and manages MCP per application in diagnostics", async () => {
	const [shell, main, process, config] = await Promise.all([
		read("desktop/src/index.html"),
		read("desktop/src-tauri/src/main.rs"),
		read("desktop/src-tauri/src/runtime/process.rs"),
		read("desktop/src-tauri/src/runtime/config.rs"),
	]);
	assert.doesNotMatch(shell, /settings-button|showSettings|API Key|接口地址/);
	assert.doesNotMatch(main, /load_config,|save_config,/);
	assert.doesNotMatch(process, /OPENAI_API_KEY|OPENAI_BASE_URL|OPENAI_MODEL/);
	assert.match(shell, /应用与连接诊断/);
	assert.match(shell, /data-mcp-app/);
	assert.match(shell, /filter\(\(item\) => item\.mcp\)/, "only configured MCP entries are connection-tested");
	assert.match(main, /app_mcp_status/);
	assert.match(main, /save_app_mcp/);
	assert.match(config, /Vec<McpServerConfig>/);
});
