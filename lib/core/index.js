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
import { installModelRecovery } from '../../src/runtime/model-recovery.js';
import { installResearchIdentity } from '../../src/runtime/research-identity.js';
import { ProjectFileStore } from './project-files.js';
import { ProjectConversations } from './project-conversations.js';
import { ProjectUpdates } from './project-updates.js';

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
  this.projectUpdates = new ProjectUpdates();
  this.ctx.effect(() => () => this.projectUpdates.close(), 'ibm-core.projectUpdates');
  this.projectFiles = new ProjectFileStore({ onCommitted: id => this.projectUpdates.publish(id), canSwitch: id => ![...this.activity.rows.values()].some(row => row.projectId === id && ['running', 'queued'].includes(row.status)) });
  const domain = await this.projectFiles.attachDomain(labTasksDomainSpec, await this.ctx.storageDomain.open(labTasksDomainSpec));
  let active = true;
  this.repositories = createRepositories(() => {
   if (!active) throw new Error("ibmCore repository is disposed");
   return domain;
  });
  this.ctx.effect(() => () => { active = false; this.sourceListeners.clear(); return domain.close(); }, "ibm-core.domainClose");
  await this.projectFiles.captureDormant(this.ctx.storageDomain);
  await this.projectFiles.initialize();
  await this.migrateLegacySessionBindings();
  this.conversations = new ProjectConversations(this, this.ctx);
  this.ctx.effect(() => () => this.conversations.close(), 'ibm-core.projectConversations');
  for (const project of this.listProjects()) for (const sessionId of this.getProjectSession(project.id)?.sessionIds ?? []) this.conversations.schedule(project.id, sessionId);
  this.activity.changed=()=>this.ctx.emit('ibm/task-activity');
  installModelRecovery(this.ctx);
  installResearchIdentity(this.ctx);
  this.ctx.on('session/event',(session,event)=>{const result=this.getProjectByCwd(session.header.cwd??'');if(result){this.activity.event(session,event);this.conversations.schedule(result.project.id,session.id);}},{global:true});
  this.ctx.on("tools/execute",async(exec,next)=>{
   const cwd=exec.agent?.session?.header?.cwd;const project=cwd?[...this.table('projects').keys()].map(id=>this.table('projects').get(id)).find(row=>row.workspacePath?.replaceAll('\\','/').toLowerCase()===String(cwd).replaceAll('\\','/').toLowerCase()):null;
   const row=this.activity.start({...exec,projectId:project?.id});
   try{return await next();}
   catch(error){this.activity.finish(row?.id,{isError:true},exec.signal?.aborted);throw error;}
  },{global:true});
  this.ctx.on("tools/result",(exec,result)=>{const id='tool:'+exec.callId;if(this.activity.rows.has(id))this.activity.finish(id,result,exec.signal?.aborted);},{global:true});
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
