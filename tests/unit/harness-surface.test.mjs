import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";

const patchPath = fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url));
const clientPath = fileURLToPath(new URL("../../client/index.js", import.meta.url));
const presetPath = fileURLToPath(new URL("../../presets/lab-research/agent.cordis.yml", import.meta.url));
const serverUpdatePath = fileURLToPath(new URL("../../scripts/update-server.ps1", import.meta.url));
const localServerUpdatePath = fileURLToPath(new URL("../../update-server.cmd", import.meta.url));

test("bundle patch keeps one bare client carrier and the version registry", () => {
	const rows = composeEntries([loadOverlayPatches("test", patchPath)]);
	const carriers = rows.filter((row) => !row.disabled && row.name === "dsh-lab-agent");
	assert.deepEqual(carriers.map((row) => row.id), ["lab-client"]);

	const registry = rows.find((row) => row.id === "lab-version-registry");
	assert.equal(registry?.name, "dsh-lab-agent/version-registry");
});

test("bundle patch is portable and contains no developer-machine browser paths", async () => {
	const patch = await readFile(patchPath, "utf8");
	assert.doesNotMatch(patch, /\/mnt\/c\/Program Files/);
	assert.doesNotMatch(patch, /C:\\Users\\/);
	assert.doesNotMatch(patch, /windowsCdpBridge:\s*true/);
});

test("SSH server updater uses interactive password auth and preserves rollback metadata", async () => {
	const source = await readFile(serverUpdatePath, "utf8");
	assert.match(source, /\$Server = "vlab\.ustc\.edu\.cn"/);
	assert.match(source, /\$UserName = "ubuntu"/);
	assert.match(source, /\$Ref = "main"/);
	assert.match(source, /Get-Command ssh\.exe/);
	assert.match(source, /PreferredAuthentications=keyboard-interactive,password/);
	assert.match(source, /PubkeyAuthentication=no/);
	assert.match(source, /Read-Host "SSH 用户名"/);
	assert.match(source, /old_launcher/);
	assert.match(source, /old_release/);
	assert.match(source, /更新失败，正在尝试恢复并启动旧版本/);
	assert.match(source, /--ref \"\$ref\"/);
	assert.doesNotMatch(source, /ConvertTo-SecureString|sshpass|plink(?:\.exe)?\s+-pw|password\s*=/i);
});

test("local server updater launches the PowerShell updater without handling passwords", async () => {
	const source = await readFile(localServerUpdatePath, "utf8");
	assert.match(source, /raw\.githubusercontent\.com\/cyx1874cyx\/iBM-Lab-Agent\/main\/scripts\/update-server\.ps1/);
	assert.match(source, /fix\/template-list-boundary\/scripts\/update-server\.ps1/);
	assert.match(source, /%TEMP%\\ibm-lab-agent-update-server/);
	assert.match(source, /Invoke-WebRequest/);
	assert.match(source, /-ExecutionPolicy Bypass/);
	assert.match(source, /-File "%UPDATE_SCRIPT%"/);
	assert.match(source, /del \/f \/q "%UPDATE_SCRIPT%"/);
	assert.match(source, /pause/);
	assert.doesNotMatch(source, /%~dp0/);
	assert.doesNotMatch(source, /password|sshpass|plink(?:\.exe)?\s+-pw/i);
});

test("document conversion tool is scoped to the research preset", async () => {
	const [patch, preset] = await Promise.all([readFile(patchPath, "utf8"), readFile(presetPath, "utf8")]);
	assert.doesNotMatch(patch, /toolOrder:\s*[\s\S]*lab_convert_document/);
	assert.doesNotMatch(patch, /id:\s*lab-convert-tool/);
	// preset 里恰好一个 convert 工具行（lab-convert-tool），不重复注册
	assert.match(preset, /id:\s*lab-convert-tool[\s\S]*dsh-lab-agent\/convert-tool/);
	assert.doesNotMatch(preset, /id:\s*convert-document/);
});

test("web client exposes the project-first research workspace shell", async () => {
	const source = await readFile(clientPath, "utf8");
	assert.doesNotMatch(source, /\bbusyTemp\b/, "client must render from the declared busy state");
	assert.match(source, /选择一个课题继续/);
	assert.match(source, /课题核心记忆\.md/);
	assert.match(source, /提交新版本/);
	assert.match(source, /开始科研 Agent 对话/);
	assert.match(source, /文献资料/);
	assert.match(source, /每个会话汇总为一个检索条目和一个 RIS/);
	assert.match(source, /shortDescriptionZh/);
	assert.match(source, /ib-search-results/);
	assert.match(source, /收起数据库状态/);
	assert.match(source, /aria-expanded/);
	assert.match(source, /研究设计/);
	assert.match(source, /表征分析/);
	assert.match(source, /ctx\.conversation\.input\.for\(actx\)\.setDraft\(prompt\)/);
	assert.match(source, /applyBranding\(\(\) => open\(\)\)/);
	assert.match(source, /brand\.setAttribute\("aria-label", "打开科研课题"\)/);
	assert.doesNotMatch(source, /sidebar\.footer\.action/);
	assert.doesNotMatch(source, /我的科研课题"\) : null/);
});

test("PPT template import initializes role mappings before rendering the staged form", async () => {
	const source = await readFile(clientPath, "utf8");
	const mappingUpdate = source.indexOf("setMapping(initialMapping)");
	const stagedUpdate = source.indexOf("setStaged({ profile, parsed, suggestions })");
	assert.ok(mappingUpdate >= 0, "client initializes the imported template mapping");
	assert.ok(stagedUpdate > mappingUpdate, "mapping is initialized before the staged form can render");
	assert.match(source, /value: mapping\?\.\[role\] \|\| ""/);
	assert.match(source, /\(old \|\| \{\}\)/);
});

test("literature summary tools expose public identifiers and diagnostics", async () => {
	const source = await readFile(fileURLToPath(new URL("../../lib/tasks-tool.js", import.meta.url)), "utf8");
	assert.match(source, /lab_tasks_get_search_summary_inputs/);
	assert.match(source, /runId:/);
	assert.match(source, /待提炼论文（paperId 可直接使用）/);
	assert.match(source, /OpenAlex URL\/W 号/);
	assert.match(source, /unmatched/);
	assert.match(source, /有效项会立即保存/);
});

test("research preset and task tools expose the WeChat metadata intake workflow", async () => {
	const [toolsSource, preset] = await Promise.all([
		readFile(fileURLToPath(new URL("../../lib/tasks-tool.js", import.meta.url)), "utf8"),
		readFile(presetPath, "utf8")
	]);
	assert.match(toolsSource, /lab_tasks_register_wechat_paper/);
	assert.match(toolsSource, /lab_tasks_fetch_wechat_article/);
	assert.match(toolsSource, /待上传 PDF/);
	assert.match(toolsSource, /bundleId: args\.bundleId/);
	assert.match(toolsSource, /reportId 与 bundleId 不属于同一文献/);
	assert.match(preset, /微信公众号文献链接（新增入口）/);
	assert.match(preset, /lab_tasks_fetch_wechat_article/);
	assert.match(preset, /fetch: false/);
	assert.match(preset, /不下载 PDF/);
});

test("web client auto-launches per-project workspace + research session and customizes the conversation UI", async () => {
	const source = await readFile(clientPath, "utf8");
	// 自动 launch：专属工作区 + 新对话 + 科研 Agent 预设
	assert.match(source, /ctx\.workspaces\.create\(\{ path: project\.workspacePath \}\)/);
	assert.match(source, /ctx\.workspaces\.rename\(workspaceId, project\.name\)/);
	assert.match(source, /ctx\.workspaces\.connectWorkspace\(workspaceId\)/);
	assert.match(source, /agentPresets\.select\(\{ sessionId, agentPreset: presetId \}\)/);
	assert.match(source, /projects_ensure_workspace/);
	assert.match(source, /projects_bind_workspace/);
	assert.match(source, /workspaceId = ws\.workspaceId/);
	assert.doesNotMatch(source, /if \(!ws\.ok\)/);
	assert.match(source, /projects_delete/);
	assert.match(source, /ctx\.workspaces\.delete\(binding\.workspaceId\)/);
	assert.match(source, /确定彻底删除课题/);
	assert.match(source, /此操作不可恢复/);
	assert.match(source, /projects_bind_session/);
	assert.match(source, /projects_binding/);
	assert.match(source, /projects_by_session/);
	// 工作区级标识：同一课题空间内所有对话都能按 workspace / cwd 识别课题
	assert.match(source, /projects_by_workspace/);
	assert.match(source, /projects_by_cwd/);
	assert.match(source, /useSessions\(\(s\) => s\.byId\[sessionId\]\?\.cwd\)/);
	// 对话界面定制：会话头部保留紧凑课题徽章，不再重复显示输入框横幅
	assert.match(source, /conversation\.session\.header\.utilities/);
	assert.doesNotMatch(source, /conversation\.input\.dock/);
	assert.match(source, /课题背景/);
	// 科研文件上传：输入区新增普通文件按钮，并在捕获阶段接管非图片拖拽；
	// 原生四种图片 MIME 不被拦截，上传后把课题内路径追加到当前草稿。
	assert.match(source, /conversation\.input\.left/);
	assert.match(source, /lab-project-file-upload/);
	assert.match(source, /project_file_upload/);
	assert.match(source, /document\.addEventListener\("drop", onDrop, true\)/);
	assert.match(source, /image\/png/);
	assert.match(source, /image\/jpeg/);
	assert.match(source, /image\/webp/);
	assert.match(source, /image\/gif/);
	assert.match(source, /inputActions\.setDraft/);
	assert.match(source, /单个不超过 25 MB/);
	// 深度科研对话皮肤仍只在绑定课题的会话启用
	assert.match(source, /ib-research-chat/);
	assert.doesNotMatch(source, /ib-context-flow/);
	// Harness 的输入框由 backdrop 绘制可见文字；textarea 必须保持透明，
	// 否则定制色会让原生文字和 backdrop 同时出现，形成重影。
	assert.match(source, /textarea\{color:transparent;font-size:inherit;caret-color:var\(--ib-chat-ink\)\}/);
	assert.doesNotMatch(source, /className: "ib-context"/);
	assert.match(source, /人工审阅/);
	assert.match(source, /const parseJournalCitation/);
	assert.match(source, /shortNode\(report\)/);
	assert.match(source, /tasks_review_details/);
	assert.match(source, /自查提醒/);
	// 产物工作流：条目只保留概览/报告/PPT；右侧真实 Office 分页预览统一承载
	// 自查、二次确认、人审与下载，报告和 PPT 不能出现功能差异。
	assert.match(source, /ib-preview-drawer/);
	assert.match(source, /preview=1&kind=/);
	assert.match(source, /实际 DOCX 经 LibreOffice 渲染的分页预览/);
	assert.match(source, /实际 PPTX 经 LibreOffice 渲染的分页预览/);
	assert.match(source, /打开报告预览、审核与下载/);
	assert.match(source, /打开 PPT 预览、审核与下载/);
	assert.match(source, /disabled: !presentation\?\.pptxPath/);
	assert.doesNotMatch(source, /"预览报告"/);
	assert.doesNotMatch(source, /"预览PPT"/);
	assert.match(source, /审核通过前请确认自查提醒/);
	assert.match(source, /二次确认并通过/);
	assert.match(source, /approval\.stage === "approved"/);
	assert.match(source, /审核通过/);
	assert.match(source, /disabled: !previewApproved/);
	assert.match(source, /preview\.kind === "ppt" \? "下载PPT" : "下载DOCX"/);
	assert.match(source, /SELF_CHECK_UNAVAILABLE/);
	assert.match(source, /检索/);
	assert.match(source, /原文/);
	assert.match(source, /精读/);
	assert.match(source, /待上传 PDF/);
	assert.match(source, /尚未获取 PDF · 点击前往论文出版社页面/);
	assert.match(source, /尚未获取 SI · 点击前往论文出版社页面/);
	assert.match(source, /bundlePdfUrl \? downloadBundleFile/);
	assert.match(source, /bundleSiUrl \? downloadBundleFile/);
	assert.doesNotMatch(source, /}, "公众号"\) : null/);
	assert.match(source, /bundleRecordIndex/);
	assert.match(source, /PPT/);
	// 需要 connection（wire api）来选择预设
	assert.match(source, /ctx\.inject\(\["remote", "remote\.lab", "slots", "sessions", "workspaces", "conversation", "connection"\]/);
	// 品牌覆盖：展开侧栏使用人像 Logo；折叠栏与会话徽章保留烧瓶 SVG。
	assert.match(source, /function applyBranding/);
	assert.match(source, /iBM Agent/);
	assert.match(source, /based on DSH/);
	assert.match(source, /const BRAND_ICON = "data:image\/png;base64,/);
	assert.match(source, /ib-brand-avatar/);
	assert.match(source, /heroMarkHost\.replaceChildren\(avatar\)/);
	assert.match(source, /class\*='_fishHitbox'/);
	assert.match(source, /\.ib-hero-avatar\{[^}]*width:2em!important;height:2em!important/);
	assert.match(source, /专注源头创新/);
	assert.match(source, /function FlaskSvg/);
	assert.match(source, /const FLASK_RAIL_HTML/);
	assert.match(source, /ib-rail-flask/);
	assert.match(source, /\.ib-rail-flask\{position:absolute;z-index:2/);
	assert.match(source, /\[class\*='_brand'\] svg/);
	assert.match(source, /\[class\*='_railMark'\]/);
	assert.match(source, /\[class\*='_railFish'\]/);
	// 预设切换必须检查 result.ok（wire 层不 throw，否则失败被静默吞掉，
	// 会话停留在默认 standard 模式——此前"进入科研 Agent 模式"失效的根因）
	assert.match(source, /const selectResearchPreset = async/);
	assert.match(source, /response\?\.result \?\? response/);
	assert.match(source, /agent-preset-locked/);
	assert.match(source, /presetApplied !== "ok"\) toast/);
});

test("web client bundle exposes valid strict Remote descriptors", async () => {

	let registration;
	const source = await readFile(clientPath, "utf8");
	vm.runInNewContext(source, {
		window: { __ModuleLoader__: { load: (value) => { registration = value; } } },
		document: { querySelector: () => ({}) },
		console
	}, { filename: clientPath });

	assert.equal(registration?.id, "dsh-lab-agent");
	const react = {
		createElement: () => undefined,
		useState: () => [undefined, () => {}],
		useEffect: () => {},
		useCallback: (value) => value,
		Fragment: Symbol("Fragment")
	};
	const client = registration.factory((name) => {
		if (name === "react") return react;
		if (name === "react-dom") return {};
		throw new Error(`unexpected client dependency: ${name}`);
	});
	assert.deepEqual(Array.from(client.inject), ["remote"]);

	let contribution;
	let childInject;
	await client.apply({
		remote: {
			$mount: async (value) => {
				contribution = value;
				return async () => {};
			}
		},
		inject: (services, callback) => {
			childInject = services;
			callback({
				remote: { lab: {} },
				slots: { inject: () => {} },
				on: () => {}
			});
		}
	});

	assert.deepEqual(Array.from(childInject), ["remote", "remote.lab", "slots", "sessions", "workspaces", "conversation", "connection"]);
	assert.equal(contribution.package, "dsh-lab-agent");
	assert.ok(contribution.descriptors.length > 0);
	for (const descriptor of contribution.descriptors) {
		assert.equal(descriptor.service, "lab");
		assert.match(descriptor.id, /^dsh-lab-agent#lab\//);
		assert.equal(descriptor.result.mode, "strict");
		assert.equal(typeof descriptor.result.typeSymbol, "string");
		assert.equal(typeof descriptor.result.schema.parse, "function");
		for (const parameter of descriptor.parameters) {
			assert.equal(parameter.name, parameter.wire);
			assert.equal(parameter.source, "json");
			assert.equal(parameter.codec.mode, "strict");
		}
	}
});
