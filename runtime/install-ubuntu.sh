#!/usr/bin/env bash
set -euo pipefail

# Install the native Ubuntu/Debian dependencies. It works both in an image
# build (root) and from the one-line user installer (sudo).

runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mapfile -t packages < <(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "${runtime_dir}/apt-packages.txt")

if [[ ${EUID} -eq 0 ]]; then
	apt=(apt-get)
else
	command -v sudo >/dev/null 2>&1 || {
		echo "缺少 sudo，无法安装系统依赖。请由管理员运行本脚本。" >&2
		exit 1
	}
	apt=(sudo apt-get)
fi

"${apt[@]}" update
DEBIAN_FRONTEND=noninteractive "${apt[@]}" install -y --no-install-recommends "${packages[@]}"

soffice --headless --version
pdftoppm -v 2>&1 | head -n 1
