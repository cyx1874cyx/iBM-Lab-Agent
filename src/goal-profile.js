/**
 * dsh-lab-agent: ReadingGoalProfile — 可替换精读目标系统（纯逻辑层）。
 *
 * 计划 §三：用户创建/保存/复制/修改精读目标，任务开始时选择具体版本；
 * 配置转换为 nature-paper-card 的重点审查要求；固定 01–16 节结构不删除，
 * 用户目标决定各节深度与强调内容；任务保存配置快照，后续修改不影响旧报告。
 *
 * 版本语义（本模块提供纯函数，持久化在 lib/goal-profiles.js）：
 *   - 版本行不可变，key = `${id}@${version}`，version 为单调递增数字字符串；
 *   - update = 基于最新版本发布新版本；delete = 发布 status:"archived" 版本
 *     （历史版本与快照永远可读）；
 *   - resolve(id, version?) 读具体版本行，缺省取最新。
 */

import { z } from "zod";

import { PROFILE_ID_RE } from "./contracts/identifiers.js";
export { PROFILE_ID_RE } from "./contracts/identifiers.js";

/** Paper Card 契约：固定 01–16 节，永不因目标切换而删除（计划 §三 规则 3/4）。 */
export const PAPER_CARD_SECTION_CONTRACT = "01-16 fixed sections preserved; user goal sets depth/emphasis only";

/** 报告语言。 */
export const REPORT_LANGUAGES = ["zh", "en", "zh-en"];

/** 报告深度。 */
export const REPORT_DEPTHS = ["concise", "standard", "detailed"];

/** 一个 ReadingGoalProfile 版本行（不含内部 meta 字段）。 */
export const readingGoalProfileSchema = z.object({
	id: z.string().regex(PROFILE_ID_RE),
	version: z.string().regex(/^\d+$/),
	/** 显示名（可含中文/空格）。 */
	name: z.string().min(1),
	/** 适用课题。 */
	topics: z.array(z.string()).default([]),
	/** 标签。 */
	tags: z.array(z.string()).default([]),
	/** 目标受众。 */
	audience: z.string().default("课题组组会"),
	/** 报告语言。 */
	language: z.enum(REPORT_LANGUAGES).default("zh"),
	/** 报告深度。 */
	depth: z.enum(REPORT_DEPTHS).default("detailed"),
	/** 重点研究问题。 */
	researchQuestions: z.array(z.string()).default([]),
	/** 重点审查章节（paper-card 01–16 节的子集或强调顺序）。 */
	reviewSections: z.array(z.string()).default([]),
	/** 必须检查的证据类型。 */
	requiredEvidenceTypes: z.array(z.string()).default([]),
	/** 需要执行的外部核验。 */
	externalVerifications: z.array(z.string()).default([]),
	/** 需要计算或整理的指标。 */
	metricsToExtract: z.array(z.string()).default([]),
	/** 不需要展开的内容。 */
	excludedContent: z.array(z.string()).default([]),
	/** 自定义术语与定义。 */
	customTerms: z.record(z.string(), z.string()).default({}),
	/** 输出附加要求。 */
	outputRequirements: z.array(z.string()).default([]),
	/** 派生报告结构（可选）：需要完全不同报告结构时，以标准 Paper Card 为证据
	 *  底稿再生成派生报告，不改动上游 Skill 契约（计划 §三 规则 4）。 */
	derivedReportStructure: z.string().optional(),
	/** 内部 meta（由服务维护）。 */
	status: z.enum(["active", "archived"]).default("active"),
	createdAt: z.string(),
	updatedAt: z.string()
});

/** 版本行 key：id@version。 */
export const goalKey = (id, version) => `${id}@${version}`;

/** 从一组行计算下一个版本号（max+1，字符串）。 */
export function nextVersion(versions) {
	const max = versions.reduce((m, v) => Math.max(m, Number(v)), 0);
	return String(max + 1);
}

/** 历史版本兼容入口；通用科研默认使用 createDefaultResearchGoal。 */
export function createDefaultProdrugPolymerGoal(now = new Date().toISOString()) {
	return readingGoalProfileSchema.parse({
		id: "default-prodrug-polymer",
		version: "1",
		name: "聚前药/高分子精读（默认）",
		topics: ["聚前药", "高分子材料设计", "药物递送"],
		tags: ["prodrug", "polymer", "default"],
		audience: "课题组组会",
		language: "zh",
		depth: "detailed",
		researchQuestions: [
			"聚合物的骨架、单体和聚合策略是什么？",
			"药物如何连接到聚合物（连接方式、连接臂、释放机制）？",
			"关键分子量与结构参数（Mn/Mw/Đ/DP/取代度/载药量）如何报告与验证？",
			"纳米制剂关键性质（粒径/CMC/形貌/稳定性/降解）如何表征？",
			"体内外实验的设计、对照、统计与毒性结论是否充分？",
			"结构—性能关系的关键证据链是否完整？",
			"作者结论的边界、局限与可验证的后续方向是什么？"
		],
		reviewSections: [
			"01-polymer-design",
			"02-conjugation-chemistry",
			"03-characterization",
			"04-nanoparticle-properties",
			"05-biological-evaluation",
			"06-structure-property-relationship"
		],
		requiredEvidenceTypes: [
			"GPC/MALDI 分子量数据",
			"NMR/FTIR 结构确认",
			"DLS/TEM 粒径与形貌",
			"CMC 测定",
			"体外释放曲线",
			"细胞/动物实验原始数据与统计"
		],
		externalVerifications: [
			"关键数字追溯到原文图表或页码",
			"统计显著性（n、对照、p 值）核验",
			"载药量/取代度公式核验"
		],
		metricsToExtract: [
			"Mn, Mw, Đ",
			"DP（聚合度）",
			"取代度",
			"载药量（DL）与包封率（EE）",
			"粒径、PDI、zeta 电位",
			"CMC",
			"释放半衰期/累计释放率"
		],
		excludedContent: [
			"与聚前药/高分子无关的泛泛背景介绍",
			"未经验证的分子模拟细节"
		],
		customTerms: {
			"聚前药": "以聚合物为载体、药物通过可断裂连接臂偶联的前药",
			"Đ": "分子量分散度 Mw/Mn",
			"载药量": "药物质量占聚合物-药物偶联物总质量的百分比"
		},
		outputRequirements: [
			"每个数字必须带页码/图表/来源块定位",
			"来源不足处标注“无法判断”，不补写不可见内容",
			"区分数据库实测值、计算值与模型预测值"
		],
		derivedReportStructure: undefined,
		status: "active",
		createdAt: now,
		updatedAt: now
	});
}

export const DEFAULT_RESEARCH_GOAL_ID = 'default-research';

/** General research defaults; discipline-specific goals remain explicit choices. */
export function createDefaultResearchGoal(now = new Date().toISOString()) {
	return readingGoalProfileSchema.parse({
		id: DEFAULT_RESEARCH_GOAL_ID, version: '1', name: '通用科研精读（默认）',
		topics: [], tags: ['research', 'default'], audience: '科研阅读与讨论', language: 'zh', depth: 'detailed',
		researchQuestions: [
			'研究试图回答什么问题，现有证据的不足是什么？',
			'核心假设、研究设计和方法是什么，为什么采用这些方法？',
			'数据来源、样本或研究对象、对照与评价标准是否适当？',
			'主要结果有哪些，对应的原始证据、统计分析或推导是什么？',
			'结论是否由证据支持，适用范围、局限和替代解释是什么？',
			'研究过程能否复现，对当前课题有哪些可验证的启发？'
		],
		reviewSections: ['研究问题与背景', '研究设计与方法', '结果与证据', '结论与局限', '复现与课题联系'],
		requiredEvidenceTypes: ['原文中的关键数据、图表、公式或论证', '研究设计、数据或样本来源及评价方法', '结论与证据之间的对应关系'],
		externalVerifications: ['关键结论与数字追溯到原文位置', '根据研究类型核对统计、计算或推理的适用性'],
		metricsToExtract: ['与当前研究问题相关的指标、定义、单位和不确定性', '适用时提取样本量、对照、效应大小和统计结果'],
		excludedContent: ['与研究问题无关的泛泛背景', '没有来源支持的结论或数字'], customTerms: {},
		outputRequirements: ['关键结论附页码、图表、公式或来源块定位', '区分作者报告、复算结果和推测，证据不足时明确说明', '根据当前课题与论文类型选取指标，不预设学科方向'],
		status: 'active', createdAt: now, updatedAt: now
	});
}

/** Resolve implicit defaults without changing historical project/task snapshots. */
export function projectReadingGoal(project) {
	const goal=project?.goalProfile;
	return !goal || (goal.id==='default-prodrug-polymer'&&goal.version==='1')
		? {id:DEFAULT_RESEARCH_GOAL_ID,version:'1'} : {id:goal.id,version:goal.version};
}

/** Legacy ID remains resolvable for saved reports and explicit user selections. */
export const BUILTIN_GOALS = [createDefaultResearchGoal(),{...createDefaultProdrugPolymerGoal(),name:'聚前药/高分子精读（历史配置）',tags:['prodrug','polymer','legacy']}];

/**
 * 转换为 nature-paper-card 的重点审查要求（计划 §三 规则 2）。
 * 输出为模型可直接注入 paper-card 的结构化 JSON；固定 01–16 节契约始终保留。
 */
export function toPaperCardRequirements(goal) {
	return {
		audience: goal.audience,
		language: goal.language,
		depth: goal.depth,
		researchQuestions: goal.researchQuestions,
		emphasisSections: goal.reviewSections,
		requiredEvidenceTypes: goal.requiredEvidenceTypes,
		externalVerifications: goal.externalVerifications,
		metricsToExtract: goal.metricsToExtract,
		excludedContent: goal.excludedContent,
		customTerms: goal.customTerms,
		outputRequirements: goal.outputRequirements,
		paperCardContract: {
			sections: PAPER_CARD_SECTION_CONTRACT,
			structure: goal.derivedReportStructure ?? "standard paper-card 01-16"
		}
	};
}

/** 复制一个目标为新 id（计划 §三：可复制）。 */
export function cloneGoal(source, id, name, now = new Date().toISOString()) {
	return readingGoalProfileSchema.parse({
		...source,
		id,
		version: "1",
		name,
		status: "active",
		createdAt: now,
		updatedAt: now
	});
}
