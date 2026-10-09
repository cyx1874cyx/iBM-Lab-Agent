import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Windows installer rejects a stale Mnova module before staging the payload", { skip: process.platform !== "win32" }, () => {
 const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, "mnova-resource-"));
 try {
  const python = join(root, "python"), installed = join(python, "Lib/site-packages/mnova_mcp"), output = join(root, "output");
  mkdirSync(installed, { recursive: true });
  cpSync(fileURLToPath(new URL("../../vendor/mnova-mcp/src/mnova_mcp", import.meta.url)), installed, { recursive: true });
  writeFileSync(join(installed, "runner.py"), "# Cached pre-fix module\nimport subprocess\n");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/migration/build-windows-installer.mjs", import.meta.url)), "--next-root", root, "--python-resource", python, "--archives", root, "--output", output], { encoding: "utf8", windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Bundled Mnova MCP is stale: runner\.py/);
  assert.equal(existsSync(output), false);
 } finally {
  const target = resolve(root);
  assert.equal(dirname(target), parent);
  assert.ok(basename(target).startsWith("mnova-resource-"));
  rmSync(target, { recursive: true, force: true });
 }
});
