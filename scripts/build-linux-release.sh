#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ref="${1:-HEAD}"
dist_dir="${2:-$repo_root/dist}"

git -C "$repo_root" rev-parse --verify "$ref^{commit}" >/dev/null
version="$(git -C "$repo_root" show "$ref:package.json" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).version))')"
prefix="ibm-lab-agent-v${version}-linux"

mkdir -p "$dist_dir"
archive_tmp="$(mktemp "$dist_dir/.${prefix}.XXXXXX.tar.gz")"
trap 'rm -f "$archive_tmp"' EXIT

git -C "$repo_root" archive --format=tar --prefix="$prefix/" "$ref" | gzip -n -9 > "$archive_tmp"
mv "$archive_tmp" "$dist_dir/$prefix.tar.gz"
(
	cd "$dist_dir"
	sha256sum "$prefix.tar.gz" > SHA256SUMS
)

echo "$dist_dir/$prefix.tar.gz"
echo "$dist_dir/SHA256SUMS"
