/**
 * Regression case: ReadingGoalProfile.
 *
 * §八 精读目标测试：内置默认聚前药配置完整；转换保留 01–16 契约；不同目标
 * 产生不同重点；版本快照不可变（服务级）；删除后历史版本仍可读。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootLite } from "../../../tests/helpers/boot-lite.mjs";
import { toPaperCardRequirements, PAPER_CARD_SECTION_CONTRACT } from "../../../src/goal-profile.js";

export default {
	name: "goal-profile",
	description: "默认聚前药目标完整；01-16 契约保留；版本快照不可变；删除后历史可读",
	tags: ["goals"],
	required: [],
	async run(ctx) {
		const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-reg-goal-"));
		const handle = await bootLite({
			storageRoot: join(dir, "storages"),
			vendorDir: join(dir, "vendor"),
			lockFile: join(dir, "vendor.lock.json"),
			includePython: false,
			extraRows: [{ id: "lab-goal-profiles", name: "dsh-lab-agent/goal-profiles", inject: ["storageDomain"] }]
		});
		try {
			const goals = handle.ctx.labGoals;
			const problems = [];

			const def = await goals.resolve("default-prodrug-polymer");
			if (!def) problems.push("default-prodrug-polymer not seeded");
			else {
				if (def.metricsToExtract.length < 5) problems.push("default metrics too few");
				if (def.customTerms["聚前药"] === undefined) problems.push("default customTerms missing");
			}

			// 转换契约
			const req = toPaperCardRequirements(await goals.resolve("default-prodrug-polymer"));
			if (req.paperCardContract.sections !== PAPER_CARD_SECTION_CONTRACT) problems.push("01-16 contract violated");

			// 版本快照：update 后旧版本与快照不变
			await goals.create("reg-goal", { name: "reg", researchQuestions: ["A"] });
			await goals.update("reg-goal", { researchQuestions: ["B"] });
			const v1 = await goals.resolve("reg-goal", "1");
			const snapshot = await goals.snapshotForTask("reg-goal", "1");
			await goals.update("reg-goal", { researchQuestions: ["C"] });
			if (v1.researchQuestions[0] !== "A") problems.push("v1 mutated by update");
			if (snapshot.researchQuestions[0] !== "A") problems.push("task snapshot mutated by update");

			// 删除后历史仍可读
			await goals.deleteProfile("reg-goal");
			if ((await goals.list()).some((g) => g.id === "reg-goal")) problems.push("deleted goal still listed");
			if (!(await goals.resolve("reg-goal", "2"))) problems.push("history unreadable after delete");

			return { pass: problems.length === 0, details: problems.length === 0 ? "default goal + versioning + delete semantics ok" : problems.join("; ") };
		} finally {
			await handle.dispose();
			await rm(dir, { recursive: true, force: true });
		}
	}
};
