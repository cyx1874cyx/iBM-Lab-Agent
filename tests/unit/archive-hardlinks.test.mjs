import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";

test("offline dependency archives materialize hardlinked package metadata as readable regular files", async () => {
 const root = await mkdtemp(join(tmpdir(), "ibm-archive-hardlinks-"));
 try {
  const source = join(root, "dependency"), target = join(root, "fixture.tgz"); await mkdir(source);
  await writeFile(join(source, "package.json"), '{"name":"fixture","version":"1.0.0"}');
  await mkdir(join(source, "v4")); await mkdir(join(source, "v3"));
  await writeFile(join(source, "v4/package.json"), '{"type":"module"}');
  await link(join(source, "v4/package.json"), join(source, "v3/package.json"));
  execFileSync("python", ["-I", resolve("scripts/migration/pack-installed-dependency.py"), source, target]);
  const result = execFileSync("python", ["-I", "-c", "import sys,tarfile,json\nwith tarfile.open(sys.argv[1]) as a:\n for n in ['package/v3/package.json','package/v4/package.json']:\n  m=a.getmember(n);assert m.isfile() and m.size>0;assert json.load(a.extractfile(m))=={'type':'module'}\n print('ok')", target], { encoding: "utf8" });
  assert.equal(result.trim(), "ok");
 } finally { assert.ok(!relative(resolve(tmpdir()), resolve(root)).startsWith("..")); await rm(root, { recursive: true, force: true }); }
});
