#!/usr/bin/env node

/** Create or repair only the dedicated iBM Lab DSH profile. */

import { resolve } from "node:path";
import { resolveDshHome } from "../src/paths.js";
import { ensureIbmLabProfile, IBM_LAB_PROFILE } from "../src/ibm-lab-profile.js";

function parseArgs(argv) {
	const index = argv.indexOf("--dsh-home");
	if (index < 0) return { dshHome: resolveDshHome() };
	if (!argv[index + 1] || argv.length !== 2) {
		throw new Error("usage: ensure-ibm-lab-profile.mjs [--dsh-home <path>]");
	}
	return { dshHome: resolve(argv[index + 1]) };
}

try {
	const { dshHome } = parseArgs(process.argv.slice(2));
	const result = ensureIbmLabProfile({ dshHome });
	if (result.failures.length) throw new Error(result.failures.join("; "));
	console.log(`${IBM_LAB_PROFILE} profile ${result.changed ? "normalized" : "ready"}: ${result.profileDir}`);
	console.log(`bundles: ${result.bundles.join(", ")}`);
} catch (error) {
	console.error(`ensure-ibm-lab-profile failed: ${error.message}`);
	process.exit(1);
}
