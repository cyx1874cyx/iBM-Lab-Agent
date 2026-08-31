/**
 * Definition and maintenance helpers for the dedicated iBM Lab DSH profile.
 *
 * Keep the laboratory bundle outside DSH's shared `web` profile.  The main
 * plugin entry provides the fixed Cordis service name `labAgent`, so allowing
 * its bundle to appear more than once in a composed profile causes Cordis to
 * reject startup with "service \"labAgent\" has been registered".
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	initProfile,
	readProfileManifest,
	resolveProfileDir,
	writeProfileManifest
} from "@deepseek-ai/dsh-app-boot";

export const IBM_LAB_PROFILE = "ibm-lab";
export const IBM_LAB_BASE_BUNDLES = [
	"@deepseek-ai/dsh-base",
	"@deepseek-ai/dsh-web-app"
];
export const IBM_LAB_PLUGIN_BUNDLE = "dsh-lab-agent";

function normalizedBundles(manifest) {
	return Array.isArray(manifest?.dsh?.profile?.bundles)
		? manifest.dsh.profile.bundles.filter((bundle) => typeof bundle === "string")
		: [];
}

/** Return user-facing diagnostics for a resolved iBM Lab profile manifest. */
export function validateIbmLabProfile(manifest) {
	const bundles = normalizedBundles(manifest);
	const failures = [];
	for (const required of IBM_LAB_BASE_BUNDLES) {
		if (bundles.filter((bundle) => bundle === required).length !== 1) {
			failures.push(`expected exactly one ${required} bundle`);
		}
	}
	const labBundleCount = bundles.filter((bundle) => bundle === IBM_LAB_PLUGIN_BUNDLE).length;
	if (labBundleCount > 1) failures.push(`found ${labBundleCount} ${IBM_LAB_PLUGIN_BUNDLE} bundles`);
	return failures;
}

/**
 * Initialize or normalize the dedicated profile without touching any other
 * DSH profile.  Non-iBM third-party bundles are retained in their existing
 * relative order, while the required web foundation and lab bundle are
 * de-duplicated deterministically.
 */
export function ensureIbmLabProfile({ dshHome }) {
	const home = resolve(dshHome);
	const profileDir = resolveProfileDir(IBM_LAB_PROFILE, home);
	if (!existsSync(join(profileDir, "package.json"))) initProfile(profileDir, IBM_LAB_BASE_BUNDLES);

	const manifest = readProfileManifest("iBM Lab Agent", profileDir);
	const current = normalizedBundles(manifest);
	const extras = current.filter(
		(bundle) => !IBM_LAB_BASE_BUNDLES.includes(bundle) && bundle !== IBM_LAB_PLUGIN_BUNDLE
	);
	const includeLabBundle = current.includes(IBM_LAB_PLUGIN_BUNDLE);
	const bundles = [
		...IBM_LAB_BASE_BUNDLES,
		...extras,
		...(includeLabBundle ? [IBM_LAB_PLUGIN_BUNDLE] : [])
	];
	const changed = JSON.stringify(current) !== JSON.stringify(bundles);
	if (changed) {
		manifest.dsh = {
			...manifest.dsh,
			profile: {
				...manifest.dsh?.profile,
				bundles
			}
		};
		writeProfileManifest(profileDir, manifest);
	}
	const normalizedManifest = {
		...manifest,
		dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
	};
	return {
		profileDir,
		bundles,
		changed,
		failures: validateIbmLabProfile(normalizedManifest)
	};
}
