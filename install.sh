#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

repo_slug="${IBM_LAB_AGENT_REPO:-cyx1874cyx/iBM-Lab-Agent}"
source_ref="${IBM_LAB_AGENT_REF:-main}"
data_root="${IBM_LAB_AGENT_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/ibm-lab-agent}"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
start_after=0
install_system=1
install_python_extras=1
patch_dsh=1
set_default_preset=1
source_dir="${IBM_LAB_AGENT_SOURCE_DIR:-}"

usage() {
	cat <<'USAGE'
iBM Lab Agent Linux installer

Usage: install.sh [options]
  --start                  install and start the Web UI in the background
  --ref <git-ref>          GitHub branch/tag/commit (default: main)
  --data-dir <path>        install root (default: ~/.local/share/ibm-lab-agent)
  --dsh-home <path>        DSH state root (default: ~/.dsh)
  --source-dir <path>      install from a local checkout (test/offline packaging)
  --skip-system-deps       do not invoke apt-get
  --no-python-extras       skip MarkItDown, PyMuPDF, python-pptx and RDKit
  --no-dsh-patch           do not apply the reversible fake-<invoke> compatibility patch
  --keep-default-preset    do not set new sessions to lab-research
  -h, --help               show this help
USAGE
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--start) start_after=1; shift ;;
		--ref) source_ref="${2:?--ref needs a value}"; shift 2 ;;
		--data-dir) data_root="${2:?--data-dir needs a value}"; shift 2 ;;
		--dsh-home) dsh_home="${2:?--dsh-home needs a value}"; shift 2 ;;
		--source-dir) source_dir="${2:?--source-dir needs a value}"; shift 2 ;;
		--skip-system-deps) install_system=0; shift ;;
		--no-python-extras) install_python_extras=0; shift ;;
		--no-dsh-patch) patch_dsh=0; shift ;;
		--keep-default-preset) set_default_preset=0; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
	esac
done

# DSH's own CLI reads this variable; keep every profile/config operation in
# the exact state root selected by --dsh-home.
export DSH_HOME="$dsh_home"

[[ "$(uname -s)" == "Linux" ]] || { echo "此发行安装器仅支持 Linux。" >&2; exit 1; }
[[ ${EUID} -ne 0 ]] || { echo "请以普通用户运行安装器；需要系统包时会单独调用 apt/sudo。" >&2; exit 1; }

for command_name in bash curl tar sha256sum; do
	command -v "$command_name" >/dev/null 2>&1 || { echo "缺少基础命令：$command_name" >&2; exit 1; }
done

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/ibm-lab-agent-install.XXXXXX")"
cleanup() {
	[[ "$tmp_root" == "${TMPDIR:-/tmp}/ibm-lab-agent-install."* ]] && rm -rf "$tmp_root"
}
trap cleanup EXIT

echo "[1/8] 获取 iBM Lab Agent 源码"
if [[ -n "$source_dir" ]]; then
	source_dir="$(cd "$source_dir" && pwd)"
	[[ -f "$source_dir/runtime/versions.env" ]] || { echo "本地源码缺少 runtime/versions.env" >&2; exit 1; }
	mkdir -p "$tmp_root/source"
	tar -C "$source_dir" \
		--exclude='./.git' --exclude='./node_modules' --exclude='*/node_modules' \
		--exclude='./dist' --exclude='*.tgz' --exclude='.dsh-filess' --exclude='session-*.jsonl' \
		-cf - . | tar -C "$tmp_root/source" -xf -
else
	archive="$tmp_root/source.tar.gz"
	curl --fail --location --retry 3 --progress-bar \
		"https://codeload.github.com/${repo_slug}/tar.gz/${source_ref}" -o "$archive"
	mkdir -p "$tmp_root/unpack"
	tar -xzf "$archive" -C "$tmp_root/unpack"
	mapfile -t roots < <(find "$tmp_root/unpack" -mindepth 1 -maxdepth 1 -type d)
	[[ ${#roots[@]} -eq 1 ]] || { echo "GitHub 源码包结构异常" >&2; exit 1; }
	mv "${roots[0]}" "$tmp_root/source"
fi

# shellcheck disable=SC1091
source "$tmp_root/source/runtime/versions.env"

case "$(uname -m)" in
	x86_64|amd64)
		node_arch="x64"
		node_sha256="$NODE_SHA256_LINUX_X64"
		;;
	aarch64|arm64)
		node_arch="arm64"
		node_sha256="$NODE_SHA256_LINUX_ARM64"
		;;
	*) echo "不支持的 Linux 架构：$(uname -m)（目前支持 x86_64、arm64）" >&2; exit 1 ;;
esac

if [[ $install_system -eq 1 ]]; then
	echo "[2/8] 安装 Ubuntu/Debian 原生依赖（LibreOffice、PDF 工具和中文字体）"
	if [[ ! -r /etc/os-release ]]; then
		echo "无法识别发行版；请用 --skip-system-deps 并自行安装 runtime/apt-packages.txt。" >&2
		exit 1
	fi
	# shellcheck disable=SC1091
	source /etc/os-release
	if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
		echo "当前仅自动配置 Ubuntu/Debian；请用 --skip-system-deps 并自行安装系统包。" >&2
		exit 1
	fi
	bash "$tmp_root/source/runtime/install-ubuntu.sh"
else
	echo "[2/8] 跳过系统包安装"
	command -v soffice >/dev/null 2>&1 || { echo "缺少 LibreOffice soffice；安装阶段无法继续。" >&2; exit 1; }
fi

mkdir -p "$data_root/runtime" "$data_root/releases" "$data_root/bin"
runtime_root="$data_root/runtime"
printf '%s\n' "$dsh_home" > "$runtime_root/dsh-home"
chmod 600 "$runtime_root/dsh-home"

echo "[3/8] 安装固定版 Node.js v$NODE_VERSION"
node_target="$runtime_root/node-v${NODE_VERSION}-linux-${node_arch}"
node_link="$runtime_root/node"
if [[ ! -x "$node_target/bin/node" || "$($node_target/bin/node --version 2>/dev/null || true)" != "v$NODE_VERSION" ]]; then
	node_archive="$tmp_root/node.tar.xz"
	curl --fail --location --retry 3 --progress-bar \
		"https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o "$node_archive"
	echo "$node_sha256  $node_archive" | sha256sum --check --status || {
		echo "Node.js 下载校验失败" >&2
		exit 1
	}
	tar -xJf "$node_archive" -C "$runtime_root"
fi
if [[ -e "$node_link" && ! -L "$node_link" ]]; then
	mv "$node_link" "$node_link.pre-ibm-$(date +%Y%m%d%H%M%S)"
fi
ln -sfn "$node_target" "$node_link"
export PATH="$node_link/bin:$PATH"

echo "[4/8] 安装固定版 DSH、pnpm 与 Python $PYTHON_VERSION"
launcher_root="$runtime_root/launcher"
mkdir -p "$launcher_root"
pnpm_root="$runtime_root/pnpm-$PNPM_VERSION"
pnpm_archive="$tmp_root/pnpm.tgz"
if [[ ! -f "$pnpm_root/package/bin/pnpm.cjs" ]]; then
	curl --fail --location --retry 3 --progress-bar \
		"https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz" -o "$pnpm_archive"
	echo "$PNPM_SHA256  $pnpm_archive" | sha256sum --check --status || {
		echo "pnpm 下载校验失败" >&2
		exit 1
	}
	mkdir -p "$pnpm_root"
	tar -xzf "$pnpm_archive" -C "$pnpm_root"
fi
pnpm_bin="$runtime_root/runtime-bin/pnpm"
mkdir -p "$(dirname "$pnpm_bin")"
cat > "$pnpm_bin" <<EOF
#!/usr/bin/env bash
exec "$node_link/bin/node" "$pnpm_root/package/bin/pnpm.cjs" "\$@"
EOF
chmod 755 "$pnpm_bin"
cp "$tmp_root/source/runtime/launcher/package.json" "$tmp_root/source/runtime/launcher/pnpm-lock.yaml" \
	"$tmp_root/source/runtime/launcher/.npmrc" "$launcher_root/"
"$pnpm_bin" --dir "$launcher_root" install --prod --frozen-lockfile --ignore-scripts

runtime_bin="$runtime_root/runtime-bin"
python_bin_dir="$runtime_root/python-bin"
mkdir -p "$runtime_bin" "$python_bin_dir"
if [[ ! -x "$runtime_bin/uv" || "$($runtime_bin/uv --version 2>/dev/null || true)" != "uv $UV_VERSION"* ]]; then
	curl --fail --location --retry 3 --progress-bar "https://astral.sh/uv/${UV_VERSION}/install.sh" -o "$tmp_root/install-uv.sh"
	env UV_UNMANAGED_INSTALL="$runtime_bin" sh "$tmp_root/install-uv.sh"
fi
export UV_PYTHON_INSTALL_DIR="$runtime_root/python"
export UV_PYTHON_BIN_DIR="$python_bin_dir"
"$runtime_bin/uv" python install "$PYTHON_VERSION" --default
managed_python="$("$runtime_bin/uv" python find "$PYTHON_VERSION")"
[[ -x "$managed_python" ]] || { echo "uv 未返回可执行的 Python：$managed_python" >&2; exit 1; }
# venv must be created through the interpreter's real installation directory.
# Invoking the convenience symlink from python-bin makes CPython write an
# incorrect pyvenv.cfg home on some uv standalone builds.
export PATH="$node_link/bin:$launcher_root/node_modules/.bin:$(dirname "$managed_python"):$python_bin_dir:$runtime_bin:$PATH"
export DSH_HARNESS_NODE_MODULES="$launcher_root/node_modules"

if [[ $patch_dsh -eq 1 ]]; then
	loop_target="$launcher_root/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
	[[ -f "$loop_target" ]] || { echo "无法定位 dsh-agent-loop：$loop_target" >&2; exit 1; }
	node "$tmp_root/source/scripts/patch-dsh-runtime.mjs" patch \
		--target "$loop_target" --expect-sha256 "$DSH_AGENT_LOOP_SHA256"
fi

echo "[5/8] 安装插件依赖与科研 Python 环境"
release_stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_dir="$data_root/releases/${IBM_LAB_AGENT_VERSION}-${release_stamp}"
mkdir -p "$release_dir"
cp -a "$tmp_root/source/." "$release_dir/"
(
	cd "$release_dir"
	npm ci --omit=peer --ignore-scripts --legacy-peer-deps --no-audit --no-fund
	node scripts/dev-link.mjs
	node scripts/install.mjs --strict --force-preset --force-vendor --dsh-home "$dsh_home"
)

venv_python="$dsh_home/lab-agent/.venv/bin/python"
[[ -x "$venv_python" ]] || { echo "科研 Python venv 未生成：$venv_python" >&2; exit 1; }
if [[ $install_python_extras -eq 1 ]]; then
	"$venv_python" -m pip install --disable-pip-version-check \
		--report "$dsh_home/lab-agent/python-linux-install-report.json" \
		-r "$release_dir/python/requirements-linux.lock"
else
	echo "已按要求跳过 Linux Python 扩展。"
fi

echo "[6/8] 把插件加入 DSH Web profile"
dsh_bin="$launcher_root/node_modules/.bin/dsh"
"$dsh_bin" plugin --profile web add "$release_dir"
if [[ $set_default_preset -eq 1 ]]; then
	node "$release_dir/scripts/configure-default-preset.mjs" --dsh-home "$dsh_home"
fi

echo "[7/8] 固化启动入口并做配置检查"
current_link="$data_root/current"
if [[ -e "$current_link" && ! -L "$current_link" ]]; then
	mv "$current_link" "$current_link.pre-ibm-$(date +%Y%m%d%H%M%S)"
fi
ln -sfn "$release_dir" "$current_link"
mkdir -p "${XDG_BIN_HOME:-$HOME/.local/bin}"
ln -sfn "$current_link/bin/ibm-lab-agent" "${XDG_BIN_HOME:-$HOME/.local/bin}/ibm-lab-agent"

"$dsh_bin" --profile web --dump-config > "$tmp_root/resolved-web.yml"
grep -q 'dsh-lab-agent' "$tmp_root/resolved-web.yml" || { echo "DSH 配置中未发现插件" >&2; exit 1; }
node "$release_dir/scripts/lab-doctor.mjs" --python "$venv_python" --json > "$dsh_home/lab-agent/doctor-linux.json"

echo "[8/8] 安装完成"
launcher="${XDG_BIN_HOME:-$HOME/.local/bin}/ibm-lab-agent"
echo "iBM Lab Agent $IBM_LAB_AGENT_VERSION / DSH $DSH_VERSION"
echo "安装目录：$current_link"
echo "状态目录：$dsh_home"

if [[ $start_after -eq 1 ]]; then
	"$launcher" start
else
	echo "启动命令：$launcher start"
fi

if [[ ":$PATH:" != *":${XDG_BIN_HOME:-$HOME/.local/bin}:"* ]]; then
	echo "提示：新终端若找不到 ibm-lab-agent，请把 ${XDG_BIN_HOME:-$HOME/.local/bin} 加入 PATH。"
fi
