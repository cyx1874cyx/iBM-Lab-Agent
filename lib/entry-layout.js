/**
 * 文献条目目录布局与命名规范。
 *
 * 命名规范（课题组《文献命名及分类保存建议》）：
 *
 *   <期刊缩写> <年份> <通讯作者> <中文内容概括> <英文题目前段>
 *
 * 例：
 *   JACS 2012 DeSimone PRINT纳米粒子表面硅基改性CPT 酸敏感释放 Incorporation and Controlled Release of Silyl
 *   ACS NANO 2021 张志平 仿生纳米囊泡 化疗免疫 Immunogenic Hybrid Nanovesicles
 *
 * 硬约束（来自同一份建议）：
 *   * 命名中**不出现标点符号**（否则复制/转移困难）——中文标点删除，英文标点替换为空格
 *     以保留词间分隔；
 *   * 英文题目**只取前面部分**（默认前 8 个词）；
 *   * SI 采用同一规则并加 ` SI`；名称过长时从尾部（题目前段）适当缩短。
 *
 * 所有产物落在同一条目目录：
 *
 *   <课题工作区>/literature/<entryStem>/
 *     <entryStem>.pdf                正文
 *     <siStem> SI.pdf                补充材料
 *     <entryStem> 精读报告.md/.docx
 *     <entryStem> 文献汇报.pptx
 *
 * entryStem 在 bundle 占位创建时固化（bundle.entryStem/entryDir）；同一 bundle 的分批
 * 存档（先正文后 SI）必须复用同一目录，不产生第二个文件夹。
 *
 * 命名各段可缺：缺哪段就少哪段，不写占位词，也不退回旧命名——可预测性优先。
 */

import { join } from "node:path";

export const ENTRY_DIR_NAME = "literature";
/** 条目标识总长上限（Unicode 码元）。五段命名比旧的两段长得多，但仍要为 Windows
 *  MAX_PATH 留余量：<workspace>/literature/<stem>/<stem> 精读报告.docx。 */
export const ENTRY_STEM_MAX = 120;
/** 英文题目前段的词数（幻灯片「文章题目可以取前面部分」）。 */
export const TITLE_LEAD_WORDS = 8;
/** SI 文件名超过该长度时从尾部缩短（幻灯片「可以适当缩短后面部分的文献名」）。 */
export const SI_STEM_MAX = 90;
export const SHORT_INTRO_MAX = 10;
export const WINDOWS_INVALID_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g;
export const TRAILING_DOT_OR_SPACE_RE = /[. ]+$/;

/** 中文/全角标点：直接删除（否则会留下空格碎屑）。 */
const CJK_PUNCTUATION_RE = /[，。；：、！？…·—–～（）【】《》〈〉「」『』“”‘’〔〕［］｛｝＜＞＋－＝％＃＠＆＊／＼｜]/g;
/** 英文/半角标点：替换为空格，保留词间分隔（避免 Prodrug-polymer 连成 Prodrugpolymer）。 */
const ASCII_PUNCTUATION_RE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;

/**
 * 常见期刊缩写（键 = 期刊名小写、非字母数字压成单空格）。
 * 只覆盖课题组常用刊；未命中时由 Agent 通过 naming.journalAbbrev 提供，或退回清洗后的原刊名。
 */
const JOURNAL_ABBREVIATIONS = {
	"journal of the american chemical society": "JACS",
	"acs nano": "ACS NANO",
	"advanced materials": "AM",
	"advanced functional materials": "AFM",
	"advanced science": "Adv Sci",
	"advanced healthcare materials": "Adv Healthc Mater",
	"angewandte chemie international edition": "Angew Chem Int Ed",
	"nature": "Nature",
	"nature materials": "Nat Mater",
	"nature nanotechnology": "Nat Nanotechnol",
	"nature communications": "Nat Commun",
	"nature chemistry": "Nat Chem",
	"nature biomedical engineering": "Nat Biomed Eng",
	"science": "Science",
	"science advances": "Sci Adv",
	"nano letters": "Nano Lett",
	"small": "Small",
	"biomaterials": "Biomaterials",
	"biomacromolecules": "Biomacromolecules",
	"macromolecules": "Macromolecules",
	"polymer chemistry": "Polym Chem",
	"chemical reviews": "Chem Rev",
	"chemical society reviews": "Chem Soc Rev",
	"journal of controlled release": "J Control Release",
	"acs applied materials interfaces": "ACS Appl Mater Interfaces",
	"journal of medicinal chemistry": "J Med Chem",
	"polymer": "Polymer",
	"acta biomaterialia": "Acta Biomater"
};

/** 清理 Windows 非法字符、控制字符；压缩空白；去掉尾部空格与句点；限制总长。 */
export function sanitizeEntryStem(text) {
	const cleaned = String(text ?? "")
		.replace(WINDOWS_INVALID_CHARS_RE, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(TRAILING_DOT_OR_SPACE_RE, "");
	return cleaned.slice(0, ENTRY_STEM_MAX);
}

/**
 * 去掉标点：中文标点删除，英文标点替换为空格，再压缩空白。
 * 结果是「不含任何标点」但仍保留词边界，符合命名规范的第一条硬约束。
 */
export function stripPunctuation(text) {
	return String(text ?? "")
		.replace(CJK_PUNCTUATION_RE, "")
		.replace(ASCII_PUNCTUATION_RE, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * 短介绍：**旧版**（0.1.15）的 10 字回退，保留给既有调用方与测试。
 * 数字与英文标点都替换为空格；新命名路径不再使用它——把英文标题切 10 个字符
 * 当作「中文内容概括」会与题目前段重复（实测：`A prodrug A prodrug polymer ...`）。
 */
export function shortIntroOf(title) {
	const cleaned = String(title ?? "")
		.replace(/[，。；：、！？…·—～（）【】《》〈〉「」『』“”‘’]/g, "")
		.replace(/[,.!?;:()\[\]{}"'`~@#$%^&*_+=/\\|<>*\d]/g, " ")
		.replace(WINDOWS_INVALID_CHARS_RE, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(TRAILING_DOT_OR_SPACE_RE, "");
	return Array.from(cleaned).slice(0, SHORT_INTRO_MAX).join("");
}

/** 旧版短引用：report.shortCitation → 第一作者 et al. 年份 → DOI → bundle id。 */
export function shortCitationOf(bundle, report) {
	if (report?.shortCitation) return report.shortCitation;
	const author = bundle?.authors?.[0];
	if (author && bundle?.year) return `${author} et al. ${bundle.year}`;
	if (author) return `${author} et al.`;
	if (bundle?.doi) return bundle.doi;
	return bundle?.id ?? "literature";
}

/** 英文题目前段：去标点后取前 N 个词。 */
export function titleLeadOf(title, words = TITLE_LEAD_WORDS) {
	const cleaned = stripPunctuation(title);
	if (!cleaned) return "";
	return cleaned.split(" ").slice(0, Math.max(1, words)).join(" ");
}

/** bundle.naming（Agent 提供）优先，report.naming 作为补充；bundle 已固化的值更高。 */
function namingOf(bundle, report) {
	return { ...(report?.naming ?? {}), ...(bundle?.naming ?? {}) };
}

/** 期刊缩写：naming.journalAbbrev → 内置缩写表 → 清洗后的原刊名。 */
export function journalAbbrevOf(bundle, naming = namingOf(bundle)) {
	const explicit = stripPunctuation(naming.journalAbbrev);
	if (explicit) return explicit;
	const journal = String(bundle?.journal ?? "").trim();
	if (!journal) return "";
	const key = journal.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
	return JOURNAL_ABBREVIATIONS[key] ?? stripPunctuation(journal);
}

/**
 * 通讯作者：naming.correspondingAuthor → 末位作者 → 第一位作者。
 *
 * Crossref/OpenAlex 都不直接标注通讯作者，末位作者只是**启发式**；Agent 应从 PDF
 * 首页脚注/星标确认后显式传入，不要把这个默认值当权威。
 */
export function correspondingAuthorOf(bundle, naming = namingOf(bundle)) {
	const explicit = stripPunctuation(naming.correspondingAuthor);
	if (explicit) return explicit;
	const authors = Array.isArray(bundle?.authors) ? bundle.authors.filter((author) => String(author ?? "").trim()) : [];
	return stripPunctuation(authors.at(-1) ?? authors[0] ?? "");
}

/**
 * 中文内容概括：naming.summaryZh → report.titleZh 的前 10 字 → 空。
 *
 * **不回退到英文标题**：幻灯片要求这一段是「两三中文词语精炼概括」，把英文题目前
 * 10 个字符塞进来只会与后面的题目前段重复。
 */
export function summaryZhOf(bundle, report, naming = namingOf(bundle, report)) {
	const explicit = stripPunctuation(naming.summaryZh);
	if (explicit) return explicit;
	const titleZh = stripPunctuation(report?.titleZh);
	if (titleZh) return Array.from(titleZh).slice(0, SHORT_INTRO_MAX).join("");
	return "";
}

/**
 * 命名的五段（已去标点、已丢空段）。`titleWords` 允许调用方收窄题目前段。
 * 导出给需要「缺哪些字段」诊断的调用方（例如 lab_tasks_get_reading_inputs）。
 */
export function entryStemParts(bundle, report, { titleWords = TITLE_LEAD_WORDS } = {}) {
	const naming = namingOf(bundle, report);
	const explicitTitleLead = stripPunctuation(naming.titleLead);
	return [
		journalAbbrevOf(bundle, naming),
		Number.isFinite(bundle?.year) ? String(bundle.year) : "",
		correspondingAuthorOf(bundle, naming),
		summaryZhOf(bundle, report, naming),
		explicitTitleLead || titleLeadOf(report?.title ?? bundle?.title, titleWords)
	]
		.map((part) => stripPunctuation(part))
		.filter(Boolean);
}

/**
 * 构造稳定条目标识。超长时**只**从最后一段（题目前段）截断，前面的期刊/年份/作者/
 * 中文概括保持完整——它们才是分类检索时真正要读的部分。
 */
export function buildEntryStem(bundle, report) {
	const parts = entryStemParts(bundle, report);
	if (parts.length === 0) return sanitizeEntryStem(bundle?.id ?? "literature");
	if (parts.length === 1) return sanitizeEntryStem(parts[0]);
	const head = parts.slice(0, -1).join(" ");
	const tail = parts.at(-1);
	const room = ENTRY_STEM_MAX - head.length - 1;
	const stem = sanitizeEntryStem(room > 0 ? `${head} ${tail.slice(0, room)}` : head);
	return stem || sanitizeEntryStem(bundle?.id ?? "literature");
}

/** 缺失的命名段（供工具回显，Agent 据此补全）。 */
export function missingEntryNamingFields(bundle, report) {
	const naming = namingOf(bundle, report);
	const missing = [];
	if (!stripPunctuation(naming.journalAbbrev) && !String(bundle?.journal ?? "").trim()) missing.push("journalAbbrev");
	if (!Number.isFinite(bundle?.year)) missing.push("year");
	if (!stripPunctuation(naming.correspondingAuthor) && !(bundle?.authors ?? []).length) missing.push("correspondingAuthor");
	if (!stripPunctuation(naming.summaryZh) && !stripPunctuation(report?.titleZh)) missing.push("summaryZh");
	if (!stripPunctuation(naming.titleLead) && !String(report?.title ?? bundle?.title ?? "").trim()) missing.push("titleLead");
	return missing;
}

/** SI 文件名用的 stem：超过 SI_STEM_MAX 时从尾部逐词缩短。 */
export function siStemOf(entryStem) {
	const stem = sanitizeEntryStem(entryStem);
	if (stem.length <= SI_STEM_MAX) return stem;
	const words = stem.split(" ");
	while (words.length > 1 && words.join(" ").length > SI_STEM_MAX) words.pop();
	return sanitizeEntryStem(words.join(" "));
}

/** 由课题工作区与 bundle/report 推导条目目录；bundle 已固化 entryStem/entryDir 时直接复用。 */
export function literatureEntryLayout(workspacePath, bundle, report) {
	const entryStem = bundle?.entryStem ?? buildEntryStem(bundle, report);
	return {
		entryStem,
		entryDir: bundle?.entryDir ?? join(workspacePath, ENTRY_DIR_NAME, entryStem)
	};
}

/**
 * 条目目录内的产物文件名。
 *
 * 正文按幻灯片不带到类型后缀（文件名就是 stem）；SI 加 ` SI`；精读报告与 PPT 保留
 * 类型后缀以便区分。SI 可保留出版社提供的 pdf/docx/zip 扩展名。
 */
export function entryFileName(entryStem, kind, siExtension) {
	const stem = kind === "si" ? siStemOf(entryStem) : sanitizeEntryStem(entryStem);
	const label = {
		pdf: "",
		si: " SI",
		"report-md": " 精读报告",
		"report-docx": " 精读报告",
		"report-contract": " 精读生成契约",
		ppt: " 文献汇报",
		"ppt-contract": " PPT生成契约",
		"ppt-conformance": " PPT符合性"
	}[kind] ?? ` ${kind}`;
	const ext = {
		pdf: "pdf",
		si: ["pdf", "docx", "zip"].includes(String(siExtension || "").toLowerCase()) ? String(siExtension).toLowerCase() : "pdf",
		"report-md": "md",
		"report-docx": "docx",
		"report-contract": "md",
		ppt: "pptx",
		"ppt-contract": "md",
		"ppt-conformance": "json"
	}[kind] ?? "bin";
	return `${stem}${label}.${ext}`;
}
