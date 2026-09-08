import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("release metadata and Linux installer describe the current version", async () => {
	const [packageJson, desktopPackageJson, tauriJson, manifestJson, cargoToml, versionsEnv, installer, readme] =
		await Promise.all([
			read("package.json"),
			read("desktop/package.json"),
			read("desktop/src-tauri/tauri.conf.json"),
			read("desktop/docs/release-manifest.json"),
			read("desktop/src-tauri/Cargo.toml"),
			read("runtime/versions.env"),
			read("install.sh"),
			read("README.md"),
		]);

	const expected = JSON.parse(packageJson).version;
	assert.equal(JSON.parse(desktopPackageJson).version, expected);
	assert.equal(JSON.parse(tauriJson).version, expected);
	assert.equal(JSON.parse(manifestJson).ibmLabAgent, expected);
	assert.match(cargoToml, new RegExp(`^version = "${expected.replaceAll(".", "\\.")}"$`, "m"));
	assert.match(versionsEnv, new RegExp(`^IBM_LAB_AGENT_VERSION=${expected.replaceAll(".", "\\.")}$`, "m"));
	assert.match(installer, /source_ref="\$\{IBM_LAB_AGENT_REF:-main\}"/);
	assert.match(installer, /--ref <git-ref>\s+GitLab branch\/tag\/commit \(default: main\)/);
	assert.match(readme, new RegExp(`当前稳定版本为 \\*\\*v${expected.replaceAll(".", "\\.")}\\*\\*`));
});
