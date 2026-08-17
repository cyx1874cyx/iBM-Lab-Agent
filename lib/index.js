/**
 * dsh-lab-agent: main plugin entry.
 *
 * Convenience host service `ctx.labAgent` describing the plugin and its
 * deployment layout. The real functionality lives in the subpath services
 * (`dsh-lab-agent/version-registry`, `dsh-lab-agent/python-env`) that the
 * bundle patch mounts.
 */

import { Service } from "@deepseek-ai/cordis";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgUrl = new URL("../package.json", import.meta.url);
const here = fileURLToPath(new URL(".", import.meta.url));

export class LabAgentService extends Service {
	constructor(ctx, config = {}) {
		super(ctx, "labAgent");
		this.config = config;
	}

	/** Package metadata (name/version) read once. */
	async info() {
		const pkg = JSON.parse(await readFile(pkgUrl, "utf8"));
		return { name: pkg.name, version: pkg.version, description: pkg.description };
	}

	/** Resolve an asset shipped inside the plugin package (presets, python/). */
	resolveAsset(relative) {
		return join(here, "..", relative);
	}
}

export default LabAgentService;
