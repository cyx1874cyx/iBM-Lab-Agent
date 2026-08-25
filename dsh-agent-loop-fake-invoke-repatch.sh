#!/usr/bin/env bash
# Repatch script: detect and auto-correct model-emitting `<invoke>` as literal text
# in @deepseek-ai/dsh-agent-loop instead of real structured tool_calls.
#
# Recommended to apply after any `npx @deepseek-ai/dsh` re-install / cache clear,
# because the patch lives inside the npx cache directory and WILL be lost on reinstall.
#
# Usage:
#   ./dsh-agent-loop-fake-invoke-repatch.sh patch   # apply the patch (idempotent-ish, verify after)
#   ./dsh-agent-loop-fake-invoke-repatch.sh revert  # restore pristine file from backup
#   ./dsh-agent-loop-fake-invoke-repatch.sh verify  # show whether the patch is present
set -euo pipefail

TARGET="$HOME/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
BACKUP="$PWD/dsh-agent-loop.index.js.bak"
PATCH_MARKER="let fakeInvokeRetries = 0;"

case "${1:-verify}" in
  patch)
    if grep -qF "$PATCH_MARKER" "$TARGET"; then
      echo "patch already present in $TARGET"
    else
      cp "$TARGET" "$BACKUP"
      python3 - "$TARGET" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old_counter = "\t\tconst system = renderPrompt(assembly);\n\t\twhile (true) {"
new_counter = "\t\tconst system = renderPrompt(assembly);\n\t\tlet fakeInvokeRetries = 0;\n\t\twhile (true) {"
assert s.count(old_counter) == 1, f"counter anchor count={s.count(old_counter)}"
s = s.replace(old_counter, new_counter)
old_gate = "\t\t\tconst toolCalls = message.content.filter((block) => block.type === \"tool-call\");\n\t\t\tif (toolCalls.length === 0) return { kind: \"completed\" };"
new_gate = '''\t\t\tconst toolCalls = message.content.filter((block) => block.type === "tool-call");
\t\t\tif (toolCalls.length === 0) {
\t\t\t\tconst hasFakeInvoke = message.content.some((block) => block.type === "text" && /<invoke\\b/i.test(block.text ?? ""));
\t\t\t\tif (hasFakeInvoke && fakeInvokeRetries < 1) {
\t\t\t\t\tfakeInvokeRetries += 1;
\t\t\t\t\tthis.session.append("user/message", createUserMessage({
\t\t\t\t\t\tcontent: [{
\t\t\t\t\t\t\ttype: "text",
\t\t\t\t\t\t\ttext: "[DSH auto-correction] Your last turn emitted a tool call as literal text `<invoke ...>` instead of through the tool calling mechanism, so no tool was executed. Re-issue the intended tool call as a real function/tool call."
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
\t\t\t\treturn { kind: \"completed\" };
\t\t\t}'''
assert s.count(old_gate) == 1, f"gate anchor count={s.count(old_gate)}"
s = s.replace(old_gate, new_gate)
open(p, "w", encoding="utf-8").write(s)
print("patched", p)
PY
      node --check "$TARGET" && node -e 'import("'$TARGET'").then(()=>console.log("MODULE LOADED")).catch(e=>{console.error(e);process.exit(1)})'
    fi
    ;;
  revert)
    if [ -f "$BACKUP" ]; then cp "$BACKUP" "$TARGET"; echo "reverted $TARGET from backup"; node --check "$TARGET"; else echo "backup not found at $BACKUP"; fi
    ;;
  verify)
    if grep -qF "$PATCH_MARKER" "$TARGET"; then echo "patch PRESENT"; else echo "patch ABSENT"; fi
    ;;
esac
