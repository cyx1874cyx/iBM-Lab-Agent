import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listWorkbenchModules } from "../../client/src/module-registry.js";

const repoRoot = pathToFileURL(join(import.meta.dirname, "..", "..") + "/").href;

/**
 * 插件客户端 bundle 的契约验收（无浏览器）：
 * 产物必须自注册为 `__ModuleLoader__.load({ id })`，导出 apply/inject，
 * 调用 apply 后工作台注册表出现该模块，注销后消失。
 * React 用最小替身满足 bundle 的 require，不渲染组件。
 */
test("试剂插件客户端 bundle 自注册并接管内置 reagents 页面", async () => {
	const code = await readFile(new URL("../../plugins/reagents/client/index.js", import.meta.url), "utf8");
	let registration;
	globalThis.window = { __ModuleLoader__: { load(value) { registration = value; } } };
	try {
		new Function("window", code)(globalThis.window);
		assert.ok(registration, "bundle 必须调用 __ModuleLoader__.load");
		assert.equal(registration.id, "@ibm-lab/reagents");

		const react = {
			createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
			useState: value => [value, () => {}],
			useEffect: () => {},
			useRef: value => ({ current: value })
		};
		const reactDom = { createPortal: node => node };
		const exported = registration.factory(name => name === "react" ? react : reactDom);
		assert.equal(typeof exported.apply, "function");
		assert.deepEqual(exported.inject, ["remote"]);

		const dispose = exported.apply();
		const row = listWorkbenchModules().find(item => item.id === "reagents");
		assert.ok(row, "apply 之后注册表应有 reagents 模块");
		assert.equal(row.override, true, "插件需显式接管内置页面");
		assert.equal(row.icon, "flask");
		assert.equal(typeof row.render, "function");

		dispose();
		assert.equal(listWorkbenchModules().some(item => item.id === "reagents"), false);
	} finally {
		delete globalThis.window;
	}
});
