[CmdletBinding()]
param(
	[Parameter(Position = 0)]
	[string]$Server = "vlab.ustc.edu.cn",

	[Parameter(Position = 1)]
	[string]$UserName = "ubuntu",

	[ValidateRange(1, 65535)]
	[int]$Port = 22,

	[string]$Ref = "main",

	[switch]$SkipSystemDeps
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Server)) {
	$Server = Read-Host "SSH 服务器地址（域名或 IP）"
}
if ([string]::IsNullOrWhiteSpace($UserName)) {
	$UserName = Read-Host "SSH 用户名"
}
if ([string]::IsNullOrWhiteSpace($Ref)) {
	$Ref = Read-Host "Git 分支、标签或提交 [main]"
	if ([string]::IsNullOrWhiteSpace($Ref)) {
		$Ref = "main"
	}
}

if ($Server -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') {
	throw "服务器地址格式不正确：$Server"
}
if ($UserName -notmatch '^[A-Za-z_][A-Za-z0-9_.-]*$') {
	throw "SSH 用户名格式不正确：$UserName"
}
if ($Ref -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or $Ref.Contains("..")) {
	throw "Git 分支、标签或提交格式不正确：$Ref"
}

$ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
if ($null -eq $ssh) {
	throw '未找到 Windows OpenSSH 客户端。请先在 Windows 可选功能中安装 OpenSSH 客户端。'
}

$skipSystemLine = if ($SkipSystemDeps) {
	'install_options+=(--skip-system-deps)'
} else {
	'# 保留系统依赖更新；sudo 凭据会由远端终端安全读取。'
}

$remoteScript = @'
set -Eeuo pipefail

repo="cyx1874cyx/iBM-Lab-Agent"
ref="__REF__"
launcher="${XDG_BIN_HOME:-$HOME/.local/bin}/ibm-lab-agent"
install_options=(--ref "$ref")
__SKIP_SYSTEM_LINE__

command -v curl >/dev/null 2>&1 || {
	echo "错误：服务器缺少 curl。" >&2
	exit 1
}
command -v base64 >/dev/null 2>&1 || {
	echo "错误：服务器缺少 base64/coreutils。" >&2
	exit 1
}

old_launcher=""
old_release=""
was_running=0
if [[ -e "$launcher" ]]; then
	old_launcher="$(readlink -f "$launcher" 2>/dev/null || true)"
	if [[ -n "$old_launcher" && -x "$old_launcher" ]]; then
		old_release="$(cd "$(dirname "$old_launcher")/.." && pwd)"
		if "$old_launcher" status >/dev/null 2>&1; then
			was_running=1
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
		echo "更新失败，正在尝试恢复并启动旧版本……" >&2
		if [[ -n "$old_release" ]]; then
			"$old_launcher" dsh plugin --profile web add "$old_release" || true
		fi
		"$old_launcher" start || true
	fi
	exit "$code"
}
trap rollback EXIT

if [[ " ${install_options[*]} " != *" --skip-system-deps "* && ${EUID:-$(id -u)} -ne 0 ]]; then
	command -v sudo >/dev/null 2>&1 || {
		echo "错误：更新系统依赖需要 sudo；也可以使用 -SkipSystemDeps。" >&2
		exit 1
	}
	echo "将验证 sudo 权限；如有提示，请输入服务器用户的 sudo 密码。"
	sudo -v
fi

installer_url="https://raw.githubusercontent.com/${repo}/${ref}/install.sh"
echo "下载 ${repo}@${ref} 的安装器……"
curl -fsSL --retry 3 --retry-all-errors "$installer_url" -o "$tmp_dir/install.sh"
chmod 700 "$tmp_dir/install.sh"

echo "安装新版本……"
bash "$tmp_dir/install.sh" "${install_options[@]}"

new_launcher="${XDG_BIN_HOME:-$HOME/.local/bin}/ibm-lab-agent"
[[ -x "$new_launcher" ]] || {
	echo "错误：安装完成后未找到启动入口：$new_launcher" >&2
	exit 1
}

echo "启动并检查服务……"
"$new_launcher" start
"$new_launcher" status
"$new_launcher" version

trap - EXIT
rm -rf -- "$tmp_dir"
echo "服务器更新完成。"
'@

$remoteScript = $remoteScript.Replace("__REF__", $Ref).Replace("__SKIP_SYSTEM_LINE__", $skipSystemLine)
$payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
$target = "$UserName@$Server"
$remoteCommand = "printf '%s' '$payload' | base64 -d | bash"

Write-Host "将通过 SSH 更新 $target`:$Port 到 $Ref。" -ForegroundColor Cyan
Write-Host "SSH 会直接提示输入登录密码；本脚本不会读取或保存密码。" -ForegroundColor Yellow

& $ssh.Source `
	-tt `
	-p $Port `
	-o "PreferredAuthentications=keyboard-interactive,password" `
	-o "PubkeyAuthentication=no" `
	$target `
	$remoteCommand

if ($LASTEXITCODE -ne 0) {
	throw "服务器更新失败，SSH 退出码：$LASTEXITCODE"
}
