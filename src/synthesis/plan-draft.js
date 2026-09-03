/**
 * dsh-lab-agent: Route → ExperimentPlan 桥接（纯映射层，0.3.0 PLAN-001）。
 *
 * 计划 §7.2 / §13：
 *  - 由 synthesis 侧给出“已确认路线数据”，映射为 experimentPlanSchema 的
 *    draft 字段；创建动作（createExperimentPlan）由 chemistry 侧执行；
 *  - 生成结果保持 requiresReview=true 与 status=draft（schema 保证）；
 *  - 缺失条件只允许“待确认/文献未提供”，绝不由模型补成事实；
 *  - 计划第 8/9 节的表征与安全模板项显式标注 (模板建议·待人工复核)，
 *    不属于论文原文事实。
 *
 * 本文件不 import chemistry 模块，避免 domain 耦合；remote 层负责调用
 * LabChemistryService.createExperimentPlan 落库。
 */

import { validateExperimentPlan } from "../chemistry/models.js";

// ── 帮助函数 ───────────────────────────────────────────────────────────────

const text = (value) => (value === undefined || value === null ? "" : String(value));

const joinNonEmpty = (parts, sep = "；") => parts.map(text).filter((part) => part.trim() !== "").join(sep);

const asArray = (value) => (Array.isArray(value) ? value : []);

/** 把一段字符串按“步骤条件行”压缩为单行，供 description/monitoring 使用。 */
function compact(line) {
	return line.replace(/\s+/g, " ").trim();
}

/** 试剂条目显示：name (amount/eq)。amount 缺失时显示“待确认”。 */
function reagentDisplay(row) {
	const quantity = joinNonEmpty([row.amount, row.equivalent], " · ");
	return quantity ? `${row.name}（${quantity}）` : `${row.name}`;
}

/** 从单个 procedure/legacy step 生成“条件摘要”字符串（只含存在的字段）。 */
export function summarizeStepConditions(step) {
	const procedure = step.procedure ?? {};
	const legacyReagents = joinNonEmpty(asArray(step.reagents), "、");

	const reagents = procedure.reagents?.length
		? procedure.reagents.map(reagentDisplay).join("、")
		: legacyReagents;
	const catalysts = procedure.catalysts?.length
		? procedure.catalysts.map((row) => (row.loading ? `${row.name}（${row.loading}）` : row.name)).join("、")
		: "";
	const solvents = procedure.solvents?.length
		? procedure.solvents.map((row) => joinNonEmpty([row.name, row.ratio, row.volume], " ")).join("、")
		: "";
	const temperature = procedure.temperature?.length
		? procedure.temperature.map((row) => joinNonEmpty([row.value, row.stage], " ")).join(" → ")
		: "";
	const time = procedure.time ? (procedure.time.text ?? joinNonEmpty([procedure.time.value, procedure.time.unit], " ")) : "";
	const atmosphere = procedure.atmosphere ?? "";
	const concentration = procedure.concentration ?? "";
	const yieldValue = procedure.yield ? joinNonEmpty([procedure.yield.value, procedure.yield.unit], "") : "";
	const workup = asArray(procedure.workup).join("；");
	const purification = asArray(procedure.purification).join("；");

	const parts = [
		reagents ? `试剂：${reagents}` : "",
		catalysts ? `催化剂：${catalysts}` : "",
		solvents ? `溶剂：${solvents}` : "",
		temperature ? `温度：${temperature}` : "",
		time ? `时间：${time}` : "",
		atmosphere ? `气氛：${atmosphere}` : "",
		concentration ? `浓度：${concentration}` : "",
		yieldValue ? `收率：${yieldValue}` : "",
		workup ? `后处理：${workup}` : "",
		purification ? `纯化：${purification}` : ""
	];
	const structured = parts.filter(Boolean).join("；");

	// legacy conditions 作为 raw 摘要补充（标注来源性质）
	if (step.conditions && structured) return compact(`${structured}（原文摘要：${step.conditions}）`);
	if (step.conditions) return compact(`原文摘要：${step.conditions}`);
	return structured ? compact(structured) : "";
}

/** 单步计划条目描述（reaction + 条件摘要 + 注意事项）。 */
export function describeStep(step) {
	const head = [step.reaction, summarizeStepConditions(step)].filter(Boolean).join("。");
	const notes = asArray(step.procedure?.notes ?? []).join("；");
	const legacy = asArray(step.procedure?.purification ?? []).length === 0 && (step.conditions ? "" : "");
	// legacy conditions 已包含在 summarize 中；notes 有则补充
	return compact(notes ? `${head}。注意事项：${notes}` : head);
}

/** 聚合步骤里明确给出的 safety 提示（notes 含安全类关键词者），返回带标注列表。 */
function collectSafetyHints(steps) {
	const hints = [];
	for (const step of steps) {
		for (const note of asArray(step.procedure?.notes ?? [])) {
			if (/危险|安全|剧毒|易燃|易爆|腐蚀|有毒|惰性气氛|干燥|无水|慎|防护|safety|hazard|toxic|flammable|corrosive|inert|anhydrous/i.test(note)) {
				hints.push(note);
			}
		}
	}
	return [...new Set(hints)];
}

/**
 * Route → ExperimentPlan draft 字段。
 *
 * @param route  已 hydrate 的 route（getRoute 返回值即可）
 * @param target 目标分子（可为 null）
 * @param options {{ evidence?: any[], scale?: string, extraSafety?: string[] }}
 * @returns ExperimentPlan 字段（不含 id/createdAt/updatedAt/status，由落库方补齐）
 * @throws 路线为空或完全没有试剂时抛错并给出可读原因
 */
export function buildPlanDraftFields(route, target = null, options = {}) {
	const steps = asArray(route.steps);
	if (steps.length === 0) {
		throw new Error("路线还没有任何步骤，无法生成实验计划草案。请先登记/确认步骤。");
	}

	const reagents = [];
	for (const step of steps) {
		const procedure = step.procedure ?? {};
		for (const row of asArray(procedure.reagents)) {
			reagents.push({
				name: row.name,
				amount: joinNonEmpty([row.amount, row.equivalent], " · ") || "待确认",
				role: joinNonEmpty(["反应物", row.role ? `(${row.role})` : ""]) || "反应物"
			});
		}
		for (const row of asArray(procedure.catalysts)) {
			reagents.push({
				name: row.name,
				amount: row.loading ?? "待确认",
				role: "催化剂"
			});
		}
		for (const legacy of asArray(step.reagents)) {
			// legacy 试剂字符串：amount 无法拆出时保持“待确认”
			if (!reagents.some((row) => row.name === legacy)) reagents.push({ name: legacy, amount: "待确认", role: "试剂" });
		}
	}
	// 去重同名条目（名称 + role 相同则合并）
	const seen = new Set();
	const uniqueReagents = [];
	for (const row of reagents) {
		const key = `${row.name}@${row.role}`;
		if (!seen.has(key)) {
			seen.add(key);
			uniqueReagents.push(row);
		}
	}
	if (uniqueReagents.length === 0) {
		throw new Error("路线步骤缺少任何试剂信息，无法生成实验计划草案。请先在步骤条件中登记试剂，或明确标记缺失。");
	}

	const safetyHints = collectSafetyHints(steps);
	const purification = [...new Set(steps.flatMap((step) => asArray(step.procedure?.purification ?? [])))];
	const workup = [...new Set(steps.flatMap((step) => asArray(step.procedure?.workup ?? [])))];

	const measurementTable = [
		{ metric: "结构确认", method: "1H/13C NMR 与 HRMS（必要）、IR（可选）", target: "" },
		{ metric: "纯度", method: "HPLC / LC-MS（按产物可溶性选择）", target: "" }
	];

	const planSteps = steps.map((step, index) => ({
		step: `Step ${step.step ?? index + 1}${step.label ? `（${step.label}）` : ""}`,
		description: describeStep(step) || `执行 ${step.reaction ?? `第 ${step.step ?? index + 1} 步`}`,
		monitoring: joinNonEmpty(asArray(step.procedure?.monitoring ?? []), "；") || undefined
	}));

	const literatureEvidence = asArray(options.evidence ?? [])
		.slice(0, 40)
		.map((row) => {
			const locator = joinNonEmpty([row.page !== undefined ? `p.${row.page}` : "", row.figure ? `Fig. ${row.figure}` : "", row.table ? `Table ${row.table}` : ""], " ");
			const reference = joinNonEmpty([row.sourceName || row.title || "", row.doi ? `DOI ${row.doi}` : "", locator], " · ");
			return {
				reference,
				notes: row.supportsField ? `支持字段：${row.supportsField}${row.excerpt ? `（引文：${row.excerpt.slice(0, 120)}）` : ""}` : row.excerpt?.slice(0, 160) || undefined
			};
		});

	const targetName = target?.name ?? route.name;
	const fields = {
		projectId: route.projectId,
		title: `${targetName} 合成实验计划草案（Route ${route.name} v${route.version}）`,
		objective: `在合成路线「${route.name}」v${route.version} 基础上制备 ${targetName}。本草案由已登记步骤与文献证据生成，缺失字段保持“待确认”，需人工复核后方可执行。`,
		scale: options.scale ?? "待确认（建议按文献量级小规模起始）",
		reagents: uniqueReagents,
		instruments: [],
		literatureEvidence,
		measurementTable,
		steps: planSteps,
		workup: workup.length ? workup.join("；") : undefined,
		purification,
		characterization: [
			"目标产物 1H/13C NMR 与 HRMS 数据与文献/SI 对照（模板建议·待人工复核）",
			...purification.length
				? ["纯度由已登记纯化方式对应的分析结果确认（HPLC/LC-MS，模板建议·待人工复核）"]
				: []
		],
		safety: [
			...(options.extraSafety ?? []),
			...safetyHints.map((note) => `操作注意：${note}`),
			"执行前按实验室安全规程与 SDS 复核所用试剂/溶剂（模板建议·待人工复核）"
		],
		alternatives: [],
		requiresReview: true,
		status: "draft"
	};

	// 落库前用 chemistry 侧校验器自检；失败抛错并附可读问题（与 createExperimentPlan 一致）
	const validation = validateExperimentPlan(fields);
	if (!validation.ok) {
		throw new Error(`生成的实验计划草案不完整：${validation.problems.join("；")}`);
	}
	return fields;
}

export default buildPlanDraftFields;
