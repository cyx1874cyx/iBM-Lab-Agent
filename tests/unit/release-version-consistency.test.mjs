import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("release metadata and Linux installer describe the current version", async () => {
	const [packageJson, desktopPackageJson, tauriJson, manifestJson, cargoToml, cargoLock, versionsEnv, installer, readme] =
		await Promise.all([
			read("package.json"),
			read("desktop/package.json"),
			read("desktop/src-tauri/tauri.conf.json"),
			read("desktop/docs/release-manifest.json"),
			read("desktop/src-tauri/Cargo.toml"),
			read("desktop/src-tauri/Cargo.lock"),
			read("runtime/versions.env"),
			read("install.sh"),
			read("README.md"),
		]);

	const expected = JSON.parse(packageJson).version;
	assert.equal(JSON.parse(desktopPackageJson).version, expected);
	assert.equal(JSON.parse(tauriJson).version, expected);
	assert.equal(JSON.parse(manifestJson).ibmLabAgent, expected);
	assert.match(cargoToml, new RegExp(`^version = "${expected.replaceAll(".", "\\.")}"$`, "m"));
	// Cargo.lock 同样带着本包版本，而且 cargo 会在构建时就地改写它。漏改的后果不是少个字段，
	// 而是下一次发布构建因为「工作树脏」被闸门拒绝（2026-09-22 实际踩过）。
	assert.match(
		cargoLock,
		new RegExp(`^name = "ibm-lab-desktop"\\nversion = "${expected.replaceAll(".", "\\.")}"$`, "m"),
		"Cargo.lock 的包版本必须与 package.json 一致",
	);
	assert.match(versionsEnv, new RegExp(`^IBM_LAB_AGENT_VERSION=${expected.replaceAll(".", "\\.")}$`, "m"));
	assert.match(installer, /source_ref="\$\{IBM_LAB_AGENT_REF:-main\}"/);
	assert.match(installer, /--ref <git-ref>\s+GitLab branch\/tag\/commit \(default: main\)/);
	const releaseLabel = expected.includes("-") ? "当前候选版本" : "当前稳定版本";
	assert.match(readme, new RegExp(`${releaseLabel}为 \\*\\*v${expected.replaceAll(".", "\\.")}\\*\\*`));
});
