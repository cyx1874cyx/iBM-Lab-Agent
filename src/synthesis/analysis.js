/**
 * dsh-lab-agent: Step / Route 可行性分析（纯规则层，0.3.0 工作台 ANA-001/002）。
 *
 * 计划 §11：可行性判断必须“可解释”，只输出 绿 / 黄 / 红 / 未知 四级与
 * 文字依据，不输出伪精确概率。每个判断都尽量携带 Evidence IDs；无证据
 * 支撑的判断显式标记为 "agent-inference"。
 *
 * 本文件不依赖网络、不依赖 LLM、不操作存储，便于单测与回归。
 */

// ── 常量 ───────────────────────────────────────────────────────────────────

export const LEVELS = ["green", "yellow", "red", "unknown"];

/** 关键条件字段清单：缺失即低证据完整度。 */
export const KEY_FIELDS = [
	"reagents",
	"solvents",
	"temperature",
	"time",
	"atmosphere",
	"workup",
	"purification"
];

/** 安全关注词（粗检；命中仅提示复核，不自动否决）。 */
const SAFETY_HINTS = [
	"爆炸", "易爆", "peroxide", "n-buli", "nbuli", "butyllithium", "正丁基锂",
	"氢氟酸", "hf", "叠氮", "azide", "重氮", "diazonium", "光气", "phosgene",
	"氰化", "cyanide", "剧毒", "自燃", "pyrophoric", "高压", "sealed tube"
];

/** 高纯化/后处理负担关键词。 */
const PURIFICATION_HARD = ["preparative", "制备液相", "hplc", "sfc", "distill", "蒸馏", "反复", "多次柱层析"];

const HARD_CONDITION_HINTS = ["-78", "−78", "-40", "-20", "sealed", "封管", "高压", "微波", "160 °c", "180 °c", "150 °c"];

// ── 工具 ───────────────────────────────────────────────────────────────────

const asArray = (value) => (Array.isArray(value) ? value : []);

/** 取 Evidence 里“直接支持”该步的记录（relation=support/context；conflicts 单独看）。 */
function evidenceForStep(evidences, stepIdOrKey) {
	return asArray(evidences).filter(
		(ev) =>
			(stepIdOrKey !== undefined && (ev.stepId === stepIdOrKey || (ev.stepKey !== undefined && ev.stepKey === Number(stepIdOrKey)))) ||
			(stepIdOrKey === undefined && ev.stepId === undefined && ev.stepKey === undefined)
	);
}

/** 根据证据来源分层给出文献支持的 level（§9.1 层级越小越可信）。 */
function literatureLevel(rows) {
	if (rows.length === 0) return "unknown";
	if (rows.some((row) => row.relation === "conflicts")) return "red";
	const bestTier = Math.min(...rows.map((row) => Number(row.sourceTier) || 5));
	const confirmed = rows.some((row) => row.reviewStatus === "confirmed" || row.reviewStatus === "edited");
	if (bestTier <= 2 && (rows.length >= 2 || confirmed)) return "green";
	if (bestTier <= 3) return "yellow";
	return "yellow"; // tier 4/5 相似文献/推断 —— 只够参考，显式标记
}

/**
 * 计算某 step 的条件字段填充情况（只认结构化 procedure；纯 legacy 步骤
 * 只把 reactants/reagents 计入，conditions 原文不算温度/时间等字段的
 * 证据，避免“一段字符串填满七个字段”的虚高）。
 * @returns {{ filled: number, total: number, missing: string[] }}
 */
export function stepFieldCoverage(step) {
	const procedure = step.procedure ?? {};
	const hasProcedure = !!step.procedure && Object.keys(step.procedure).length > 0;
	const filled = (value) =>
		value !== undefined &&
		value !== null &&
		value !== "" &&
		!(Array.isArray(value) && value.length === 0) &&
		!(typeof value === "object" && Object.keys(value).length === 0);

	const reagentList = hasProcedure && procedure.reagents?.length ? procedure.reagents : step.reagents ?? [];
	const checks = {
		reagents: reagentList,
		solvents: hasProcedure ? (procedure.solvents ?? []) : [],
		temperature: hasProcedure ? (procedure.temperature ?? []) : [],
		time: hasProcedure ? (procedure.time && Object.keys(procedure.time).length ? [procedure.time] : []) : [],
		atmosphere: hasProcedure ? procedure.atmosphere : undefined,
		workup: hasProcedure ? (procedure.workup ?? []) : [],
		purification: hasProcedure ? (procedure.purification ?? []) : []
	};
	const missing = Object.entries(checks)
		.filter(([, value]) => !filled(value))
		.map(([key]) => key);
	const filledCount = Object.values(checks).filter(filled).length;
	return { filled: filledCount, total: Object.keys(checks).length, missing };
}

/**
 * 该步证据完整度（覆盖率），供 UI 显示如“字段完整度 86%”：
 * 基于结构化 procedure 关键字段填充率；纯 legacy 步骤按真实可判字段计，
 * conditions 原文只作为摘要展示、不计入完整度。
 */
export function stepCompleteness(step) {
	const coverage = stepFieldCoverage(step);
	return Math.round((coverage.filled / coverage.total) * 100);
}

function levelOf(value) {
	return LEVELS.includes(value) ? value : "unknown";
}

function dimension(key, label, level, basis, evidenceIds = []) {
	return { key, label, level: levelOf(level), basis, evidenceIds };
}

const clause = (text, inference = false) => ({ text, origin: inference ? "agent-inference" : "evidence" });

/**
 * Step 可行性分析（规则层，ANA-001）。
 * @param step  routeStep（可未 hydrate）
 * @param options {{ evidence?: any[] }} 该步证据（synthesis_evidence 行）
 * @returns {{ overall, dimensions, blockingIssues, uncertainties, validationNeeded, generatedAt, method }}
 */
export function assessStepFeasibility(step, options = {}) {
	const evidences = evidenceForStep(options.evidence ?? [], step.id ?? step.step);
	const coverage = stepFieldCoverage(step);
	const procedure = step.procedure ?? {};

	const dims = [];

	// 文献支持
	const litLevel = literatureLevel(evidences);
	dims.push(
		dimension(
			"literature-precedent",
			"文献支持",
			litLevel,
			litLevel === "unknown"
				? "暂无该步 Evidence。"
				: litLevel === "red"
					? "存在相互冲突的证据（relation=conflicts），先解决冲突再判断。"
					: `有 ${evidences.length} 条证据（最优层级 ${Math.min(...evidences.map((e) => Number(e.sourceTier) || 5))}）。`,
			evidences.filter((e) => e.relation !== "context").map((e) => e.id)
		)
	);

	// 证据完整度
	const coverageRatio = coverage.filled / coverage.total;
	const coverageLevel = coverageRatio === 0 ? "unknown" : coverageRatio >= 0.8 ? "green" : coverageRatio >= 0.5 ? "yellow" : "red";
	dims.push(
		dimension(
			"evidence-completeness",
			"证据完整度",
			coverageLevel,
			coverage.missing.length === 0
				? "关键条件字段（试剂/溶剂/温度/时间/气氛/后处理/纯化）均有来源或已明确缺失。"
				: `缺失关键字段：${coverage.missing.join("、")}。缺失不等于不可行，但应显式标记“待确认”，不得补默认值。`
		)
	);

	// 底物匹配（无相似文献/模型时只能 unknown；不做伪精确）
	const hasSimilarSource = evidences.some((e) => ["similar-literature", "patent", "reaction-db"].includes(e.sourceType));
	const substrateLevel = hasSimilarSource ? "yellow" : "unknown";
	dims.push(
		dimension(
			"substrate-similarity",
			"底物匹配",
			substrateLevel,
			hasSimilarSource
				? "存在相似反应/底物来源证据，建议人工核对相似度后确认。"
				: "暂无相似底物对照文献（仅目标论文本身时底物匹配无法独立评估）。"
		)
	);

	// 条件复杂度
	const condText = JSON.stringify([...(procedure.temperature ?? []), procedure.atmosphere ?? "", step.conditions ?? ""]).toLowerCase();
	const hardCondition = HARD_CONDITION_HINTS.some((token) => condText.includes(token));
	const condLevel = hardCondition ? "yellow" : "green";
	dims.push(
		dimension(
			"condition-complexity",
			"条件复杂度",
			condLevel,
			hardCondition
				? "含低温/高温/封管/微波等苛刻条件，执行前需确认设备与安全预案。"
				: "未检测到显著苛刻条件（按已登记字段判断）。"
		)
	);

	// 安全关注
	const allNotes = JSON.stringify([...(procedure.notes ?? []), step.conditions ?? "", step.reaction ?? ""]).toLowerCase();
	const safetyHit = SAFETY_HINTS.some((token) => allNotes.includes(token));
	dims.push(
		dimension(
			"safety-attention",
			"安全关注",
			safetyHit ? "yellow" : "green",
			safetyHit
				? "检测到安全敏感词（叠氮/强碱/自燃/高压等），务必查阅 SDS 与实验室规程后再执行。"
				: "未检测到安全敏感词（仍需按常规化学品操作规范执行）。",
			[],
		)
	);

	// 纯化负担
	const workupPur = JSON.stringify([...(procedure.purification ?? []), ...(procedure.workup ?? []), step.conditions ?? ""]).toLowerCase();
	const purificationHard = PURIFICATION_HARD.some((token) => workupPur.includes(token));
	dims.push(
		dimension(
			"purification",
			"纯化负担",
			purificationHard ? "yellow" : "green",
			purificationHard
				? "后处理/纯化包含制备级色谱、蒸馏或反复操作，耗时与成本偏高。"
				: "按登记的后处理/纯化方式评估负担可控。"
		)
	);

	const byLevel = (level) => dims.filter((d) => d.level === level);
	const overall =
		byLevel("red").length > 0 ? "red" : byLevel("yellow").length > 0 || byLevel("unknown").length > 0 ? "yellow" : "green";

	const blockingIssues = [
		...(byLevel("red").map((d) => clause(`${d.label}：${d.basis}`))),
		...(evidences.some((e) => e.relation === "conflicts")
			? [clause("存在证据冲突，禁止在未解决前把任意一方当作事实。")]
			: [])
	];

	const uncertainties = [
		...(coverage.missing.length ? [clause(`以下字段缺少来源：${coverage.missing.join("、")}。`, true)] : []),
		...(byLevel("unknown").map((d) => clause(`${d.label}：${d.basis}`, true)))
	];

	return {
		overall,
		dimensions: dims,
		blockingIssues,
		uncertainties,
		validationNeeded: [
			...(byLevel("red").length ? [clause("先消除红色项（证据冲突/关键缺失），再进入审核。")] : []),
			...(coverage.missing.length ? [clause("建议先补齐 SI/引用方法，或运行“检索该步骤其他方法”后再确认。")] : [])
		],
		method: "rule-based + evidence (0.3.0, 无 LLM 补值)",
		generatedAt: new Date().toISOString()
	};
}

/**
 * Route 级可行性分析（ANA-002）：聚合各 Step，指出 bottleneck 与低证据步骤。
 * @param route  route（steps 至少 1）
 * @param options {{ evidence?: any[] }}
 */
export function assessRouteFeasibility(route, options = {}) {
	const steps = asArray(route.steps).map((step, index) => ({ step, index }));
	const stepAssessments = steps.map(({ step, index }) => ({
		stepKey: step.step ?? index + 1,
		stepId: step.id ?? `s${step.step ?? index + 1}`,
		label: step.label ?? step.reaction ?? `Step ${step.step ?? index + 1}`,
		assessment: assessStepFeasibility(step, options)
	}));

	const worst = (level) => stepAssessments.filter((row) => row.assessment.overall === level);
	const bottlenecks = [...worst("red"), ...worst("yellow")].map((row) => ({
		stepKey: row.stepKey,
		label: row.label,
		level: row.assessment.overall,
		reasons: row.assessment.blockingIssues.length ? row.assessment.blockingIssues.map((c) => c.text) : row.assessment.uncertainties.map((c) => c.text)
	}));

	const lowEvidenceSteps = stepAssessments
		.filter((row) => row.assessment.dimensions.find((d) => d.key === "evidence-completeness")?.level !== "green")
		.map((row) => ({ stepKey: row.stepKey, label: row.label }));

	const overall =
		stepAssessments.length === 0
			? "unknown"
			: bottlenecks.some((b) => b.level === "red")
				? "red"
				: bottlenecks.length > 0
					? "yellow"
					: "green";

	return {
		overall,
		stepAssessments,
		bottlenecks,
		lowEvidenceSteps,
		summary:
			stepAssessments.length === 0
				? "路线为空，暂无可评估的步骤。"
				: `共 ${stepAssessments.length} 步。` +
					(overall === "green"
						? "各步骤证据与条件评估均为绿/黄（无红色阻断项）。"
						: overall === "red"
							? "存在红色阻断步骤，建议先解决红色项再进入实验计划。"
							: "存在需要人工复核的步骤，建议按瓶颈顺序优先小规模验证。"),
		method: "rule-based aggregation (0.3.0)",
		generatedAt: new Date().toISOString()
	};
}

export default { assessStepFeasibility, assessRouteFeasibility, stepFieldCoverage, stepCompleteness };
