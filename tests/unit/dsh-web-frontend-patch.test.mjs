import { test } from "node:test";
import assert from "node:assert/strict";
import {
	applyDshWebFrontendPatch,
	inspectDshWebFrontendPatch,
	revertDshWebFrontendPatch
} from "../../src/dsh-web-frontend-patch.js";

// 0.1.5-rc.1 的压缩形态：helper 名 Fn，JSON 树复制走 setter $("copied")。
const pristine015 = 'head async function Fn(t){if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(t),!0}catch{return!1}const r=typeof document.execCommand=="function"?document.execCommand.bind(document):void 0} middle try{await navigator.clipboard.writeText(rm(b,j)),$("copied")}catch{$("failed")} tail';

// 0.1.7-rc.1 的压缩形态：helper 名 tr，参数名 e，JSON 树复制写成状态变量赋值。
// 上游依然没有 execCommand 回退，缺陷形状不同但仍在。
const pristine017 = 'head async function tr(e){if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(e),!0}catch{return!1}const n=typeof document.execCommand=="function"?document.execCommand.bind(document):void 0} middle let G;try{await navigator.clipboard.writeText(w_(V,X)),G="copied"}catch{G="failed"} tail';

test("DSH web clipboard fallback patch is exact, idempotent and reversible (0.1.5)", () => {
	const patched = applyDshWebFrontendPatch(pristine015);
	assert.equal(inspectDshWebFrontendPatch(patched).patchedAnchors, true);
	assert.match(patched, /\$\("failed"\);/);
	assert.equal(applyDshWebFrontendPatch(patched), patched);
	assert.equal(revertDshWebFrontendPatch(patched), pristine015);
});

test("DSH web clipboard fallback migrates the legacy missing-semicolon patch", () => {
	const legacy = applyDshWebFrontendPatch(pristine015).replace('$("failed");', '$("failed")');
	assert.equal(inspectDshWebFrontendPatch(legacy).legacyJsonAnchor, true);
	const migrated = applyDshWebFrontendPatch(legacy);
	assert.equal(inspectDshWebFrontendPatch(migrated).patchedAnchors, true);
	assert.equal(revertDshWebFrontendPatch(migrated), pristine015);
});

test("DSH web clipboard fallback patch is exact, idempotent and reversible (0.1.7)", () => {
	const patched = applyDshWebFrontendPatch(pristine017);
	const state = inspectDshWebFrontendPatch(patched);
	assert.equal(state.patchedAnchors, true);
	assert.equal(state.layouts.find((layout) => layout.id === "0.1.7-rc.1").patchedAnchors, true);
	// 共享 helper 必须落到自己的 execCommand 回退分支
	assert.match(patched, /catch\{\}const n=typeof document\.execCommand/);
	// JSON 树复制必须改走那个 helper，而不是直接调 clipboard
	assert.match(patched, /G=await tr\(w_\(V,X\)\)\?"copied":"failed"/);
	assert.equal(applyDshWebFrontendPatch(patched), patched);
	assert.equal(revertDshWebFrontendPatch(patched), pristine017);
});

test("DSH web clipboard fallback refuses an unknown layout", () => {
	assert.throws(() => applyDshWebFrontendPatch("unrelated"), /shared clipboard anchor/);
});
