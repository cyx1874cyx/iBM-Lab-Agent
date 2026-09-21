#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

repo_slug="${IBM_LAB_AGENT_REPO:-qbdeng2025/iBM-Lab-Agent}"
# 默认安装当前主分支；正式复现发布时可显式传入 tag 或 commit。
source_ref="${IBM_LAB_AGENT_REF:-main}"
# 源码包下载前缀:默认 USTC GitLab 校内(服务器下载走校内网)。
# 如需切换到其他代码镜像,设置:
#   IBM_LAB_AGENT_ARCHIVE_PREFIX=https://example.edu/group/project/-/archive
archive_prefix="${IBM_LAB_AGENT_ARCHIVE_PREFIX:-https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/archive}"
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
  --ref <git-ref>          GitLab branch/tag/commit (default: main)
  --data-dir <path>        install root (default: ~/.local/share/ibm-lab-agent)
  --dsh-home <path>        DSH state root (default: ~/.dsh)
  --source-dir <path>      install from a local checkout (test/offline packaging)
  --skip-system-deps       do not invoke apt-get
  --no-python-extras       skip MarkItDown, PyMuPDF, python-pptx and RDKit
  --no-dsh-patch           do not apply the reversible fake-<invoke> compatibility patch
  --keep-default-preset    do not set new sessions to lab-research
  -h, --help               show this help

Environment:
  IBM_LAB_AGENT_PIP_INDEX_URL   pip 索引（默认清华源，与 Windows 构建脚本一致；
                                置空或指向校内镜像可覆盖）
  IBM_LAB_AGENT_ARCHIVE_PREFIX  源码包下载前缀（默认 USTC GitLab）
  IBM_LAB_AGENT_REF             默认安装的 git ref（默认 main）
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

# pip 镜像。Windows 构建脚本（desktop/scripts/build-bundled-python.ps1）默认就用清华源，
# Node 走 mirrors.ustc.edu.cn、pnpm 走 registry.npmmirror.com —— Linux 线此前**没有**
# 任何 pip 镜像，实测从 PyPI 直连只有 ~30 KB/s（600 MB 依赖要一个多小时，校内部署尤其
# 明显）。pip 自身读取 PIP_INDEX_URL，所以这里 export 一次即可覆盖本脚本的 pip 调用
# 与嵌套的 `node scripts/install.mjs`（labPython.bootstrap 里也是 pip），无需逐处透传。
# 需要时可用 IBM_LAB_AGENT_PIP_INDEX_URL 覆盖（例如指向校内镜像或走代理）。
pip_index_url="${IBM_LAB_AGENT_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple/}"
export PIP_INDEX_URL="$pip_index_url"

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

# 剥离第三方 wheel 自带的测试树：运行期不加载，但会占用可观的磁盘。
# Windows 线在 desktop/scripts/build-bundled-python.ps1 的
# "5) Strip caches / test artifacts" 做过同类清理，Linux 线此前没有对应步骤
# （实测 site-packages 内有 65 个 tests/test 目录，约 44 MB）。
#
# 只删名字**恰为** tests / test 的目录：numpy/testing、pandas.testing 是公共
# API，名字不同，必须保留；删完由调用方做 import 守卫断言。
strip_python_test_trees() {
	local python="$1"
	local site_packages
	site_packages="$("$python" -c 'import site; print(site.getsitepackages()[0])' 2>/dev/null)" || return 0
	[[ -d "$site_packages" ]] || return 0
	local before after
	before="$(du -sm "$site_packages" | cut -f1)"
	# find 在删除过程中可能因目录消失返回非零，属预期，不视为失败。
	find "$site_packages" -type d \( -name tests -o -name test \) -prune -exec rm -rf {} + 2>/dev/null || true
	find "$site_packages" -type f \( -name 'test_*.py' -o -name 'conftest.py' \) -delete 2>/dev/null || true
	after="$(du -sm "$site_packages" | cut -f1)"
	echo "已剥离第三方测试树：${before} MB → ${after} MB"
}

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
	curl --fail --location -C - --retry 3 --retry-all-errors --progress-bar \
		"${archive_prefix}/${source_ref}/iBM-Lab-Agent-${source_ref}.tar.gz" -o "$archive"
	mkdir -p "$tmp_root/unpack"
	tar -xzf "$archive" -C "$tmp_root/unpack"
	mapfile -t roots < <(find "$tmp_root/unpack" -mindepth 1 -maxdepth 1 -type d)
	[[ ${#roots[@]} -eq 1 ]] || { echo "GitLab 源码包结构异常" >&2; exit 1; }
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
	if ! command -v soffice >/dev/null 2>&1; then
		echo "警告：未找到 LibreOffice soffice —— 安装继续，但「文档预览」在此机器上不可用。" >&2
		echo "      需要时安装：sudo apt-get install -y libreoffice-core libreoffice-writer libreoffice-impress" >&2
	fi
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
	# Node.js 走 USTC 校内镜像(服务器就在 USTC,最快);路径结构与官方 nodejs.org 一致
	curl --fail --location -C - --retry 3 --retry-all-errors --progress-bar \
		"https://mirrors.ustc.edu.cn/node/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o "$node_archive"
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
	# pnpm:USTC 镜像站无 npm registry 镜像,用 npmmirror(国内,速度快)
	curl --fail --location -C - --retry 3 --retry-all-errors --progress-bar \
		"https://registry.npmmirror.com/pnpm/-/pnpm-${PNPM_VERSION}.tgz" -o "$pnpm_archive"
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
	curl --fail --location -C - --retry 3 --retry-all-errors --progress-bar "https://astral.sh/uv/${UV_VERSION}/install.sh" -o "$tmp_root/install-uv.sh"
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
	# 1) 格式依赖，全部精确 pin（markitdown 本体刻意不在锁内，见下方注释）
	"$venv_python" -m pip install --disable-pip-version-check \
		--report "$dsh_home/lab-agent/python-linux-install-report.json" \
		-r "$release_dir/python/requirements-linux.lock"
	# 2) markitdown 本体用 --no-deps 单独装：0.1.7 把 magika 列为**无条件**依赖，
	#    而 magika 要求 onnxruntime（实测 60.9 MB）。整条链只用于「按内容猜文件
	#    类型」，本插件却按扩展名显式判定（lib/convert.js 的白名单），故摘除。
	"$venv_python" -m pip install --disable-pip-version-check --no-deps 'markitdown==0.1.7'
	# 3) 让 magika 变成可选（幂等）：缺失时退回扩展名猜测，与 magika 报 unknown
	#    的行为等价。补丁带锚点 + sha256 校验，不认识的文件会拒绝修改。
	#    定位文件时**不能** import markitdown —— 补丁前它必然 ImportError（缺 magika）。
	markitdown_source="$("$venv_python" -c 'import site, os; print(os.path.join(site.getsitepackages()[0], "markitdown", "_markitdown.py"))')"
	[[ -f "$markitdown_source" ]] || { echo "未找到 markitdown 源文件：$markitdown_source" >&2; exit 1; }
	node "$release_dir/scripts/patch-markitdown.mjs" patch --target "$markitdown_source"
else
	echo "已按要求跳过 Linux Python 扩展。"
fi

# 基础锁（install.mjs 的 labPython.bootstrap）与 Linux extras 都已装完，
# 此时统一剥离一次第三方测试树。
strip_python_test_trees "$venv_python"

# 守卫断言：剥离后产品运行期真正用到的模块必须仍可导入。装了 extras 就一并断言
# 其提供的能力（裸装基础锁时 markitdown/fitz 等本就不存在，不能无条件断言）。
required_modules="scipy.signal, nmrglue, numpy, pandas, origin_mcp, yaml"
if [[ $install_python_extras -eq 1 ]]; then
	required_modules="markitdown, fitz, pptx, rdkit.Chem, $required_modules"
fi
"$venv_python" -c "import $required_modules" || {
	echo "剥离测试树后必需模块不可导入：$required_modules" >&2
	exit 1
}

# 补丁后的 smoke test：**构造** MarkItDown 才会走到被改写的 magika 分支，
# 只 import 是测不到的（__init__ 里那句 `magika.Magika() if magika is not None`）。
if [[ $install_python_extras -eq 1 ]]; then
	"$venv_python" -c "import markitdown; markitdown.MarkItDown()" || {
		echo "markitdown 在 magika 可选化后无法构造（补丁未生效？）" >&2
		exit 1
	}
fi

echo "[6/8] 创建独立 iBM Lab profile 并加入插件"
dsh_bin="$launcher_root/node_modules/.bin/dsh"
node "$tmp_root/source/scripts/ensure-ibm-lab-profile.mjs" --dsh-home "$dsh_home"
"$dsh_bin" plugin --profile ibm-lab add "$release_dir"
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

"$dsh_bin" --profile ibm-lab --dump-config > "$tmp_root/resolved-ibm-lab.yml"
grep -q 'dsh-lab-agent' "$tmp_root/resolved-ibm-lab.yml" || { echo "DSH 配置中未发现插件" >&2; exit 1; }
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
