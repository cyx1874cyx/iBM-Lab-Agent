import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../..", import.meta.url));
const source = readFileSync(join(root, "cordis.patch.yml"), "utf8");
const matches = [...source.matchAll(/^    - id: ([\w-]+)$/gm)];
const rows = new Map(matches.map((match, index) => [match[1], source.slice(match.index, matches[index + 1]?.index ?? source.length).trimEnd()]));
const composition = {
 core: { requires: [], ids: ["ibm-core", "lab-tasks", "lab-artifact-download", "lab-remote"], tools: ["memory-tool"] },
 runtime: { requires: ["core"], ids: ["ibm-runtime", "ibm-scientific-desktop", "ibm-runtime-remote", "lab-version-registry", "lab-python-env", "lab-llm-diag", "lab-skill-filesystem", "lab-publisher-skill-filesystem", "lab-mnova-skill-filesystem"], tools: ["runtime-tool"] },
 documents: { requires: ["core", "runtime"], ids: ["ibm-documents", "ibm-documents-remote", "lab-note-templates", "lab-ppt-templates", "lab-convert", "lab-pdf-viewer-assets"], tools: ["templates-tool", "convert-tool"] },
 literature: { requires: ["core", "runtime", "documents"], ids: ["ibm-literature-workflows", "ibm-literature-remote", "lab-goal-profiles", "lab-literature-sources", "lab-capture", "lab-capture-handoff"], tools: ["tasks-tool", "ppt-build-tool"] },
 design: { requires: ["core", "runtime"], ids: ["ibm-design", "ibm-design-remote", "lab-chemistry", "lab-synthesis", "lab-experiment-plan-templates", "lab-ketcher-assets", "lab-evidence-shot", "lab-user-action"], tools: ["synthesis-tool"] },
 analysis: { requires: ["core", "runtime"], ids: ["ibm-analysis", "ibm-analysis-remote", "lab-nmr", "lab-plot-records", "lab-characterization"], tools: ["characterization-tool"] }
};
const directory = join(root, "bundles"); mkdirSync(directory, { recursive: true });
const check = process.argv.includes("--check");
for (const [domain, spec] of Object.entries(composition)) {
 const text = `# Generated from the full compatibility composition; run compose-domain-bundles.mjs.\n# Domain: ${domain}; required compositions: ${spec.requires.join(", ") || "DSH storage"}.\n- insert:\n` + spec.ids.map(id => { assert.ok(rows.has(id), id); return rows.get(id); }).join("\n") + "\n";
 const path = join(directory, `${domain}.patch.yml`);
 if (check) assert.equal(readFileSync(path, "utf8"), text, `${domain} composition drift`);
 else writeFileSync(path, text);
}
const catalog = JSON.stringify({ version: 1, defaultComposition: Object.keys(composition), independentPackages: "P5", domains: composition }, null, 2) + "\n";
if (check) assert.equal(readFileSync(join(directory, "catalog.json"), "utf8"), catalog);
else writeFileSync(join(directory, "catalog.json"), catalog);
console.log(`Domain compositions ${check ? "verified" : "generated"}: ${Object.keys(composition).join(", ")}`);
