import { deleteSearchTask, importRisTask, publicSourcesTest, listSearchTasks, patchTaskCandidate, readSearchTaskStore, runScopusSearch, saveScopusKey, saveSearchTaskStore, scopusTest, taskRis, runWosSearch, saveWosKey, wosTest, upsertSearchTask } from "./search-tasks.js";

/** Methods mixed into LabRemoteService. Kept in a separate file so the large remote
 *  service does not need another 200-line insertion. */
export const searchTaskRemoteMethods = {
	async search_tasks_list(request) { return listSearchTasks(this.require("ibmCore"), request.projectId); },
	async search_tasks_save(request) { return { task: await upsertSearchTask(this.require("ibmCore"), request.projectId, request.task) }; },
	async search_tasks_delete(request) { return deleteSearchTask(this.require("ibmCore"), request.projectId, request.taskId); },
	async search_tasks_scopus_test(request) { return scopusTest(this.require("ibmCore"), request.projectId); },
	async search_tasks_scopus_search(request) { return runScopusSearch(this.require("ibmCore"), request.projectId, request); },
	async search_tasks_wos_test(request) { return wosTest(this.require("ibmCore"), request.projectId); },
	async search_tasks_wos_search(request) { return runWosSearch(this.require("ibmCore"), request.projectId, request); },
	async search_tasks_save_wos_key(request) { await saveWosKey(this.require("ibmCore"), request.projectId, request.apiKey); return { saved: true }; },
	async search_tasks_import_ris(request) { return importRisTask(this.require("ibmCore"), request.projectId, request); },
	async search_tasks_export_ris(request) {
		const store = await readSearchTaskStore(this.require("ibmCore"), request.projectId);
		const task = store.tasks.find((row) => row.id === request.taskId);
		if (!task) throw new Error("检索任务不存在");
		return { text: taskRis(task, request.candidateIds || []), fileName: `${task.title || "search"}.ris` };
	},
	async search_tasks_patch_candidate(request) { return patchTaskCandidate(this.require("ibmCore"), request.projectId, request); },
	async search_tasks_public_sources_test() { return publicSourcesTest(); },
	async search_tasks_save_key(request) { await saveScopusKey(this.require("ibmCore"), request.projectId, request.apiKey); return { saved: true }; },
	async search_tasks_add_to_reading(request) {
		const core = this.require("ibmCore");
		const lab = this.require("labTasks");
		const store = await readSearchTaskStore(core, request.projectId);
		const task = store.tasks.find((row) => row.id === request.taskId);
		if (!task) throw new Error("检索任务不存在");
		const wanted = new Set(request.candidateIds || []);
		const results = [];
		for (const paper of (task.candidates || []).filter((row) => wanted.has(row.id))) {
			try {
				const intake = await lab.intakePaperMetadata(request.projectId, {
					sourceType: paper.source === "scopus" ? "publisher" : "manual",
					sourceUrl: paper.sourceUrl, title: paper.title, authors: paper.authors, doi: paper.doi,
					journal: paper.journal, year: paper.year, volume: paper.volume, issue: paper.issue, pages: paper.pages,
					abstract: paper.abstract,
					shortCitation: [paper.journal, paper.volume, paper.pages, paper.year ? `(${paper.year})` : ""].filter(Boolean).join(" "),
					summary: paper.abstract
				}, "search-task");
				paper.addedToReading = true;
				paper.bundleId = intake.bundle?.id;
				paper.reportId = intake.report?.id;
				results.push({ candidateId: paper.id, ok: true, bundleId: intake.bundle?.id, reportId: intake.report?.id });
			} catch (error) {
				results.push({ candidateId: paper.id, ok: false, error: error.message });
			}
		}
		await saveSearchTaskStore(core, request.projectId, store);
		return { results, succeeded: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length };
	}
};
