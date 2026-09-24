import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/configure-default-preset.mjs", import.meta.url));

function run(root) {
	return spawnSync(process.execPath, [script, "--dsh-home", root], { encoding: "utf8" });
}

const patchPath = (root) => join(root, "profiles", "ibm-lab", "cordis.patch.yml");

test("default-preset configurator writes the registry override into the profile patch", async () => {
	const root = await mkdtemp(join(tmpdir(), "ibm-lab-default-preset-"));
	try {
		const result = run(root);
		assert.equal(result.status, 0, result.stderr);
		const source = await readFile(patchPath(root), "utf8");
		// DSH 0.1.7 的默认 preset 来自 agent-preset-registry 行的 config.default，
		// settings.yaml 的 agent-presets 段已被上游删除，写了也会被改名丢弃。
		assert.match(source, /^- id: agent-preset-registry$/m);
		assert.match(source, /^ {4}default: lab-research$/m);
		// 幂等：第二次运行不重写文件。
		const second = run(root);
		assert.equal(second.status, 0, second.stderr);
		assert.match(second.stdout, /already configured/);
		assert.equal(await readFile(patchPath(root), "utf8"), source);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("default-preset configurator preserves unrelated profile patch rows and !!js", async () => {
	const root = await mkdtemp(join(tmpdir(), "ibm-lab-default-preset-"));
	try {
		await mkdir(join(root, "profiles", "ibm-lab"), { recursive: true });
		await writeFile(
			patchPath(root),
			[
				"# user edit saved by the Web preset editor",
				"- id: preset-lab-research",
				"  name: '@deepseek-ai/dsh-agent-preset'",
				"  config:",
				"    id: lab-research",
				"    plugins:",
				"      - id: persona",
				"        name: '@deepseek-ai/dsh-persona'",
				"- id: agent-preset-registry",
				"  name: '@deepseek-ai/dsh-agent-preset-registry'",
				"  config:",
				"    default: standard",
				"    modeSelectionEnabled: false",
				"- id: tool-web",
				"  disabled: !!js process.platform === 'win32'",
				""
			].join("\n"),
			"utf8"
		);
		const result = run(root);
		assert.equal(result.status, 0, result.stderr);
		const source = await readFile(patchPath(root), "utf8");
		assert.match(source, /# user edit saved by the Web preset editor/);
		assert.match(source, /- id: preset-lab-research/);
		assert.match(source, /name: '@deepseek-ai\/dsh-persona'/);
		// 同一行内的其它字段必须原样保留（DSH 的 override 是整块替换 config）。
		assert.match(source, /^ {4}modeSelectionEnabled: false$/m);
		assert.match(source, /disabled: !!js process\.platform === 'win32'/);
		assert.match(source, /^ {4}default: lab-research$/m);
		assert.doesNotMatch(source, /default: standard/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
