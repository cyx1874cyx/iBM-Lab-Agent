import { Service } from "@deepseek-ai/cordis";
import { join } from "node:path";
import { labAgentRoot, resolveDshHome } from "../../src/paths.js";
import { PROJECT_MEMORY_FILE } from "../../src/contracts/index.js";
import { labTasksDomainSpec } from "./domain.js";
import { createRepositories } from "../repositories/index.js";
import { projectsMethods } from "./projects.js";
import { artifactMethods } from "./artifacts.js";
import { historyFileMethods } from "./history-files.js";
import { TaskActivity, activitySnapshot } from "../../src/runtime/task-activity.js";

/** The sole owner of lab_tasks. No scientific service is a startup dependency. */
export class IbmCoreService extends Service {
 static inject = ["storageDomain"];
 static PROJECT_MEMORY_FILE = PROJECT_MEMORY_FILE;
 constructor(ctx, config = {}) {
  super(ctx, "ibmCore");
  this.projectsRoot = config.projectsRoot ?? join(labAgentRoot(resolveDshHome()), "projects");
  this.researchPreset = config.researchPreset ?? "lab-research";
  this.sourceListeners = new Set();
  this.activity = new TaskActivity();
 }
 async [Service.init]() {
  const domain = await this.ctx.storageDomain.open(labTasksDomainSpec);
  let active = true;
  this.repositories = createRepositories(() => {
   if (!active) throw new Error("ibmCore repository is disposed");
   return domain;
  });
  this.ctx.effect(() => () => { active = false; this.sourceListeners.clear(); return domain.close(); }, "ibm-core.domainClose");
  await this.migrateLegacySessionBindings();
  this.ctx.on("tools/execute",async(exec,next)=>{
   const row=this.activity.start(exec);
   try{return await next();}
   catch(error){this.activity.finish(row?.id,{isError:true},exec.signal?.aborted);throw error;}
  });
  this.ctx.on("tools/result",(exec,result)=>{const id='tool:'+exec.callId;if(this.activity.rows.has(id))this.activity.finish(id,result,exec.signal?.aborted);});
 }
 table(name) { return this.repositories.table(name); }
 taskActivity() { return activitySnapshot(this,this.ctx); }
 requireProject(id) {
  const project = this.table("projects").get(id);
  if (project === undefined) throw new Error(`project '${id}' not found`);
  return project;
 }
	async migrateLegacySessionBindings() {
		const table = this.table("sessions");
		for (const key of table.keys()) {
			const row = table.get(key);
			if (row.sessionId !== undefined && !(row.sessionIds ?? []).includes(row.sessionId)) {
				await table.put(key, {
					...row,
					projectId: row.projectId,
					workspaceId: row.workspaceId,
					sessionIds: [...(row.sessionIds ?? []), row.sessionId],
					createdAt: row.createdAt ?? new Date().toISOString()
				});
			}
		}
	}

}
Object.assign(IbmCoreService.prototype, projectsMethods, artifactMethods, historyFileMethods);
export { labTasksDomainSpec } from "./domain.js";
export default IbmCoreService;
