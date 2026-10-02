import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { labProjectSchema } from "../../src/contracts/index.js";

/** Historical API: resolve scientific snapshots here, delegate foundation operations to core. */
export const projectsMethods = {
 async createProject(fields) {
  if (this.ctx.ibmCore.getProject(fields.id) !== undefined) throw new Error(`project '${fields.id}' already exists`);
  const goals = this.ctx.get("labGoals");
  const templates = this.ctx.get("labTemplates");
  if (!goals || !templates) throw new RemoteError("feature-unavailable", "Project scientific profiles are unavailable", { feature: "project-profiles" });
  const goal = await goals.snapshotForTask(fields.goalProfileId, fields.goalProfileVersion);
  const template = await templates.resolve(fields.templateId, fields.templateVersion);
  if (template === undefined) throw new Error(`template '${fields.templateId}'@${fields.templateVersion} not found`);
  const refs = { goalProfile: { id: goal.id, version: goal.version, snapshot: goal }, template: { id: template.id, version: template.version, snapshot: template } };
  // Retain the strict shape of the existing create API; core-only callers may omit scientific profiles.
  labProjectSchema.parse({ ...fields, ...refs, createdAt: "", updatedAt: "" });
  return this.ctx.ibmCore.createProject({ ...fields, ...refs });
 },
	listProjects(...args) { return this.ctx.ibmCore.listProjects(...args); },
	deleteProject(...args) { return this.ctx.ibmCore.deleteProject(...args); },
	ensureProjectWorkspace(...args) { return this.ctx.ibmCore.ensureProjectWorkspace(...args); },
	writeProjectMemoryFile(...args) { return this.ctx.ibmCore.writeProjectMemoryFile(...args); },
	bindProjectWorkspace(...args) { return this.ctx.ibmCore.bindProjectWorkspace(...args); },
	bindProjectSession(...args) { return this.ctx.ibmCore.bindProjectSession(...args); },
	getProjectSession(...args) { return this.ctx.ibmCore.getProjectSession(...args); },
	getProjectBySession(...args) { return this.ctx.ibmCore.getProjectBySession(...args); },
	getProjectByWorkspace(...args) { return this.ctx.ibmCore.getProjectByWorkspace(...args); },
	getProjectByCwd(...args) { return this.ctx.ibmCore.getProjectByCwd(...args); },
	getProjectMemory(...args) { return this.ctx.ibmCore.getProjectMemory(...args); },
	listProjectMemoryVersions(...args) { return this.ctx.ibmCore.listProjectMemoryVersions(...args); },
	updateProjectMemory(...args) { return this.ctx.ibmCore.updateProjectMemory(...args); },
	getProject(...args) { return this.ctx.ibmCore.getProject(...args); }
};
