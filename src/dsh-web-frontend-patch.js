/**
 * Narrow, reversible compatibility patch for the pinned DSH web frontend.
 * It fixes both clipboard paths: the shared copy helper now falls through to
 * execCommand when Clipboard API rejects, and JSON-tree copy reuses that helper.
 */

export const WEB_CLIPBOARD_PATCH_MARKER = "catch{}const r=typeof document.execCommand";

const ORIGINAL_SHARED = "if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(t),!0}catch{return!1}const r=typeof document.execCommand";
const PATCHED_SHARED = "if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(t),!0}catch{}const r=typeof document.execCommand";

const ORIGINAL_JSON = 'try{await navigator.clipboard.writeText(rm(b,j)),$("copied")}catch{$("failed")}';
const LEGACY_PATCHED_JSON = 'await Fn(rm(b,j))?$("copied"):$("failed")';
const PATCHED_JSON = 'await Fn(rm(b,j))?$("copied"):$("failed");';

function exactlyOnce(source, fragment, label) {
	const first = source.indexOf(fragment);
	if (first < 0 || source.indexOf(fragment, first + fragment.length) >= 0) {
		throw new Error(`DSH web patch expected exactly one ${label} anchor`);
	}
}

export function inspectDshWebFrontendPatch(source) {
	return {
		patched: source.includes(WEB_CLIPBOARD_PATCH_MARKER),
		pristineAnchors: source.includes(ORIGINAL_SHARED) && source.includes(ORIGINAL_JSON),
		patchedAnchors: source.includes(PATCHED_SHARED) && source.includes(PATCHED_JSON),
		legacyJsonAnchor: source.includes(LEGACY_PATCHED_JSON) && !source.includes(PATCHED_JSON)
	};
}

export function applyDshWebFrontendPatch(source) {
	const state = inspectDshWebFrontendPatch(source);
	if (state.patched && state.patchedAnchors) return source;
	if (state.patched && state.legacyJsonAnchor) {
		exactlyOnce(source, LEGACY_PATCHED_JSON, "legacy JSON clipboard");
		return source.replace(LEGACY_PATCHED_JSON, PATCHED_JSON);
	}
	if (state.patched || source.includes(PATCHED_JSON)) throw new Error("DSH web clipboard patch is incomplete");
	exactlyOnce(source, ORIGINAL_SHARED, "shared clipboard");
	exactlyOnce(source, ORIGINAL_JSON, "JSON clipboard");
	return source.replace(ORIGINAL_SHARED, PATCHED_SHARED).replace(ORIGINAL_JSON, PATCHED_JSON);
}

export function revertDshWebFrontendPatch(source) {
	const state = inspectDshWebFrontendPatch(source);
	if (!state.patched && state.pristineAnchors) return source;
	if (state.patched && state.legacyJsonAnchor) {
		exactlyOnce(source, LEGACY_PATCHED_JSON, "legacy patched JSON clipboard");
		return source.replace(PATCHED_SHARED, ORIGINAL_SHARED).replace(LEGACY_PATCHED_JSON, ORIGINAL_JSON);
	}
	if (!state.patchedAnchors) throw new Error("cannot revert an unknown or incomplete DSH web patch");
	exactlyOnce(source, PATCHED_SHARED, "patched shared clipboard");
	exactlyOnce(source, PATCHED_JSON, "patched JSON clipboard");
	return source.replace(PATCHED_SHARED, ORIGINAL_SHARED).replace(PATCHED_JSON, ORIGINAL_JSON);
}
