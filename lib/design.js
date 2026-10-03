import { Service } from "@deepseek-ai/cordis";

/** Design composes only its own registries, core and runtime. */
export class IbmDesignService extends Service {
 static inject = ["ibmCore", "ibmRuntime", "labSynthesis", "labChemistry", "labExperimentPlanTemplates"];
 constructor(ctx) { super(ctx, "ibmDesign"); }
 listTargets() { return this.ctx.labSynthesis.listTargets(); }
 createTarget(input) { return this.ctx.labSynthesis.createTarget(input); }
}
export default IbmDesignService;
