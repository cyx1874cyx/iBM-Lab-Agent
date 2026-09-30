/**
 * dsh-lab-agent: 客户端 Remote 描述符 ↔ 调用点 ↔ Host 服务的三方一致性。
 *
 * 背景（本次改版 现场 bug）：`lab/note_templates_list` 在 client/src/descriptors.js
 * 里声明成 0 参数，而 components-templates.js 用 `{ request: { kind } }` 调用，
 * wire 层直接拒绝：
 *   client api: lab/note_templates_list expected 0 argument(s), got 1
 * 于是「模板列表」永远显示错误，即使模板已经导入。
 *
 * 同类问题还发现两处：synth_step_set_structure / synth_step_resolve_dual
 * 服务端有实现、前端在调用，但描述符里根本没声明。
 *
 * 本测试用「导入真实描述符 + 扫描真实调用点」的方式锁死这三方：
 *   1. 每个 call("method", ...) 的 method 必须在描述符里存在；
 *   2. 传了参数的方法必须恰好声明一个 request 参数（0 参数方法不许带参）；
 *   3. 每个描述符方法在 LabRemoteService.prototype 上必须有实现。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDescriptors } from "../../client/src/descriptors.js";
import LabRemoteService from "../../lib/remote.js";

const clientSrcDir = fileURLToPath(new URL("../../client/src", import.meta.url));

/** 所有 `call("method", ...)` 调用点（`call` 是 apply.js 里的 Remote 包装）。 */
async function callSites() {
	const names = (await readdir(clientSrcDir)).filter((name) => name.endsWith(".js"));
	const sites = [];
	for (const name of names) {
		const source = await readFile(join(clientSrcDir, name), "utf8");
		const pattern = /call\(\s*"([a-z0-9_]+)"\s*(,)?/g;
		let match;
		while ((match = pattern.exec(source)) !== null) {
			sites.push({
				method: match[1],
				passesArgument: match[2] === ",",
				file: name,
				line: source.slice(0, match.index).split("\n").length
			});
		}
	}
	return sites;
}

test("note_templates_list 声明 request 参数（本次改版 报错回归）", () => {
	const descriptor = buildDescriptors().find((row) => row.method === "note_templates_list");
	assert.ok(descriptor, "note_templates_list 必须在描述符里");
	assert.deepEqual(descriptor.parameters.map((parameter) => parameter.name), ["request"]);
});

test("每个 call(...) 都能在描述符里找到，且参数个数一致", async () => {
	const byMethod = new Map(buildDescriptors().map((row) => [row.method, row]));
	const problems = [];
	for (const site of await callSites()) {
		const descriptor = byMethod.get(site.method);
		const where = `${site.file}:${site.line}`;
		if (descriptor === undefined) {
			problems.push(`${where} 调用了未声明的 lab/${site.method}`);
			continue;
		}
		const names = descriptor.parameters.map((parameter) => parameter.name);
		if (site.passesArgument && names.length === 0) {
			problems.push(`${where} lab/${site.method} 传了参数，但描述符声明 0 参数`);
		}
		if (!site.passesArgument && names.length > 0) {
			problems.push(`${where} lab/${site.method} 未传参数，但描述符声明 ${names.join(",")}`);
		}
		if (names.length > 0 && names.join(",") !== "request") {
			problems.push(`${where} lab/${site.method} 的参数不是单个 request：${names.join(",")}`);
		}
	}
	assert.deepEqual(problems, [], problems.join("\n"));
});

test("每个描述符方法在 LabRemoteService 上都有实现", () => {
	const missing = buildDescriptors()
		.filter((row) => typeof LabRemoteService.prototype[row.method] !== "function")
		.map((row) => row.method);
	assert.deepEqual(missing, [], `服务端缺少实现：${missing.join(", ")}`);
});
