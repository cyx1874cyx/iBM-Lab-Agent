import { test } from "node:test";
import assert from "node:assert/strict";
import * as tasks from "../../lib/tasks/index.js";

/**
 * 冻结期望值：拆分前 lib/tasks.js 的对外导出面与原型自有方法名集合。
 * 生成方式（拆分前的 release-0.5.0 工作区）：
 *   node -e "import(\x27./lib/tasks.js\x27).then(m=>console.log(JSON.stringify(Object.keys(m).sort())))"
 *   node -e "import(\x27./lib/tasks.js\x27).then(m=>console.log(JSON.stringify(Object.getOwnPropertyNames(m.LabTasksService.prototype).sort())))"
 * 拆分后 lib/tasks/index.js 必须与这两份列表逐项相同；本用例是纯搬家不改接口的守门人。
 */
const EXPECTED_EXPORTS = [
	"KIND_TO_SKILL",
	"LabTasksService",
	"default",
	"extractWechatArticlePage",
	"labTasksDomainSpec",
	"mergeSessionSearchRows",
	"normalizeJournalShortCitation",
	"normalizeWechatArticleUrl",
	"publicSearchPaperId",
	"searchPaperAliases",
	"searchPaperMatches"
];

const EXPECTED_PROTO_METHODS = [
	"assertApprovedArtifact",
	"bindProjectSession",
	"bindProjectWorkspace",
	"bundleFile",
	"completePresentation",
	"completeReadingReport",
	"constructor",
	"createPresentation",
	"createProject",
	"createReadingReport",
	"deleteProject",
	"deleteReadingReport",
	"deleteSearchRun",
	"deriveCardSummary",
	"ensureBundleEntryLayout",
	"ensureProjectWorkspace",
	"exportSearchCitations",
	"fetchWechatArticle",
	"getBundle",
	"getPresentationRun",
	"getProject",
	"getProjectByCwd",
	"getProjectBySession",
	"getProjectByWorkspace",
	"getProjectMemory",
	"getProjectSession",
	"getReadingReport",
	"getSearchRun",
	"intakePaperMetadata",
	"listBundles",
	"listPresentationRuns",
	"listPresentationsForReport",
	"listProjectMemoryVersions",
	"listProjects",
	"listProvenance",
	"listReadingReports",
	"listSearchRuns",
	"machineReviewDetails",
	"materializeReadingDocx",
	"migrateLegacyReviewGates",
	"migrateLegacySessionBindings",
	"preparePaper",
	"presentationDownload",
	"presentationFile",
	"readingReportDownload",
	"readingReportFile",
	"readingReportInputs",
	"readingReportOverview",
	"recordProvenance",
	"registerCapturedFile",
	"registerPaperMeta",
	"registerWechatPaper",
	"requireProject",
	"resolveWechatPaperDoi",
	"resumePendingMachineReviews",
	"reviewPresentation",
	"reviewReadingReport",
	"searchLiterature",
	"searchRunRis",
	"selectReadingReportTemplate",
	"stageArtifactIntoEntry",
	"stageFileIntoEntry",
	"table",
	"transit",
	"updateProjectMemory",
	"updateSearchSummaries",
	"validatePresentation",
	"validateReadingReport",
	"writeProjectMemoryFile"
];

test("lib/tasks/index.js 的导出键集合与拆分前逐项一致", () => {
	assert.deepEqual(Object.keys(tasks).sort(), EXPECTED_EXPORTS);
});

test("LabTasksService.prototype 自有属性名集合与拆分前逐项一致", () => {
	assert.deepEqual(Object.getOwnPropertyNames(tasks.LabTasksService.prototype).sort(), EXPECTED_PROTO_METHODS);
});
