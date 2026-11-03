import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listWorkbenchModules } from "../../client/src/module-registry.js";

/** 润色插件 bundle：自注册、接管内置占位页、注销后恢复母包行为。 */
test("润色插件客户端 bundle 接管内置 polishing 页面", async () => {
	const code = await readFile(new URL("../../plugins/polishing/client/index.js", import.meta.url), "utf8");
	let registration;
	globalThis.window = { __ModuleLoader__: { load(value) { registration = value; } } };
	try {
		new Function("window", code)(globalThis.window);
		assert.ok(registration);
		assert.equal(registration.id, "@ibm-lab/polishing");
		const react = {
			createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
			useState: value => [value, () => {}],
			useEffect: () => {},
			useRef: value => ({ current: value })
		};
		const exported = registration.factory(() => react);
		assert.deepEqual(exported.inject, ["remote"]);
		const dispose = exported.apply();
		const row = listWorkbenchModules().find(item => item.id === "polishing");
		assert.ok(row);
		assert.equal(row.override, true);
		assert.equal(row.label, "论文润色");
		dispose();
		assert.equal(listWorkbenchModules().some(item => item.id === "polishing"), false);
	} finally {
		delete globalThis.window;
	}
});
