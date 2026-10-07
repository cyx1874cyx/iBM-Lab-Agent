import { Service } from "@deepseek-ai/cordis";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { projectsMethods } from "./projects.js";
import { literatureMethods } from "./literature.js";
import { wechatMethods } from "./wechat.js";
import { readingReportsMethods } from "./reading-reports.js";
import { presentationsMethods } from "./presentations.js";
import { provenanceMethods } from "./provenance.js";
import { stagingMethods } from "./staging.js";
import { entryAdminMethods } from "./entry-admin.js";
import { reviewMethods } from "./reviews.js";
import {organizationMethods} from './organization.js';


export { labTasksDomainSpec } from "../core/domain.js";

export { KIND_TO_SKILL } from "./provenance.js";
export { extractWechatArticlePage } from "./wechat.js";
export { mergeSessionSearchRows } from "./literature.js";
export { normalizeJournalShortCitation } from "./shared.js";
export { normalizeWechatArticleUrl } from "./wechat.js";
export { publicSearchPaperId } from "./literature.js";
export { searchPaperAliases } from "./literature.js";
export { searchPaperMatches } from "./literature.js";


function workflow(service) {
 const provider = service.ctx.get("ibmLiteratureWorkflows");
 if (!provider) throw new RemoteError("feature-unavailable", "Literature workflows are stopped", { service: "ibmLiteratureWorkflows" });
 return provider;
}
export class LabTasksService extends Service {
 static inject = ["ibmCore"];
 static PROJECT_MEMORY_FILE = "项目记忆.md";
 constructor(ctx, config = {}) {
  super(ctx, "labTasks"); this.config = config;
  this.projectsRoot = ctx.ibmCore.projectsRoot;
  this.researchPreset = config.researchPreset ?? ctx.ibmCore.researchPreset;
  Object.defineProperty(this, "executor", { configurable: true, get: () => workflow(this).executor, set: value => { workflow(this).executor = value; } });
 }
 async [Service.init]() { this.tables = this.ctx.ibmCore.repositories.scope("legacy-tasks"); }
}
LabTasksService.prototype.migrateLegacyReviewGates = function (...args) { return workflow(this).migrateLegacyReviewGates(...args); };
LabTasksService.prototype.resumePendingMachineReviews = function (...args) { return workflow(this).resumePendingMachineReviews(...args); };
LabTasksService.prototype.migrateLegacySessionBindings = function (...args) { return workflow(this).migrateLegacySessionBindings(...args); };
LabTasksService.prototype.table = function (...args) { return workflow(this).table(...args); };
LabTasksService.prototype.requireProject = function (...args) { return workflow(this).requireProject(...args); };
LabTasksService.prototype.transit = function (...args) { return workflow(this).transit(...args); };
LabTasksService.prototype.assertApprovedArtifact = function (...args) { return workflow(this).assertApprovedArtifact(...args); };
LabTasksService.prototype.machineReviewDetails = function (...args) { return workflow(this).machineReviewDetails(...args); };

const operations = { ...literatureMethods, ...wechatMethods, ...readingReportsMethods, ...presentationsMethods, ...provenanceMethods, ...stagingMethods, ...entryAdminMethods, ...reviewMethods,...organizationMethods };
for (const name of Object.keys(operations)) LabTasksService.prototype[name] = function (...args) { return workflow(this)[name](...args); };
Object.assign(LabTasksService.prototype, projectsMethods);
LabTasksService.prototype.table = function (name) { return this.ctx.ibmCore.table(name); };
LabTasksService.prototype.requireProject = function (id) { return this.ctx.ibmCore.requireProject(id); };
LabTasksService.prototype.migrateLegacySessionBindings = function () { return this.ctx.ibmCore.migrateLegacySessionBindings(); };
LabTasksService.prototype.assertApprovedArtifact = function (...args) { return this.ctx.ibmCore.assertApprovedArtifact(...args); };
LabTasksService.prototype.bundleFile = function (...args) { return this.ctx.ibmCore.bundleFile(...args); };
LabTasksService.prototype.listProvenance = function (...args) { return this.ctx.ibmCore.listProvenance(...args); };
// This historical helper has no service state and also supports unbound calls.
LabTasksService.prototype.fetchWechatArticle = wechatMethods.fetchWechatArticle;
for (const name of ["readingReportFile", "readingReportDownload", "listPresentationsForReport", "presentationFile", "presentationDownload", "reviewFile"]) LabTasksService.prototype[name] = function (...args) { return this.ctx.ibmCore[name](...args); };
export default LabTasksService;
