import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	resolveDshHome,
	natureSkillsDir,
	natureSkillsRoot,
	vendorLockPath,
	requirementsLockPath,
	venvDir,
	venvPython
} from "../../src/paths.js";

test("resolveDshHome honors DSH_HOME and falls back to ~/.dsh", () => {
	assert.equal(resolveDshHome({ DSH_HOME: "/custom/home" }), "/custom/home");
	assert.equal(resolveDshHome({}), join(homedir(), ".dsh"));
});

test("layout paths hang off the lab-agent root", () => {
	const dsh = "/x";
	assert.equal(natureSkillsDir(dsh), join(dsh, "lab-agent", "vendor", "nature-skills"));
	assert.equal(natureSkillsRoot(dsh), join(dsh, "lab-agent", "vendor", "nature-skills", "skills"));
	assert.equal(vendorLockPath(dsh), join(dsh, "lab-agent", "vendor.lock.json"));
	assert.equal(requirementsLockPath(dsh), join(dsh, "lab-agent", "requirements.lock"));
	assert.equal(venvDir(dsh), join(dsh, "lab-agent", ".venv"));
});

test("venvPython resolves the platform interpreter inside the venv", () => {
	assert.match(venvPython("/v", "win32"), /Scripts[\\/]python\.exe$/);
	assert.match(venvPython("/v", "linux"), /bin[\\/]python$/);
});
