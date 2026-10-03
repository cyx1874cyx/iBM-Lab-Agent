import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";

const patchPath = fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url));
// clientPath = 打包产物（vm 执行测试用）；clientSrcDir = 拆分后的源码目录（静态契约断言用）。
const clientPath = fileURLToPath(new URL("../../client/index.js", import.meta.url));
const clientSrcDir = fileURLToPath(new URL("../../client/src", import.meta.url));
// DSH 0.1.7 起 agent preset 不再是一个目录（preset.yml + agent.cordis.yml），
// 而是 bundle patch 里的一条 `@deepseek-ai/dsh-agent-preset` 声明行。
const presetPath = fileURLToPath(new URL("../../presets/lab-research/preset.patch.yml", import.meta.url));
const serverUpdatePath = fileURLToPath(new URL("../../scripts/update-server.ps1", import.meta.url));
const localServerUpdatePath = fileURLToPath(new URL("../../update-server.cmd", import.meta.url));

// 0.4.1 起 client/index.js 拆分为 client/src/*.js 多模块。静态契约断言读取源码拼接，
// 与 esbuild 产物（void 0 / 2e4 / 删注释等变换）解耦。
async function readClientSource() {
	const names = (await readdir(clientSrcDir)).filter((f) => f.endsWith(".js")).sort();
	const parts = await Promise.all(names.map((f) => readFile(join(clientSrcDir, f), "utf8")));
	return parts.join("\n");
}

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
	assert.match(source, /Start-Process/);
	assert.match(source, /RedirectStandardInput \$sshInputPath/);
	assert.match(source, /\[Text\.Encoding\]::ASCII/);
	assert.match(source, /交互式 shell 中执行更新/);
	assert.match(source, /set -o pipefail/);
	assert.match(source, /remote_exit=`\$\?/);
	assert.match(source, /\$sshExitCode = \$sshProcess\.ExitCode/);
	assert.doesNotMatch(source, /PreferredAuthentications|PubkeyAuthentication/);
	assert.match(source, /Read-Host "SSH 用户名"/);
	assert.match(source, /old_launcher/);
	assert.match(source, /old_release/);
	assert.match(source, /更新失败，正在尝试恢复并启动旧版本/);
	assert.match(source, /--ref \"\$ref\"/);
	assert.match(source, /repo="qbdeng2025\/iBM-Lab-Agent"/);
	assert.match(source, /git\.ustc\.edu\.cn\/\$\{repo\}\/\-\/raw\/\$\{ref\}\/install\.sh/);
	assert.doesNotMatch(source, /raw\.githubusercontent\.com\/cyx1874cyx/);
	assert.doesNotMatch(source, /ConvertTo-SecureString|sshpass|plink(?:\.exe)?\s+-pw|password\s*=/i);
});

test("local server updater launches the PowerShell updater without handling passwords", async () => {
	const source = await readFile(localServerUpdatePath, "utf8");
	assert.match(source, /git\.ustc\.edu\.cn\/qbdeng2025\/iBM-Lab-Agent\/\-\/raw\/main\/scripts\/update-server\.ps1/);
	assert.doesNotMatch(source, /raw\.githubusercontent\.com\/cyx1874cyx/);
	assert.doesNotMatch(source, /fix\/template-list-boundary/);
	assert.match(source, /%TEMP%\\ibm-lab-agent-update-server/);
	assert.match(source, /Invoke-WebRequest/);
	assert.match(source, /\?cache=%RANDOM%/);
	assert.match(source, /New-Object Text\.UTF8Encoding\(\$true\)/);
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

test("research preset hard-disables DSH subagent delegation", async () => {
	const preset = await readFile(presetPath, "utf8");
	assert.match(preset, /禁止委派（写死）/);
	assert.doesNotMatch(preset, /@deepseek-ai\/dsh-tool-subagent/);
	assert.doesNotMatch(preset, /@deepseek-ai\/dsh-workflow-worker-thread/);
	assert.doesNotMatch(preset, /id:\s*tool-workflow/);
});

test("research preset ships as a 0.1.7 declaration row in the bundle patch list", async () => {
	const [preset, manifest] = await Promise.all([
		readFile(presetPath, "utf8"),
		readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")
	]);
	// 0.1.7：preset 是 bundle patch 里的声明行，不再是 $DSH_HOME/.agent-presets 目录。
	assert.match(preset, /name:\s*'@deepseek-ai\/dsh-agent-preset'/);
	assert.match(preset, /id:\s*preset-lab-research/);
	assert.match(preset, /config:\n\s+id: lab-research\n/);
	assert.match(preset, /name: iBM科研Agent/);
	assert.match(preset, /plugins:/);
	assert.match(preset, /^\s+- id: persona$/m);
	const parsed = JSON.parse(manifest);
	assert.deepEqual(parsed.dsh.bundle.patch, ["./cordis.patch.yml", "./presets/lab-research/preset.patch.yml"]);
});

test("web client exposes the project-first research workspace shell", async () => {
	const source = await readClientSource();
	assert.doesNotMatch(source, /\bbusyTemp\b/, "client must render from the declared busy state");
	assert.match(source, /选择一个课题继续/);
	assert.match(source, /课题核心记忆\.md/);
	assert.match(source, /提交新版本/);
	assert.match(source, /开始科研 Agent 对话/);
	assert.match(source, /文献资料/);
	// 视觉改版 §7：布局解释与常驻说明文字整段删除，功能本身保留
	// （检索记录仍会展开本会话全部去重文献 → ib-search-results）。
	assert.doesNotMatch(source, /每个会话汇总为一个检索条目和一个 RIS/);
	assert.doesNotMatch(source, /左侧检索记录 · 右侧精读档案与下载/);
	assert.doesNotMatch(source, /未获取原文时点击灰色 PDF\/SI 按钮/);
	assert.match(source, /shortDescriptionZh/);
	assert.match(source, /ib-search-results/);
	// 人工审核：数据库状态是废案，整个面板已移除（含采集它的 literature_status 轮询）。
	assert.doesNotMatch(source, /收起数据库状态|文献数据库实时状态/);
	assert.match(source, /aria-expanded/);
	assert.match(source, /研究设计/);
	assert.match(source, /表征分析/);
	assert.match(source, /ctx\.conversation\.input\.for\(actx\)\.setDraft\(prompt\)/);
	assert.match(source, /applyBranding\(\(\) => open\(\)\)/);
	assert.match(source, /brand\.setAttribute\("aria-label", "打开科研课题"\)/);
	assert.doesNotMatch(source, /sidebar\.footer\.action/);
	assert.doesNotMatch(source, /我的科研课题"\) : null/);
});

test("核磁和绘图登记条目支持确认后删除且明确保留课题文件", async () => {
	const source = await readClientSource();
	assert.match(source, /characterization_remove/);
	assert.match(source, /确认删除这条\$\{label\}登记/);
	assert.match(source, /原始数据和已归档文件会保留/);
	assert.match(source, /删除核磁登记（保留课题文件）|删除绘图登记（保留课题文件）|删除\$\{kind === "nmr"/);
});

test("PPT template import initializes role mappings before rendering the staged form", async () => {
	const source = await readClientSource();
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

test("generic paper metadata tool (non-wechat) registers into the reading queue", async () => {
	const [toolsSource, preset] = await Promise.all([
		readFile(fileURLToPath(new URL("../../lib/tasks-tool.js", import.meta.url)), "utf8"),
		readFile(presetPath, "utf8")
	]);
	assert.match(toolsSource, /lab_tasks_register_paper_meta/);
	assert.match(toolsSource, /DOI\/publisher 页面/);
	assert.match(toolsSource, /sourceType 取值：publisher/);
	assert.match(toolsSource, /无需 PDF 即可登记/);
	assert.match(preset, /非公众号文献元数据/);
	assert.match(preset, /lab_tasks_register_paper_meta/);
});

test("Nature browser download is exposed as an AI tool without returning capture tokens", async () => {
	const [toolsSource, preset, clientSource] = await Promise.all([
		readFile(fileURLToPath(new URL("../../lib/tasks-tool.js", import.meta.url)), "utf8"),
		readFile(presetPath, "utf8"),
		readClientSource()
	]);
	assert.match(toolsSource, /lab_nature_browser_download/);
	assert.match(toolsSource, /lab_publisher_browser_download/);
	assert.match(toolsSource, /lab_publisher_browser_download_status/);
	assert.match(toolsSource, /lab_nature_browser_download_status/);
	assert.match(toolsSource, /getDesktopWebVpnStatus/);
	assert.match(toolsSource, /createAgentCaptureTask/);
	assert.doesNotMatch(toolsSource, /return \{ ok: true, token:/, "工具返回值不得把一次性令牌暴露给模型");
	assert.match(preset, /inject: \[tools, ibmLiteratureWorkflows, labTasks\]/);
	assert.match(clientSource, /function ProjectBadge[\s\S]*manual_capture_claim_agent/,
		"AI 下载队列必须由对话中始终挂载的课题标识领取，不能依赖已关闭的项目面板");
	assert.match(clientSource, /manual_capture_claim_agent[\s\S]*openWebVpnCaptureViaShell/);
	assert.match(clientSource, /manual_capture_desktop_status_update/);
	assert.match(clientSource, /iwanStatusViaShell/);
	assert.match(clientSource, /manual_capture_desktop_action_claim/);
	assert.match(clientSource, /confirmWebVpnLoginViaShell/);
	assert.match(toolsSource, /requiresUserAction/);
	assert.match(toolsSource, /loginConfirmed/);
});

test("synthesis workspace tools are exposed to the agent (lab_synth_*)", async () => {
	const source = await readFile(fileURLToPath(new URL("../../lib/synthesis-tool.js", import.meta.url)), "utf8");
	assert.match(source, /lab_synth_target_create/);
	assert.match(source, /lab_synth_target_list/);
	assert.match(source, /lab_synth_compound_resolve_first/);
	assert.match(source, /lab_synth_route_create/);
	assert.match(source, /lab_synth_route_step/);
	assert.match(source, /lab_synth_experiment_plan_create/);
	assert.match(source, /lab_synth_structure_candidate_add/);
	assert.match(source, /lab_synth_evidence_add/);
	assert.match(source, /lab_synth_route_status/);
	assert.match(source, /supportsField/);
	assert.match(source, /literature-extracted/);
	const preset = await readFile(presetPath, "utf8");
	assert.match(preset, /dsh-lab-agent\/synthesis-tool/);
	assert.match(preset, /inject: \[tools, ibmDesign, ibmCore, labSynthesis, labChemistry, labExperimentPlanTemplates\]/);
	assert.match(preset, /合成路线结构补全（强制主动执行）/);
	assert.match(preset, /dual-confirmed/);
	assert.match(preset, /visual-extraction/);
	assert.match(preset, /literature-inference/);
});

test("reading reports inventory PDF and SI before using note templates", async () => {
	const [toolsSource, preset] = await Promise.all([
		readFile(fileURLToPath(new URL("../../lib/tasks-tool.js", import.meta.url)), "utf8"),
		readFile(presetPath, "utf8")
	]);
	assert.match(toolsSource, /lab_tasks_get_reading_inputs/);
	assert.match(toolsSource, /正文 PDF、SI 和 source-map/);
	assert.match(toolsSource, /Nature paper-card 仅在没有可用模板时回退/);
	assert.match(preset, /逐个浏览\/读取 available=true 的正文 PDF、SI/);
	assert.match(preset, /不得使用 nature-paper-card 的 01–16 卡片结构覆盖模板/);
});

test("web client auto-launches per-project workspace + research session and customizes the conversation UI", async () => {
	const source = await readClientSource();
	// 自动 launch：专属工作区 + 新对话 + 科研 Agent 预设
	assert.match(source, /ctx\.workspaces\.create\(\{ path: project\.workspacePath \}\)/);
	assert.match(source, /ctx\.workspaces\.rename\(workspaceId, project\.name\)/);
	assert.match(source, /ctx\.uiWorkspace\.connectWorkspace\(workspaceId\)/);
	assert.match(source, /ctx\.remote\.agentPresets\.select\(sessionId, presetId\)/);
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
	// 新版 DSH 自带文件上传入口，插件不再向输入区注入重复按钮或接管拖拽。
	assert.doesNotMatch(source, /lab-project-file-upload/);
	// 深度科研对话皮肤仍只在绑定课题的会话启用
	assert.match(source, /ib-research-chat/);
	assert.doesNotMatch(source, /ib-context-flow/);
	// Harness 的输入框由 backdrop 绘制可见文字；textarea 必须保持透明，
	// 否则定制色会让原生文字和 backdrop 同时出现，形成重影。
	assert.match(source, /textarea\{color:transparent;font-size:inherit;caret-color:var\(--ib-chat-ink\)\}/);
	assert.doesNotMatch(source, /className: "ib-context"/);
	assert.match(source, /Office\/WPS/);
	assert.match(source, /const parseJournalCitation/);
	assert.match(source, /shortNode\(report\)/);
	// 桌面产物工作流：条目只保留概览/报告/PPT；报告和 PPT 都原生保存并由
	// Windows 默认 Office/WPS 关联打开，不经过网页预览、审核或二次确认。
	assert.match(source, /function openOfficeArtifact/);
	assert.match(source, /function openSavedPathViaDesktop/);
	assert.match(source, /OPEN_SAVED_PATH/);
	// 本次改版 §5.1：完成状态用按钮文字 + 填充色表达
	// （「打开精读」青绿填充 / 「打开 PPT」蓝色填充），不再是「打开PPT」。
	assert.match(source, /打开精读/);
	assert.match(source, /打开 PPT/);
	assert.match(source, /"data-kind": "ppt", "data-done": pptDone \? "true" : undefined/);
	assert.match(source, /已交给本机 Office\/WPS 打开/);
	// PDF/SI 是图标按钮：已归档点亮、未归档灰着（点击去布防捕获），不写文字。
	assert.match(source, /className: "ib-icon-btn", "data-ready": bundlePdfUrl \? "true" : "false"/);
	assert.match(source, /className: "ib-icon-btn", "data-ready": bundleSiUrl \? "true" : "false"/);
	assert.match(source, /onRequestArtifact\(pptPrompt\)/);
	assert.match(source, /String\(opts\.prompt \|\| ""\)\.trim\(\) \|\| promptFor/);
	assert.doesNotMatch(source, /打开报告预览、审核与下载/);
	assert.doesNotMatch(source, /打开 PPT 预览、审核与下载/);
	assert.match(source, /检索/);
	assert.match(source, /原文/);
	assert.match(source, /精读/);
	assert.match(source, /原文待归档/);
	assert.match(source, /尚未获取原文 · 点击前往出版社页面并布防捕获下载/);
	assert.match(source, /尚未获取 SI · 点击前往出版社页面并布防捕获下载/);
	assert.match(source, /bundleSiIsPdf \? openEntryInEdge/);
	assert.match(source, /function openPdfPreview/);
	assert.match(source, /searchParams\.set\("preview", "1"\)/);
	assert.match(source, /openArtifactInBrowserViaShell\(kind, bundleId\)/);
	assert.match(source, /OPEN_ARTIFACT_IN_BROWSER/);
	assert.match(source, /openEntryInEdge\(event, "pdf", bundlePdfUrl\)/);
	// 0.1.15：点击后必须有"正在打开"状态，失败必须 toast，不得静默
	assert.match(source, /正在打开正文 PDF…/);
	assert.match(source, /正在打开 SI PDF…/);
	assert.match(source, /正在在外部 Microsoft Edge 中打开/);
	assert.match(source, /无法打开\$\{kind === "pdf" \? "正文 PDF" : "SI PDF"\}：/);
	assert.match(source, /data-opening/);
	assert.match(source, /"网页预览"/);
	assert.match(source, /literature_download_cancel/);
	assert.match(source, /"终止中…" : "终止"/);
	assert.doesNotMatch(source, /}, "公众号"\) : null/);
	assert.match(source, /bundleRecordIndex/);
	assert.match(source, /PPT/);
	// 通过 DSH 0.4.3 的 remote.agentPresets 位置参数 API 选择预设；connectWorkspace/openSession
	// 由 uiWorkspace 服务提供（sessions 服务仍在，但不再承载会话切换）。
	assert.match(source, /ctx\.inject\(\["remote", "remote\.lab", "remote\.agentPresets", "slots", "sessions", "workspaces", "uiWorkspace", "conversation"\]/);
	// 品牌覆盖：展开侧栏使用人像 Logo；烧瓶作为原生侧栏开关图标。
	assert.match(source, /function applyBranding/);
	assert.match(source, /iBM Agent/);
	assert.match(source, /based on DSH/);
	assert.match(source, /const BRAND_ICON = "data:image\/png;base64,/);
	assert.match(source, /ib-brand-avatar/);
	assert.match(source, /heroMarkHost\.replaceChildren\(avatar\)/);
	assert.match(source, /class\*='_fishHitbox'/);
	assert.match(source, /\.ib-hero-avatar\{[^}]*width:68px!important;height:68px!important/);
	assert.match(source, /专注源头创新/);
	assert.match(source, /function FlaskSvg/);
	assert.match(source, /const FLASK_RAIL_HTML/);
	assert.match(source, /ib-rail-flask/);
	assert.match(source, /\.ib-rail-flask\{position:absolute!important;z-index:3/);
	assert.match(source, /\.ib-rail-flask\{[^}]*background:#51d4a3;[^}]*pointer-events:none/);
	assert.match(source, /class\*='_titleGroup'/, "应兼容 DSH 0.1.5 新版首页标题结构");
	assert.match(source, /stroke: "currentColor"/, "烧瓶描边应跟随黑白主题文字颜色");
	// 人工审核要求：课题页右上角的「开始科研 Agent 对话」按钮已去掉，起会话改由
	// 具体任务按钮（登记产物 / 路线方案 / 表征提交）按需触发。按钮与它的专属样式
	// 都不该再出现，否则就是删了一半。
	assert.doesNotMatch(source, /开始科研 Agent 对话"\)/, "课题页不应再有独立的启动对话按钮");
	assert.doesNotMatch(source, /className: "ib-btn ib-agent"/);
	assert.doesNotMatch(source, /\.ib-agent\{/, "启动按钮的专属样式应一并删除");
	assert.doesNotMatch(source, /\.ib-spark\{/, "启动按钮的图章样式应一并删除");
	assert.doesNotMatch(source, /bindEntry\(railEntry\)/);
	assert.match(source, /课题界面统一主题/);
	assert.match(source, /import \{ themeCss \} from "\.\/theme\.js"/);
	assert.match(source, /css \+= themeCss/);
	assert.match(source, /\[class\*='_brand'\] svg/);
	assert.match(source, /\[class\*='_railMark'\]/);
	assert.match(source, /\[class\*='_railFish'\]/);
	// 预设切换必须检查 result.ok（wire 层不 throw，否则失败被静默吞掉，
	// 会话停留在默认 standard 模式——此前"进入科研 Agent 模式"失效的根因）
	assert.match(source, /const selectResearchPreset = async/);
	assert.match(source, /ctx\.remote\.agentPresets\.select\(sessionId, presetId\)/);
	assert.match(source, /agent-preset\/locked/);
	assert.match(source, /presetApplied !== "ok"\) toast/);
});

test("文献综述：检索条目有写综述入口，模板管理有综述模板分区", async () => {
	const source = await readClientSource();
	// 检索条目上的入口：写综述（起对话）与已有综述的打开按钮
	assert.match(source, /const writeReview = \(search\)/);
	assert.match(source, /lab_tasks_get_review_inputs/);
	assert.match(source, /lab_tasks_register_review/);
	assert.match(source, /tasks_review_inputs/);
	assert.match(source, /kind=\$\{variant === "ppt" \? "review-ppt" : "review"\}&runId=/);
	// 模板管理：综述模板走同一套阅读笔记模板域，用 kind 区分
	assert.match(source, /"综述模板"/);
	assert.match(source, /note_templates_list", \{ request: \{ kind: "review" \} \}/);
	assert.match(source, /kind: "note"/);
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
	const childInjects = [];
	let webVpnInject;
	await client.apply({
		remote: {
			$mount: async (value) => {
				contribution = value;
				return async () => {};
			}
		},
		inject: (services, callback) => {
			// 本次改版：apply() 现在有两次顶层 inject——面板装配面，以及
			// 「新建会话默认科研模式」那一次（settings 命名空间单独注入，
			// 缺失时只丢这一项能力，不影响面板）。两次都记录下来。
			childInjects.push(services);
			callback({
				remote: {
					lab: {},
					// ensureResearchPresetDefault 先读预设 roster；这里给一个
					// 已把 lab-research 设为默认的最小实现（不触发真实写入）。
					agentPresets: {
						list: async () => ({ ok: true, value: { presets: [{ id: "lab-research", isDefault: true }] } })
					},
					settings: { update: async () => ({ ok: true }) }
				},
				slots: { inject: () => {} },
				on: () => {},
				effect: () => () => {},
				// applyUi 内部还会再注入几次（右侧栏服务、课题壳桥）。
				// 本用例断言的是依赖面，因此这里只记录服务清单，不执行回调。
				inject: (nested) => { webVpnInject = nested; }
			});
		}
	});

	assert.deepEqual(Array.from(childInjects[0]), ["remote", "remote.lab", "remote.agentPresets", "slots", "sessions", "workspaces", "uiWorkspace", "conversation"]);
	// 默认模式那一次：settings 缺失时不能连累面板装配。
	assert.deepEqual(Array.from(childInjects[1]), ["remote", "remote.settings", "remote.agentPresets"]);
	assert.deepEqual(Array.from(webVpnInject), ["slots", "sidebarRightTabs", "sidebarRight"]);
	assert.equal(contribution.package, "dsh-lab-agent");
	assert.ok(contribution.descriptors.length > 0);
	for (const descriptor of contribution.descriptors) {
		assert.equal(descriptor.service, "lab");
		assert.match(descriptor.id, /^dsh-lab-agent#lab\//);
		assert.equal(descriptor.result.mode, "strict");
		assert.equal(typeof descriptor.result.typeSymbol, "string");
		// DSH 0.1.7：strict codec 用 create() 工厂代替 schema 字段
		// （dsh-typert-registry 的 validateCodec 要求 typeof create === "function"，
		// 否则 $mount 抛错、整个客户端 apply() 被 reject）。
		assert.equal(typeof descriptor.result.create, "function");
		assert.equal(typeof descriptor.result.create().parse, "function");
		assert.equal(descriptor.result.schema, undefined, "0.1.7 不再接受 schema 字段");
		for (const parameter of descriptor.parameters) {
			assert.equal(parameter.name, parameter.wire);
			assert.equal(parameter.source, "json");
			assert.equal(parameter.codec.mode, "strict");
			assert.equal(typeof parameter.codec.create, "function");
		}
	}
});
