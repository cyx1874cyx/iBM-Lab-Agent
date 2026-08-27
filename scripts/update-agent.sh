#!/usr/bin/env bash
# iBM Lab Agent - 服务器端更新脚本(纯 bash,可独立运行,也可被 Windows 启动器远程调用)
# 用法: bash update-agent.sh [--ref <branch/tag>] [--skip-system-deps]
set -Eeuo pipefail

REPO="cyx1874cyx/iBM-Lab-Agent"
REF="main"
INSTALLER_REF="main"
SKIP_SYSTEM_DEPS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      REF="${2:-main}"
      shift 2
      ;;
    --ref=*)
      REF="${1#--ref=}"
      shift
      ;;
    --installer-ref)
      INSTALLER_REF="${2:-main}"
      shift 2
      ;;
    --installer-ref=*)
      INSTALLER_REF="${1#--installer-ref=}"
      shift
      ;;
    --skip-system-deps)
      SKIP_SYSTEM_DEPS=1
      shift
      ;;
    *)
      echo "未知参数: $1" >&2
      shift
      ;;
  esac
done

LAUNCHER="${XDG_BIN_HOME:-$HOME/.local/bin}/ibm-lab-agent"

echo "==> 目标: $REPO@$REF"
echo "==> 启动器: $LAUNCHER"

command -v curl >/dev/null 2>&1 || { echo "错误:服务器缺少 curl。" >&2; exit 1; }
command -v base64 >/dev/null 2>&1 || { echo "错误:服务器缺少 base64/coreutils。" >&2; exit 1; }

# 停掉正在运行的旧服务(更新前),并记录用于失败回滚
old_launcher=""
old_release=""
was_running=0
if [[ -e "$LAUNCHER" ]]; then
  old_launcher="$(readlink -f "$LAUNCHER" 2>/dev/null || true)"
  if [[ -n "$old_launcher" && -x "$old_launcher" ]]; then
    old_release="$(cd "$(dirname "$old_launcher")/.." && pwd)"
    if "$old_launcher" status >/dev/null 2>&1; then
      was_running=1
      echo "==> 停止旧服务..."
      "$old_launcher" stop
    fi
  fi
fi

tmp_dir="$(mktemp -d)"
rollback() {
  code=$?
  trap - EXIT
  rm -rf -- "$tmp_dir"
  if [[ $code -ne 0 && $was_running -eq 1 && -x "$old_launcher" ]]; then
    echo "==> 更新失败,正在尝试恢复并启动旧版本……" >&2
    if [[ -n "$old_release" ]]; then
      "$old_launcher" dsh plugin --profile web add "$old_release" || true
    fi
    "$old_launcher" start || true
  fi
  exit "$code"
}
trap rollback EXIT

# 系统依赖:非 root 且未跳过时验证 sudo
if [[ $SKIP_SYSTEM_DEPS -eq 0 && ${EUID:-$(id -u)} -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || { echo "错误:更新系统依赖需要 sudo;可加 --skip-system-deps。" >&2; exit 1; }
  echo "==> 验证 sudo 权限(如有提示,请输入服务器用户的 sudo 密码)"
  sudo -v
fi

installer_url="https://raw.githubusercontent.com/${REPO}/${INSTALLER_REF}/install.sh?cache=$RANDOM"
echo "==> 下载安装器 ${REPO}@${INSTALLER_REF} ..."
curl -fL --progress-bar --retry 3 --retry-all-errors "$installer_url" -o "$tmp_dir/install.sh"
chmod 700 "$tmp_dir/install.sh"

echo "==> 安装新版本..."
install_options=(--ref "$REF")
if [[ $SKIP_SYSTEM_DEPS -eq 1 ]]; then
  install_options+=(--skip-system-deps)
fi
bash "$tmp_dir/install.sh" "${install_options[@]}"

new_launcher="${XDG_BIN_HOME:-$HOME/.local/bin}/ibm-lab-agent"
[[ -x "$new_launcher" ]] || { echo "错误:安装完成后未找到启动入口:$new_launcher" >&2; exit 1; }

echo "==> 启动并检查服务..."
"$new_launcher" start
"$new_launcher" status
"$new_launcher" version

trap - EXIT
rm -rf -- "$tmp_dir"
echo "==> 服务器更新完成"
