import { test } from "node:test";
import assert from "node:assert/strict";
import {
	CAS_POLICY,
	assertCasAuthorized,
	prepareCasQuery,
	casLoginEntry,
	CasProvider,
	CasAuthorizationError,
	SCIFINDER_LOGIN_URL
} from "../../src/cas/boundary.js";

test("CAS policy defaults to no auto-access and no LLM ingest", () => {
	assert.equal(CAS_POLICY.autoAccess, false);
	assert.equal(CAS_POLICY.llmIngest, false);
	assert.equal(CAS_POLICY.requiresWrittenAuthorization, true);
});

test("assertCasAuthorized rejects missing/ungranted authorization", () => {
	assert.throws(() => assertCasAuthorized(undefined), CasAuthorizationError);
	assert.throws(() => assertCasAuthorized({ granted: false }), CasAuthorizationError);
	const auth = assertCasAuthorized({ granted: true, grantRef: "R-2026-001" });
	assert.equal(auth.grantRef, "R-2026-001");
});

test("prepareCasQuery builds URLs only, never executes", () => {
	const q = prepareCasQuery({ name: "doxorubicin", casRn: "23214-92-8" });
	assert.equal(q.executed, false);
	assert.equal(q.kind, "prepared-query");
	assert.equal(q.scifinderLogin, SCIFINDER_LOGIN_URL);
	assert.match(q.commonChemistry, /commonchemistry\.cas\.org\/detail\?cas_rn=23214-92-8/);
	const byName = prepareCasQuery({ structure: "CC1=C..." });
	assert.match(byName.commonChemistry, /commonchemistry\.cas\.org\/results\?q=/);
});

test("casLoginEntry returns the login URL only", () => {
	const entry = casLoginEntry();
	assert.equal(entry.url, SCIFINDER_LOGIN_URL);
	assert.equal(entry.policy.autoAccess, false);
});

test("CasProvider blocks all operations until authorized", async () => {
	const provider = new CasProvider();
	assert.throws(() => provider.requireAuth(), CasAuthorizationError);
	await assert.rejects(() => provider.search({ name: "x" }), CasAuthorizationError);
	assert.throws(() => provider.configureOauth2Pkce({ clientId: "c" }), CasAuthorizationError);

	const authorized = new CasProvider({ authorization: { granted: true, grantRef: "R" } });
	await assert.rejects(() => authorized.search({ name: "x" }), /placeholder/); // 授权后仍是占位实现
	const config = authorized.configureOauth2Pkce({ clientId: "c", redirectUri: "http://localhost/cb", tokenEndpoint: "https://cas/token" });
	assert.equal(config.clientId, "c");
});
