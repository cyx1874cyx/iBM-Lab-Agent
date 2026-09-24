/**
 * Narrow, reversible compatibility patch for the pinned DSH web frontend.
 *
 * The shipped bundle has two clipboard paths:
 *
 *   1. a shared copy helper that returns `false` as soon as
 *      `navigator.clipboard.writeText` rejects — its own `document.execCommand`
 *      fallback is unreachable;
 *   2. a JSON-tree copy that calls `navigator.clipboard.writeText` directly.
 *
 * WebView2 and other non-secure-context hosts reject the async Clipboard API
 * while `execCommand("copy")` still works, so both paths silently fail. The
 * patch lets the helper fall through to its fallback and routes the JSON-tree
 * copy through that helper.
 *
 * Anchors are minified output, so every supported DSH build is one layout row.
 * The same patch broke inside the 0.1.5 line (rc.1 → rc.2) once already; new
 * DSH releases must add a layout instead of editing an existing one, so an old
 * build stays recognizable ("no supported layout") rather than mis-patched.
 */

const LAYOUTS = [
	{
		// @deepseek-ai/dsh-web-frontend 0.1.5-rc.1
		id: "0.1.5-rc.1",
		shared: {
			pristine:
				"if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(t),!0}catch{return!1}const r=typeof document.execCommand",
			patched:
				"if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(t),!0}catch{}const r=typeof document.execCommand"
		},
		json: {
			pristine: 'try{await navigator.clipboard.writeText(rm(b,j)),$("copied")}catch{$("failed")}',
			patched: 'await Fn(rm(b,j))?$("copied"):$("failed");',
			// An early build of this patch emitted the expression without the
			// terminating semicolon. Migrate it rather than refusing to start.
			legacyPatched: 'await Fn(rm(b,j))?$("copied"):$("failed")'
		}
	},
	{
		// @deepseek-ai/dsh-web-frontend 0.1.7-rc.1
		// Upstream rewrote the JSON-tree copy to assign the status variable
		// instead of calling a setter, and the minifier renamed the helper and
		// its parameters. The defect (no execCommand fallback) is unchanged.
		id: "0.1.7-rc.1",
		shared: {
			pristine:
				"if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(e),!0}catch{return!1}const n=typeof document.execCommand",
			patched:
				"if(navigator.clipboard?.writeText)try{return await navigator.clipboard.writeText(e),!0}catch{}const n=typeof document.execCommand"
		},
		json: {
			pristine: 'try{await navigator.clipboard.writeText(w_(V,X)),G="copied"}catch{G="failed"}',
			patched: 'G=await tr(w_(V,X))?"copied":"failed"'
		}
	}
];

/** Every layout's "shared helper already patched" marker. */
export const WEB_CLIPBOARD_PATCH_MARKERS = LAYOUTS.map((layout) => layout.shared.patched);

function exactlyOnce(source, fragment, label) {
	const first = source.indexOf(fragment);
	if (first < 0 || source.indexOf(fragment, first + fragment.length) >= 0) {
		throw new Error(`DSH web patch expected exactly one ${label} anchor`);
	}
}

function stateForLayout(source, layout) {
	const patched = source.includes(layout.shared.patched);
	const patchedJson = source.includes(layout.json.patched);
	return {
		id: layout.id,
		patched,
		pristineAnchors: source.includes(layout.shared.pristine) && source.includes(layout.json.pristine),
		patchedAnchors: patched && patchedJson,
		legacyJsonAnchor:
			layout.json.legacyPatched !== undefined &&
			!patchedJson &&
			source.includes(layout.json.legacyPatched)
	};
}

export function inspectDshWebFrontendPatch(source) {
	const layouts = LAYOUTS.map((layout) => stateForLayout(source, layout));
	return {
		patched: layouts.some((state) => state.patched),
		pristineAnchors: layouts.some((state) => state.pristineAnchors),
		patchedAnchors: layouts.some((state) => state.patchedAnchors),
		legacyJsonAnchor: layouts.some((state) => state.legacyJsonAnchor),
		layouts
	};
}

/** The first layout whose pristine shared anchor appears in `source`. */
function pristineLayout(source) {
	return LAYOUTS.find((layout) => source.includes(layout.shared.pristine));
}

function patchedLayout(source) {
	return LAYOUTS.find(
		(layout) => source.includes(layout.shared.patched) && source.includes(layout.json.patched)
	);
}

function legacyLayout(source) {
	return LAYOUTS.find(
		(layout) =>
			layout.json.legacyPatched !== undefined &&
			source.includes(layout.json.legacyPatched) &&
			!source.includes(layout.json.patched)
	);
}

export function applyDshWebFrontendPatch(source) {
	const state = inspectDshWebFrontendPatch(source);
	if (state.patched && state.patchedAnchors) return source;
	if (state.patched && state.legacyJsonAnchor) {
		const layout = legacyLayout(source);
		exactlyOnce(source, layout.json.legacyPatched, "legacy JSON clipboard");
		return source.replace(layout.json.legacyPatched, layout.json.patched);
	}
	if (state.patched || LAYOUTS.some((layout) => source.includes(layout.json.patched))) {
		throw new Error("DSH web clipboard patch is incomplete");
	}
	const layout = pristineLayout(source);
	if (!layout) throw new Error("DSH web patch found no supported shared clipboard anchor");
	exactlyOnce(source, layout.shared.pristine, "shared clipboard");
	exactlyOnce(source, layout.json.pristine, "JSON clipboard");
	return source.replace(layout.shared.pristine, layout.shared.patched).replace(layout.json.pristine, layout.json.patched);
}

export function revertDshWebFrontendPatch(source) {
	const state = inspectDshWebFrontendPatch(source);
	if (!state.patched && state.pristineAnchors) return source;
	if (state.patched && state.legacyJsonAnchor) {
		const layout = legacyLayout(source);
		exactlyOnce(source, layout.shared.patched, "patched shared clipboard");
		exactlyOnce(source, layout.json.legacyPatched, "legacy patched JSON clipboard");
		return source
			.replace(layout.shared.patched, layout.shared.pristine)
			.replace(layout.json.legacyPatched, layout.json.pristine);
	}
	const layout = patchedLayout(source);
	if (!layout) throw new Error("cannot revert an unknown or incomplete DSH web patch");
	exactlyOnce(source, layout.shared.patched, "patched shared clipboard");
	exactlyOnce(source, layout.json.patched, "patched JSON clipboard");
	return source
		.replace(layout.shared.patched, layout.shared.pristine)
		.replace(layout.json.patched, layout.json.pristine);
}
