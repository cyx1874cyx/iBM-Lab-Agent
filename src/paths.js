/**
 * dsh-lab-agent: deployment path layout.
 *
 * Pure Node module (no Cordis / harness imports) so the install script and
 * tests can use it standalone. The runtime layout mirrors the loader
 * expression `dshHomePath('lab-agent/...')` used in cordis.patch.yml:
 *
 *   $DSH_HOME (default ~/.dsh)
 *   └── lab-agent/
 *       ├── vendor/
 *       │   └── nature-skills/   materialized pinned third-party tree
 *       ├── vendor.lock.json     pinned nature-skills commit + skill versions
 *       ├── requirements.lock    pinned python deps (copied from python/)
 *       └── .venv/               python virtualenv for nature skill scripts
 *
 * `resolveDshHome` deliberately mirrors @deepseek-ai/dsh-home-paths without
 * importing it, so this module works from any directory (repo checkout,
 * profile node_modules, installer).
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve $DSH_HOME the same way the harness does: env var, else ~/.dsh. */
export function resolveDshHome(env = process.env) {
	return env.DSH_HOME || join(homedir(), ".dsh");
}

/** Root of all lab-agent deployment data under the DSH home. */
export function labAgentRoot(dshHome = resolveDshHome()) {
	return join(dshHome, "lab-agent");
}

/** Vendored nature-skills tree (the skill root its `skills/` child holds). */
export function natureSkillsDir(dshHome = resolveDshHome()) {
	return join(labAgentRoot(dshHome), "vendor", "nature-skills");
}

/** Skill root handed to the dsh-skill-filesystem provider (customSkillDirs). */
export function natureSkillsRoot(dshHome = resolveDshHome()) {
	return join(natureSkillsDir(dshHome), "skills");
}

/** Pinned lock describing the vendored nature-skills commit and skill versions. */
export function vendorLockPath(dshHome = resolveDshHome()) {
	return join(labAgentRoot(dshHome), "vendor.lock.json");
}

/** Pinned python dependency lock copied from the repo's python/ directory. */
export function requirementsLockPath(dshHome = resolveDshHome()) {
	return join(labAgentRoot(dshHome), "requirements.lock");
}

/** Python virtualenv directory for nature skill scripts. */
export function venvDir(dshHome = resolveDshHome()) {
	return join(labAgentRoot(dshHome), ".venv");
}

/** Python executable inside the managed virtualenv (platform-aware). */
export function venvPython(venv = venvDir(), platform = process.platform) {
	return platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
}

/** Human-readable layout summary for install/verify output. */
export function layoutSummary(dshHome = resolveDshHome()) {
	return {
		dshHome,
		labAgentRoot: labAgentRoot(dshHome),
		natureSkillsDir: natureSkillsDir(dshHome),
		natureSkillsRoot: natureSkillsRoot(dshHome),
		vendorLock: vendorLockPath(dshHome),
		requirementsLock: requirementsLockPath(dshHome),
		venv: venvDir(dshHome)
	};
}
