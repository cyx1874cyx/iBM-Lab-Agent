import { Service } from "@deepseek-ai/cordis";

/** Analysis accepts task inputs/chemical snapshots and never requires design or literature. */
export class IbmAnalysisService extends Service {
 static inject = ["ibmCore", "ibmRuntime", "labNmr", "labPlotRecords", "labCharacterization"];
 constructor(ctx) { super(ctx, "ibmAnalysis"); }
 list(projectId) { return this.ctx.labCharacterization.list(projectId); }
 submit(input) { return this.ctx.labCharacterization.submit(input); }
}
export default IbmAnalysisService;
