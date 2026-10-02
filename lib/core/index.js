import { Service } from "@deepseek-ai/cordis";
import { join } from "node:path";
import { labAgentRoot, resolveDshHome } from "../../src/paths.js";
import { PROJECT_MEMORY_FILE } from "../../src/contracts/index.js";
import { labTasksDomainSpec } from "./domain.js";
import { createRepositories } from "../repositories/index.js";
import { projectsMethods } from "./projects.js";
import { artifactMethods } from "./artifacts.js";

/** The sole owner of lab_tasks. No scientific service is a startup dependency. */
export class IbmCoreService extends Service {
 static inject = ["storageDomain"];
 static PROJECT_MEMORY_FILE = PROJECT_MEMORY_FILE;
 constructor(ctx, config = {}) {
  super(ctx, "ibmCore");
  this.projectsRoot = config.projectsRoot ?? join(labAgentRoot(resolveDshHome()), "projects");
  this.researchPreset = config.researchPreset ?? "lab-research";
 }
 async [Service.init]() {
  const domain = await this.ctx.storageDomain.open(labTasksDomainSpec);
  let active = true;
  this.repositories = createRepositories(() => {
   if (!active) throw new Error("ibmCore repository is disposed");
   return domain;
  });
  this.ctx.effect(() => () => { active = false; return domain.close(); }, "ibm-core.domainClose");
  await this.migrateLegacySessionBindings();
 }
 table(name) { return this.repositories.table(name); }
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
Object.assign(IbmCoreService.prototype, projectsMethods, artifactMethods);
export { labTasksDomainSpec } from "./domain.js";
export default IbmCoreService;
