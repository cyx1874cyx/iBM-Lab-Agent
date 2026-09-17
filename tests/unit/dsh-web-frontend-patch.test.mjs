import { test } from "node:test";
import assert from "node:assert/strict";
import {
	applyDshWebFrontendPatch,
	inspectDshWebFrontendPatch,
	revertDshWebFrontendPatch
} from "../../src/dsh-web-frontend-patch.js";

const pristine = 'head async function Fn(t){if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(t),!0}catch{return!1}const r=typeof document.execCommand=="function"?document.execCommand.bind(document):void 0} middle try{await navigator.clipboard.writeText(rm(b,j)),$("copied")}catch{$("failed")} tail';

test("DSH web clipboard fallback patch is exact, idempotent and reversible", () => {
	const patched = applyDshWebFrontendPatch(pristine);
	assert.equal(inspectDshWebFrontendPatch(patched).patchedAnchors, true);
	assert.match(patched, /\$\("failed"\);/);
	assert.equal(applyDshWebFrontendPatch(patched), patched);
	assert.equal(revertDshWebFrontendPatch(patched), pristine);
});

test("DSH web clipboard fallback migrates the legacy missing-semicolon patch", () => {
	const legacy = applyDshWebFrontendPatch(pristine).replace('$("failed");', '$("failed")');
	assert.equal(inspectDshWebFrontendPatch(legacy).legacyJsonAnchor, true);
	const migrated = applyDshWebFrontendPatch(legacy);
	assert.equal(inspectDshWebFrontendPatch(migrated).patchedAnchors, true);
	assert.equal(revertDshWebFrontendPatch(migrated), pristine);
});

test("DSH web clipboard fallback refuses an unknown layout", () => {
	assert.throws(() => applyDshWebFrontendPatch("unrelated"), /shared clipboard anchor/);
});
