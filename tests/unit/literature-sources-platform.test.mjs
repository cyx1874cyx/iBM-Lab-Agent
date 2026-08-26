import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultBrowserCandidates } from "../../lib/literature-sources.js";

test("institutional browser discovery has native Linux candidates", () => {
	const candidates = defaultBrowserCandidates("linux", { LIT_BROWSER_PATH: "/opt/lab-browser" });
	assert.equal(candidates[0], "/opt/lab-browser");
	assert.ok(candidates.includes("/usr/bin/google-chrome-stable"));
	assert.ok(candidates.includes("/usr/bin/chromium"));
	assert.equal(candidates.some((path) => path.includes("C:\\")), false);
});
