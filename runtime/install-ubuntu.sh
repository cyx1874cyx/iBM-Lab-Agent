#!/usr/bin/env bash
set -euo pipefail

# Run this during the Ubuntu/WSL image build. Office rendering is a product
# runtime dependency; the application intentionally has no text-only fallback.
if [[ ${EUID} -ne 0 ]]; then
	echo "runtime/install-ubuntu.sh must run as root during image construction" >&2
	exit 1
fi

runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mapfile -t packages < <(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "${runtime_dir}/apt-packages.txt")

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
rm -rf /var/lib/apt/lists/*

soffice --headless --version
