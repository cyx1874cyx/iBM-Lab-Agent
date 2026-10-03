/** Independently activated DSH bundles; shared implementation is an exact dependency, not an active bundle. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(root, "bundles/catalog.json"), "utf8"));
const check = process.argv.includes("--check");
const primary = { core: "core", runtime: "runtime", documents: "documents", literature: "workflows", design: "design", analysis: "analysis", ui: "" };
const output = (path, contents) => { if (check) assert.equal(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), contents, path); else { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, contents); } };
for (const domain of [...Object.keys(catalog.domains), "ui"]) {
 const name = `dsh-lab-${domain}`, directory = join(root, "packages", name);
 const spec = catalog.domains[domain];
 let patch = domain === "ui" ? `- insert:\n    - id: lab-client\n      name: '${name}'\n` : readFileSync(join(root, "bundles", `${domain}.patch.yml`), "utf8").replaceAll("\r\n", "\n");
 const subpaths = [...new Set([...patch.matchAll(/name: 'dsh-lab-agent\/([^']+)'/g)].map(match => match[1]))];
 const exports = { ".": "./lib/index.js", "./package.json": "./package.json" };
 output(join(directory, "lib/index.js"), `export { default } from "dsh-lab-agent${primary[domain] ? `/${primary[domain]}` : ""}";\n`);
 for (const subpath of subpaths) {
  exports[`./${subpath}`] = `./lib/${subpath}.js`;
  output(join(directory, `lib/${subpath}.js`), `export { default } from "dsh-lab-agent/${subpath}";\nexport * from "dsh-lab-agent/${subpath}";\n`);
  patch = patch.replaceAll(`'dsh-lab-agent/${subpath}'`, `'${name}/${subpath}'`);
 }
 const manifest = { name, version: pkg.version, private: true, type: "module", main: "./lib/index.js", exports,
  files: ["lib", "cordis.patch.yml"], dependencies: { "dsh-lab-agent": pkg.version },
  peerDependencies: Object.fromEntries((spec?.requires ?? ["core"]).map(dependency => [`dsh-lab-${dependency}`, pkg.version])),
  dsh: { bundle: { patch: ["./cordis.patch.yml"] } } };
 if (domain === "ui") {
  manifest.exports["./client"] = "./client/index.js";
  manifest.files.push("client", "preset.patch.yml");
  manifest.dsh.client = pkg.dsh.client;
  manifest.dsh.bundle.patch.push("./preset.patch.yml");
  output(join(directory, "client/index.js"), readFileSync(join(root, "client/index.js"), "utf8").replaceAll("\r\n", "\n").replace('id: "dsh-lab-agent", factory:', 'id: "dsh-lab-ui", factory:'));
  output(join(directory, "preset.patch.yml"), readFileSync(join(root, "presets/lab-research/preset.patch.yml"), "utf8").replaceAll("\r\n", "\n"));
 }
 output(join(directory, "cordis.patch.yml"), patch);
 output(join(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(`Seven independent bundle packages ${check ? "verified" : "generated"}; never activate the compatibility bundle alongside them.`);
