import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";

const patchPath = fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url));
const clientPath = fileURLToPath(new URL("../../client/index.js", import.meta.url));
const presetPath = fileURLToPath(new URL("../../presets/lab-research/agent.cordis.yml", import.meta.url));

test("bundle patch keeps one bare client carrier and the version registry", () => {
	const rows = composeEntries([loadOverlayPatches("test", patchPath)]);
	const carriers = rows.filter((row) => !row.disabled && row.name === "dsh-lab-agent");
	assert.deepEqual(carriers.map((row) => row.id), ["lab-client"]);

	const registry = rows.find((row) => row.id === "lab-version-registry");
	assert.equal(registry?.name, "dsh-lab-agent/version-registry");
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
	assert.match(source, /研究设计/);
	assert.match(source, /表征分析/);
	assert.match(source, /ctx\.conversation\.input\.for\(actx\)\.setDraft\(prompt\)/);
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
	assert.match(source, /projects_bind_session/);
	assert.match(source, /projects_binding/);
	assert.match(source, /projects_by_session/);
	// 工作区级标识：同一课题空间内所有对话都能按 workspace / cwd 识别课题
	assert.match(source, /projects_by_workspace/);
	assert.match(source, /projects_by_cwd/);
	assert.match(source, /useSessions\(\(s\) => s\.byId\[sessionId\]\?\.cwd\)/);
	// 对话界面定制：会话头部课题徽章 + 输入框上方记忆提示条
	assert.match(source, /conversation\.session\.header\.utilities/);
	assert.match(source, /conversation\.input\.dock/);
	assert.match(source, /课题背景/);
	// 需要 connection（wire api）来选择预设
	assert.match(source, /ctx\.inject\(\["remote", "remote\.lab", "slots", "sessions", "workspaces", "conversation", "connection"\]/);
	// 品牌覆盖：左上角 iBM Agent（烧瓶 + based on DSH，隐藏原生 wordmark/鲸鱼）
	assert.match(source, /function applyBranding/);
	assert.match(source, /iBM Agent/);
	assert.match(source, /based on DSH/);
	assert.match(source, /ib-brand-flask/);
	assert.match(source, /ib-rail-flask/);
	assert.match(source, /\[class\*='_brand'\] svg/);
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
