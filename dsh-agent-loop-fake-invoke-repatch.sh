#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible entry point for the old local repatch command. Unlike
# the former script, this locates the pinned Linux runtime and refuses to edit
# a DSH file whose checksum does not match runtime/versions.env.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data_root="${IBM_LAB_AGENT_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/ibm-lab-agent}"
runtime_root="${IBM_LAB_AGENT_RUNTIME_DIR:-$data_root/runtime}"
target="${DSH_AGENT_LOOP_TARGET:-$runtime_root/launcher/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js}"

# shellcheck disable=SC1091
source "$repo_root/runtime/versions.env"

command_name="${1:-verify}"
case "$command_name" in
	patch)
		"$runtime_root/node/bin/node" "$repo_root/scripts/patch-dsh-runtime.mjs" patch \
			--target "$target" --expect-sha256 "$DSH_AGENT_LOOP_SHA256"
		;;
	verify|revert)
		"$runtime_root/node/bin/node" "$repo_root/scripts/patch-dsh-runtime.mjs" "$command_name" --target "$target"
		;;
	*) echo "用法：$0 patch|verify|revert" >&2; exit 2 ;;
esac
