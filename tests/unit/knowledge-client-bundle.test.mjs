import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listWorkbenchModules } from "../../client/src/module-registry.js";

/** 知识库插件 bundle：自注册、接管内置 knowledge 页面、注销后恢复。 */
test("知识库插件客户端 bundle 接管内置 knowledge 页面", async () => {
	const code = await readFile(new URL("../../plugins/knowledge/client/index.js", import.meta.url), "utf8");
	let registration;
	globalThis.window = { __ModuleLoader__: { load(value) { registration = value; } } };
	try {
		new Function("window", code)(globalThis.window);
		assert.ok(registration);
		assert.equal(registration.id, "@ibm-lab/knowledge");
		const react = {
			createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
			useState: value => [value, () => {}],
			useEffect: () => {},
			useRef: value => ({ current: value })
		};
		const reactDom = { createPortal: node => node };
		const exported = registration.factory(name => name === "react" ? react : reactDom);
		assert.deepEqual(exported.inject, ["remote"]);
		const dispose = exported.apply();
		const row = listWorkbenchModules().find(item => item.id === "knowledge");
		assert.ok(row);
		assert.equal(row.override, true);
		assert.equal(row.icon, "layers");
		assert.equal(typeof row.render, "function");
		dispose();
		assert.equal(listWorkbenchModules().some(item => item.id === "knowledge"), false);
	} finally {
		delete globalThis.window;
	}
});
