/**
 * Compatibility patch for DSH models that print a literal `<invoke>` block
 * instead of emitting a structured tool call. The transform is deliberately
 * narrow and reversible; callers must also verify the pristine file hash.
 */

export const FAKE_INVOKE_PATCH_MARKER = "let fakeInvokeRetries = 0;";

const ORIGINAL_COUNTER = "\t\tconst system = renderPrompt(assembly);\n\t\twhile (true) {";
const PATCHED_COUNTER = "\t\tconst system = renderPrompt(assembly);\n\t\tlet fakeInvokeRetries = 0;\n\t\twhile (true) {";

const ORIGINAL_GATE = "\t\t\tconst toolCalls = message.content.filter((block) => block.type === \"tool-call\");\n\t\t\tif (toolCalls.length === 0) return { kind: \"completed\" };";
const PATCHED_GATE = `\t\t\tconst toolCalls = message.content.filter((block) => block.type === "tool-call");
\t\t\tif (toolCalls.length === 0) {
\t\t\t\tconst hasFakeInvoke = message.content.some((block) => block.type === "text" && /<invoke\\b/i.test(block.text ?? ""));
\t\t\t\tif (hasFakeInvoke && fakeInvokeRetries < 1) {
\t\t\t\t\tfakeInvokeRetries += 1;
\t\t\t\t\tthis.session.append("user/message", createUserMessage({
\t\t\t\t\t\tcontent: [{
\t\t\t\t\t\t\ttype: "text",
\t\t\t\t\t\t\ttext: "[DSH auto-correction] Your last turn emitted a tool call as literal text <invoke ...> instead of through the tool calling mechanism, so no tool was executed. Re-issue the intended tool call as a real function/tool call."
\t\t\t\t\t\t}],
\t\t\t\t\t\tsource: {
\t\t\t\t\t\t\tkind: "plugin",
\t\t\t\t\t\t\tplugin: "@deepseek-ai/dsh-agent-loop",
\t\t\t\t\t\t\tform: "snapshot",
\t\t\t\t\t\t\tsections: [{ name: "tool-call-protocol", text: "detected literal <invoke> in assistant text" }]
\t\t\t\t\t\t}
\t\t\t\t\t}), { surfaceOp: "append" });
\t\t\t\t\tcontinue;
\t\t\t\t}
\t\t\t\treturn { kind: "completed" };
\t\t\t}`;

function exactlyOnce(source, fragment, label) {
	const first = source.indexOf(fragment);
	if (first < 0 || source.indexOf(fragment, first + fragment.length) >= 0) {
		throw new Error(`DSH compatibility patch expected exactly one ${label} anchor`);
	}
}

export function inspectFakeInvokePatch(source) {
	return {
		patched: source.includes(FAKE_INVOKE_PATCH_MARKER),
		pristineAnchors: source.includes(ORIGINAL_COUNTER) && source.includes(ORIGINAL_GATE),
		patchedAnchors: source.includes(PATCHED_COUNTER) && source.includes(PATCHED_GATE)
	};
}

export function applyFakeInvokePatch(source) {
	const state = inspectFakeInvokePatch(source);
	if (state.patched && state.patchedAnchors) return source;
	if (state.patched) throw new Error("DSH compatibility patch marker exists but the patch is incomplete");
	exactlyOnce(source, ORIGINAL_COUNTER, "loop counter");
	exactlyOnce(source, ORIGINAL_GATE, "tool-call gate");
	return source.replace(ORIGINAL_COUNTER, PATCHED_COUNTER).replace(ORIGINAL_GATE, PATCHED_GATE);
}

export function revertFakeInvokePatch(source) {
	const state = inspectFakeInvokePatch(source);
	if (!state.patched && state.pristineAnchors) return source;
	if (!state.patchedAnchors) throw new Error("cannot revert an unknown or incomplete DSH patch");
	exactlyOnce(source, PATCHED_COUNTER, "patched loop counter");
	exactlyOnce(source, PATCHED_GATE, "patched tool-call gate");
	return source.replace(PATCHED_COUNTER, ORIGINAL_COUNTER).replace(PATCHED_GATE, ORIGINAL_GATE);
}
