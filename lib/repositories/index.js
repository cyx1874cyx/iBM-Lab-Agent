/** Capability-scoped access to the existing tables. No storage backend or Cordis imports. */
export const TABLE_NAMES = Object.freeze({
 projects: "lab_projects", memories: "project_memory_versions", sessions: "project_sessions",
 searches: "literature_search_runs", bundles: "paper_source_bundles", reports: "reading_reports",
 presentations: "presentation_runs", provenance: "artifact_provenance"
});
const SCOPES = Object.freeze({
 projects: ["projects", "memories", "sessions"],
 literature: ["searches", "bundles", "reports", "presentations", "provenance"],
 documents: ["reports", "presentations", "provenance"],
 "legacy-tasks": Object.keys(TABLE_NAMES)
});

export function createRepositories(activeDomain) {
 const tables = Object.fromEntries(Object.entries(TABLE_NAMES).map(([alias, name]) => [alias, Object.freeze({
  get size() { return activeDomain().table(name).size; },
  get: key => activeDomain().table(name).get(key),
  entries: () => activeDomain().table(name).entries(),
  keys: () => activeDomain().table(name).keys(),
  put: (key, value) => activeDomain().table(name).put(key, value),
  delete: key => activeDomain().table(name).delete(key)
 })]));
 return Object.freeze({
  table(name) {
   if (!Object.hasOwn(tables, name)) throw new Error(`unknown shared repository '${name}'`);
   return tables[name];
  },
  scope(name) {
   if (name === "history") return Object.freeze(Object.fromEntries(Object.entries(tables).map(([alias, table]) =>
    [alias, Object.freeze({ get: table.get, keys: table.keys })])));
   if (!Object.hasOwn(SCOPES, name)) throw new Error(`unknown repository scope '${name}'`);
   return Object.freeze(Object.fromEntries(SCOPES[name].map(alias => [alias, tables[alias]])));
  }
 });
}
