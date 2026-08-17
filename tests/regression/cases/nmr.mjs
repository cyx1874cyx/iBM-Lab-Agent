/**
 * Regression case: NMR 工作流与聚合物积分计算（§五）。
 *
 * 状态机（准备→人工审核→写回→视觉质检）、已审核积分不可覆盖、打回保留历史、
 * 计算只接受已审核积分；组成/转化率/端基DP/取代度/载药量公式。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { endGroupDp, conversionFromIntegrals, compositionFromIntegrals, substitutionFromIntegrals, drugLoadingFromSubstitution } from "../../../src/nmr/integration-calc.js";

export default {
	name: "nmr",
	description: "工作流状态机/不可覆盖保护/积分计算公式",
	tags: ["nmr"],
	required: [],
	async run() {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-nmr-"));
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [{ id: "lab-nmr", name: "dsh-lab-agent/nmr", inject: ["storageDomain"] }]
		});
		try {
			const nmr = handle.ctx.labNmr;
			const problems = [];

			// 公式层（离线）
			if (compositionFromIntegrals({ aIntegral: 2, aProtons: 1, bIntegral: 1, bProtons: 1 }).value !== 2 / 3) problems.push("composition wrong");
			if (conversionFromIntegrals({ polyIntegral: 9, polyProtons: 1, residualIntegral: 1, residualProtons: 1 }).value !== 0.9) problems.push("conversion wrong");
			if (endGroupDp({ repeatIntegral: 100, repeatProtons: 2, endGroupIntegral: 2, endGroupProtons: 2 }).value !== 50) problems.push("end-group DP wrong");
			if (substitutionFromIntegrals({ drugIntegral: 0.5, drugProtons: 1, polymerIntegral: 10, polymerProtons: 2, sitesPerChain: 4 }).value !== 2.5) problems.push("substitution wrong");
			if (drugLoadingFromSubstitution({ dsPercent: 2.5, sitesPerChain: 4, polymerMw: 20000, drugMw: 543.52 }).value <= 0) problems.push("drug loading wrong");

			// 工作流
			await nmr.createDataset({ id: "reg-nmr", name: "reg", fidPath: "/data/reg.fid" });
			await nmr.setDraftIntegrals("reg-nmr", [
				{ peak: "a", integral: 2, protons: 1, assignment: "A" },
				{ peak: "b", integral: 1, protons: 1, assignment: "B" }
			]);
			const approved = await nmr.approveIntegrals("reg-nmr");
			if (approved.status !== "approved-written") problems.push("approve failed");
			let overwriteBlocked = false;
			try {
				await nmr.approveIntegrals("reg-nmr");
			} catch {
				overwriteBlocked = true;
			}
			if (!overwriteBlocked) problems.push("approved integrals overwritable");

			// 计算只接受已审核积分（approve 前拒绝）
			await nmr.createDataset({ id: "reg-nmr-un", name: "un", fidPath: "/data/u.fid" });
			let blocked = false;
			try {
				await nmr.calculate("reg-nmr-un", "conversion", { polyIntegral: 9, polyProtons: 1, residualIntegral: 1, residualProtons: 1 });
			} catch {
				blocked = true;
			}
			if (!blocked) problems.push("calculation allowed without approved integrals");

			// 视觉质检闭环
			await nmr.markWrittenBack("reg-nmr");
			const verified = await nmr.visualVerify("reg-nmr");
			if (verified.status !== "visually-verified") problems.push("visual verify failed");

			return { pass: problems.length === 0, details: problems.length === 0 ? "nmr workflow + integration calc ok" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
