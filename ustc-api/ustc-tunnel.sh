#!/usr/bin/env bash
# ============================================================
# USTC LLM 隧道 — expect 自动应答 vlab 交互式登录
#
# 背景：vlab.ustc.edu.cn 是 USTC 自研 SSH 网关，登录时需交互输入
#       学号 + 密码（keyboard-interactive）。systemd 服务没有终端，
#       因此用 expect 自动应答，随后无限保持隧道。
#
# 关键修复（相对早期版本）：
#  1. 不再用 90 秒超时杀死连接。旧脚本登录成功后隧道静默，expect 把
#     "静默"误判为超时，每 90 秒杀掉一次健康连接 —— 这就是反复"卡"的根因。
#     新脚本：登录阶段有界；进入保持阶段后无限等待 eof，只有 ssh 真正
#     断线才退出，由 systemd Restart=always + RestartSec=2 快速拉起。
#  2. 发送密码/学号期间 log_user 0 关闭回显，防密码明文写进 journal。
#
# 依赖: sudo apt install -y expect
# 凭据: ~/.vlab-credentials （第一行学号，第二行密码；chmod 600）
# 可选: 环境变量 USTC_TUNNEL_LOCAL_PORT 覆盖本地端口（默认 4000）
# ============================================================
set -euo pipefail

CREDS="${HOME}/.vlab-credentials"
LOCAL_PORT="${USTC_TUNNEL_LOCAL_PORT:-4000}"

if [ ! -f "$CREDS" ]; then
  echo "错误: 缺少凭据文件 ${CREDS}" >&2
  echo "  第一行写学号，第二行写 vlab 密码，然后执行: chmod 600 ${CREDS}" >&2
  exit 1
fi
if ! command -v expect >/dev/null 2>&1; then
  echo "错误: 未安装 expect，请执行: sudo apt install -y expect" >&2
  exit 1
fi

export STUDENT_ID VLAB_PASS LOCAL_PORT
STUDENT_ID="$(head -1 "$CREDS" | tr -d '\r\n')"
VLAB_PASS="$(sed -n '2p' "$CREDS" | tr -d '\r\n')"

exec expect <<'EOF'

set student_id $env(STUDENT_ID)
set vlab_pass  $env(VLAB_PASS)
set local_port $env(LOCAL_PORT)
set quiet 0

spawn ssh -NT -o UpdateHostKeys=no \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=2 \
  -o StrictHostKeyChecking=accept-new \
  -L 127.0.0.1:${local_port}:localhost:4000 \
  ubuntu@vlab.ustc.edu.cn

# ---------- 阶段一：登录（有界 45 秒，静默即视为已连接） ----------
set timeout 45
while {1} {
  expect {
    -re "Are you sure you want to continue connecting.*" {
      send -- "yes\r"
    }
    -re "Vlab username.*Student ID" {
      if {!$quiet} { log_user 0; set quiet 1 }
      send -- "$student_id\r"
    }
    -re "Vlab password" {
      if {!$quiet} { log_user 0; set quiet 1 }
      send -- "$vlab_pass\r"
    }
    -re "assword" {
      if {!$quiet} { log_user 0; set quiet 1 }
      send -- "$vlab_pass\r"
    }
    -re "Address already in use" {
      send_user "错误: 本地端口 ${local_port} 被占用\n"
      exit 2
    }
    -re "Permission denied|access denied|Connection refused" {
      send_user "错误: vlab 登录被拒绝或连接失败\n"
      exit 4
    }
    timeout {
      # 45 秒内没有任何提示 = 已完成认证、进入静默转发状态
      send_user "info: 隧道已建立，进入保持阶段\n"
      break
    }
    eof {
      send_user "错误: ssh 提前退出（退出码未知）\n"
      exit 4
    }
  }
}

# ---------- 阶段二：保持（无限等待，不因静默退出） ----------
log_user 0
set timeout -1
expect eof
exit 0
EOF
