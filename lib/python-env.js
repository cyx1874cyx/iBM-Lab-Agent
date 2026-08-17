/**
 * dsh-lab-agent: python environment service (Cordis host service).
 *
 * Provides `ctx.labPython`: preflight + bootstrap of the pinned venv for
 * nature skill scripts. No install happens at boot; callers (install script,
 * regression runner, later task interfaces) invoke bootstrap explicitly.
 */

import { Service } from "@deepseek-ai/cordis";
import * as py from "../src/python-env.js";

export class LabPythonService extends Service {
	/** @param config {{ venvDir?: string, lockFile?: string }} */
	constructor(ctx, config = {}) {
		super(ctx, "labPython");
		this.config = config;
	}

	// public (not #private): Cordis proxies method calls with shadow receivers
	paths() {
		const venvDir = this.config.venvDir;
		const lockFile = this.config.lockFile;
		if (!venvDir || !lockFile) throw new Error("labPython requires venvDir and lockFile (config or arguments)");
		return { venvDir, lockFile };
	}

	/** Non-mutating state probe. */
	async preflight() {
		return await py.preflight(this.paths());
	}

	/** Create the venv and install the pinned lock. */
	async bootstrap() {
		return await py.bootstrap(this.paths());
	}

	/** The venv's python version, or null when the venv does not exist. */
	async pythonVersion() {
		return await py.pythonVersion(this.paths().venvDir);
	}
}

export default LabPythonService;
