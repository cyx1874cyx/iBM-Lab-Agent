/**
 * Browser acceptance: 真实浏览器（系统 Edge/Chrome headless + puppeteer-core）
 * 驱动仓库内 ketcher-standalone 页面，按 rc.4 review §7.2 验收 Ketcher：
 *  - ready / setMolecule 载入 / PNG 导出 / SVG 导出；
 *  - 连续 10 个不同结构全部成功；
 *  - 单项失败隔离（无效结构 → image:error，随后任务仍完成）；
 *  - 断网（offline）后核心流程仍可用（无 CDN/外部依赖）。
 *
 * 运行：node --test tests/browser/ketcher-offline.test.mjs
 * 前置：本机安装 Edge 或 Chrome（或用 LAB_BROWSER_PATH 指定可执行文件）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { launchKetcherPage } from "./helpers/ketcher-page.mjs";

const STRUCTURES = [
	"CCO", // 乙醇
	"CC(C)C(=O)O", // 异丁酸
	"c1ccccc1", // 苯（芳香）
	"c1ccc(cc1)C(=O)O", // 苯甲酸
	"CC(=O)Oc1ccccc1C(=O)O", // 阿司匹林
	"C[C@H](N)C(=O)O", // 丙氨酸（手性）
	"CC(C)(C)OC(=O)NC[C@H](O)c1ccccc1", // 手性+叔丁基
	"ClC(Cl)(Cl)Cl", // 四氯化碳
	"CCN(CC)CC", // 三乙胺
	"O=C(O)c1ccccc1O" // 水杨酸
];

test("ketcher offline: ready → PNG/SVG export via host protocol", async () => {
	const ctx = await launchKetcherPage();
	try {
		// Ketcher 初始化完成（onInit → post ready）。离线资产需全部就绪。
		const ready = await ctx.waitFor("ready", { timeout: 60000 });
		assert.ok(ready.index >= 0, "Ketcher iframe/页面就绪");

		// PNG 导出：宿主发 render（smiles）→ 收 image dataURL png
		await ctx.post("render", { smiles: "CCO", width: 320, height: 180, theme: "#ffffff" });
		const png = await ctx.waitFor("image", { timeout: 60000 });
		assert.match(png.message.dataUrl, /^data:image\/png;base64,/, "PNG 导出成功");
		const pngBytes = Buffer.from(png.message.dataUrl.split(",")[1], "base64");
		assert.equal(pngBytes.readUInt32BE(16), 320, "PNG 宽度遵循宿主请求");
		assert.equal(pngBytes.readUInt32BE(20), 180, "PNG 高度遵循宿主请求");

		// SVG 导出（format=svg → data:image/svg+xml）
		await ctx.post("render", { smiles: "CCO", format: "svg", width: 360, height: 200, theme: "#ffffff" });
		const svg = await ctx.waitFor("image", { timeout: 60000, predicate: (row) => row.format === "svg" });
		assert.match(svg.message.dataUrl, /^data:image\/svg\+xml;base64,/, "SVG 导出成功");
		const svgText = Buffer.from(svg.message.dataUrl.split(",")[1], "base64").toString("utf8");
		assert.match(svgText, /width="360"/);
		assert.match(svgText, /height="200"/);
	} finally {
		await ctx.close();
	}
});

test("ketcher editor: setMolecule loads and visible Save returns the edited molecule", async () => {
	const ctx = await launchKetcherPage();
	try {
		await ctx.waitFor("ready", { timeout: 60000 });
		await ctx.post("setMolecule", { smiles: "CCO" });
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
		await ctx.page.evaluate(() => {
			const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("保存结构"));
			if (!button) throw new Error("保存结构按钮不存在");
			button.click();
		});
		const saved = await ctx.waitFor("molecule", { timeout: 30000 });
		assert.match(saved.message.smiles, /CCO/, "保存按钮回传当前结构 SMILES");
	} finally {
		await ctx.close();
	}
});

test("ketcher offline: 10 个不同结构全部渲染成功（连续任务不互相阻塞）", async () => {
	const ctx = await launchKetcherPage();
	try {
		await ctx.waitFor("ready", { timeout: 60000 });
		let since = 0;
		for (const smiles of STRUCTURES) {
			await ctx.post("render", { smiles });
			const image = await ctx.waitFor("image", { timeout: 45000, since });
			assert.match(image.message.dataUrl, /^data:image\/png;base64,/, `${smiles} 渲染成功`);
			since = image.index + 1;
		}
	} finally {
		await ctx.close();
	}
});

test("ketcher offline: single invalid structure fails in isolation; later tasks still complete", async () => {
	const ctx = await launchKetcherPage();
	try {
		await ctx.waitFor("ready", { timeout: 60000 });
		// 先让正常结构成功
		await ctx.post("render", { smiles: "CCO" });
		const ok1 = await ctx.waitFor("image", { timeout: 45000 });
		// 无效结构 → shell setMolecule 抛错 → image:error（明确失败，不伪造）
		await ctx.post("render", { smiles: "not-a-valid-smiles!!" });
		const error = await ctx.waitFor("image:error", { timeout: 45000, since: ok1.index + 1 });
		assert.ok(error.message.message, "失败任务返回 image:error 带原因");
		// 失败隔离：随后正常结构仍完成
		await ctx.post("render", { smiles: "c1ccccc1" });
		const ok2 = await ctx.waitFor("image", { timeout: 45000, since: error.index + 1 });
		assert.match(ok2.message.dataUrl, /^data:image\/png;base64,/, "单项失败后队列后续任务正常完成");
	} finally {
		await ctx.close();
	}
});

test("ketcher offline: full flow works with network disabled (no CDN/external dependency)", async () => {
	const ctx = await launchKetcherPage();
	try {
		await ctx.waitFor("ready", { timeout: 60000 });
		// 页面与资产已加载 → 断网后再跑核心流程
		await ctx.page.setOfflineMode(true);
		await ctx.post("render", { smiles: "CC(C)C(=O)O" });
		const png = await ctx.waitFor("image", { timeout: 45000 });
		assert.match(png.message.dataUrl, /^data:image\/png;base64,/, "断网后渲染仍成功（全离线资产）");
		await ctx.post("render", { smiles: "c1ccccc1", format: "svg" });
		const svg = await ctx.waitFor("image", { timeout: 45000, predicate: (row) => row.format === "svg" });
		assert.match(svg.message.dataUrl, /^data:image\/svg\+xml;base64,/, "断网后 SVG 导出仍成功");
		// 无任何外部导航/请求（页面保持同源静态服务）
		const finalUrl = await ctx.page.url();
		assert.match(finalUrl, /^http:\/\/127\.0\.0\.1/, "页面停留在本地离线服务");
	} finally {
		await ctx.close();
	}
});
