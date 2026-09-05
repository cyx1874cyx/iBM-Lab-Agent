import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../helpers/boot-lite.mjs";

test("plot records: create / list by project / update topic+date / remove", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-plot-"));
	const handle = await bootLite({
		storageRoot: join(dir, "storages"),
		vendorDir: join(dir, "vendor"),
		lockFile: join(dir, "vendor.lock.json"),
		includePython: false
	});
	try {
		const plots = handle.ctx.labPlotRecords;
		const created = await plots.create({ id: "plot-01", projectId: "prj-x", topic: "GPC 曲线", date: "2026-09-01", artifactPath: "figures/gpc.svg" });
		assert.equal(created.topic, "GPC 曲线");
		assert.equal(created.date, "2026-09-01");

		// 默认日期为本地当天
		const auto = await plots.create({ id: "plot-02", projectId: "prj-x", topic: "NMR 堆叠" });
		assert.equal(auto.date.length, 10);

		const listed = await plots.list("prj-x");
		assert.equal(listed.length, 2);
		assert.equal((await plots.list("other")).length, 0);

		// 主题/日期可编辑并持久化
		const updated = await plots.update("plot-01", { topic: "GPC 重测曲线", date: "2026-09-05" });
		assert.equal(updated.topic, "GPC 重测曲线");
		assert.equal((await plots.get("plot-01")).date, "2026-09-05");

		// topic 必填；remove
		await assert.rejects(() => plots.update("plot-01", { topic: "  " }), /topic required/);
		assert.equal(await plots.remove("plot-02"), true);
		assert.equal((await plots.list("prj-x")).length, 1);
	} finally {
		await handle.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
