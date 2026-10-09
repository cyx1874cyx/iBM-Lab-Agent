/** Build current private archives using pinned NEXT's package manager, without installation. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import {withOfficePreviewFactory} from '../dsh-office-preview-factory.mjs';
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const arg = name => { const index = process.argv.indexOf(name); assert.ok(index >= 0, `${name} required`); return resolve(process.argv[index + 1]); };
const next = arg("--next-root"), output = arg("--output"), repo = resolve(".");
const expectedClient=readFileSync(join(repo,'client/index.js'),'utf8').replaceAll('\r\n','\n').replace('id: "dsh-lab-agent", factory:','id: "dsh-lab-ui", factory:');
assert.equal(readFileSync(join(repo,'packages/dsh-lab-ui/client/index.js'),'utf8').replaceAll('\r\n','\n'),expectedClient,'UI domain client is stale; rebuild client and domain packages before packing');
assert.equal(execFileSync("git", ["-C", next, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), "838ba60fd79362087c0a0d134efee671c284786a");
const runtime = join(next, "dsh-desktop-next"), require = createRequire(join(runtime, "package.json"));
const { bundledPnpmEntry, NEXT_PACKAGE } = { ...await import(pathToFileURL(join(runtime, "lib/extensions.js"))), ...await import(pathToFileURL(join(runtime, "lib/profiles.js"))) };
await mkdir(output, { recursive: true });
const packages = [];
const directories = new Map();
function dependencyDirectory(name, parent) {
 const resolver = createRequire(join(parent, "package.json"));
 try { return dirname(resolver.resolve(name + "/package.json")); }
 catch { const directory = resolver.resolve.paths(name).map(root => join(root, name)).find(root => existsSync(join(root, "package.json"))); assert.ok(directory, "Installed dependency missing: " + name); return directory; }
}
function collect(directory) {
 const manifest = JSON.parse(readFileSync(join(directory, "package.json")));
 if (directories.has(manifest.name)) { assert.equal(directories.get(manifest.name).version, manifest.version, "Dependency versions conflict: " + manifest.name); return; }
 directories.set(manifest.name, { directory, version: manifest.version });
 for (const name of Object.keys(manifest.dependencies ?? {})) collect(dependencyDirectory(name, directory));
}
collect(repo);
const rootManifest = JSON.parse(readFileSync(join(repo, "package.json")));
for (const name of Object.keys(rootManifest.peerDependencies)) collect(dependencyDirectory(name, repo));
for (const domain of ["core", "runtime", "documents", "literature", "design", "analysis", "ui"]) directories.set(`dsh-lab-${domain}`, { directory: join(repo, "packages", `dsh-lab-${domain}`), version: rootManifest.version });
// Expose the pinned native renderer as reusable factories without touching NEXT.
const officeName='@deepseek-ai/dsh-client-ui-sidebar-documentpreview';
const officeDirectory=join(output,'native-office');
const officeSource=dependencyDirectory(officeName,runtime);
await cp(officeSource,officeDirectory,{recursive:true,filter:path=>!path.slice(officeSource.length+1).split(/[\\/]/).includes('node_modules')});
const officeClient=join(officeDirectory,'lib/client.js');
await writeFile(officeClient,withOfficePreviewFactory(await readFile(officeClient,'utf8')));
directories.set(officeName,{directory:officeDirectory,version:'0.2.0-rc.2'});
for (const [name, { directory }] of directories) {
 const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
 const path = join(output, `${manifest.name.replaceAll("/", "-").replaceAll("@", "")}-${manifest.version}.tgz`);
 if (!name.startsWith('dsh-lab-')) {
  const pythonIndex=process.argv.indexOf('--python');
  execFileSync(pythonIndex<0?'python':process.argv[pythonIndex+1],['-I',join(repo,'scripts/migration/pack-installed-dependency.py'),directory,path],{windowsHide:true});
 } else {
 const child = spawn(require("electron"), ["--expose-internals", bundledPnpmEntry(NEXT_PACKAGE), "--dir", directory, "pack", "--pack-destination", output], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", npm_config_manage_package_manager_versions: "false" }, stdio: ["ignore", "pipe", "pipe"] });
 let log = ""; child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
 const code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); });
 await writeFile(join(output, `pack-${name.replaceAll("/", "-").replaceAll("@", "")}.log`), log); assert.equal(code, 0, log);
 }
 const bytes = await readFile(path);
 packages.push({ name: manifest.name, version: manifest.version, path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(join(output, "release-archives.json"), JSON.stringify({ ok: true, scope: "Current private archives, not publication or clean installation", packages }, null, 2) + "\n");
console.log(JSON.stringify({ ok: true, packages: packages.length, evidence: join(output, "release-archives.json") }));
