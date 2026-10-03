/** Read live providers on every request; no platform/environment guesses. */
export function featureSnapshot(ctx) {
 const has = (...names) => names.every(name => ctx.get(name) !== undefined);
 return {
  version: 1,
  core: has("ibmCore"),
  runtime: has("ibmRuntime"),
  documents: has("ibmDocuments", "labNoteTemplates", "labTemplates"),
  literature: has("ibmLiteratureWorkflows", "labGoals"),
  design: has("ibmDesign", "labChemistry", "labSynthesis"),
  analysis: has("ibmAnalysis", "labNmr", "labCharacterization"),
  experimentTemplates: has("labExperimentPlanTemplates"),
  scientificDesktop: has("ibmScientificDesktop") && Boolean(ctx.get("ibmScientificDesktop").status().available)
 };
}
