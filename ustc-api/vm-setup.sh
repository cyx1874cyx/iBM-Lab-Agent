#!/usr/bin/env bash
# ============================================================
# USTC LLM 代理 — 虚拟机（跳板机）侧一键部署脚本（支持多 Token）
#
# 用法（在虚拟机上，先 cd 到本脚本所在目录）：
#     ./vm-setup.sh sk-xxx1 [sk-xxx2 sk-xxx3 ...]   # 一个或多个 Token
#  或  export USTC_API_KEY=sk-xxx1
#      export USTC_EXTRA_KEYS=sk-xxx2,sk-xxx3 && ./vm-setup.sh
#
# 作用：创建 venv + 安装依赖(fastapi uvicorn httpx) + 写入 .env + 启动代理
# 代理仅监听 127.0.0.1:4000，校外通过 SSH 隧道访问。
# 多 Token 轮询：平分每分钟请求次数（USTC 每 key 约 20 RPM），降低限流。
# ============================================================
set -euo pipefail

if [ "$#" -eq 0 ] && [ -z "${USTC_API_KEY:-}" ]; then
  echo "用法: ./vm-setup.sh sk-xxx1 [sk-xxx2 ...]" >&2
  echo "      (或先 export USTC_API_KEY=sk-xxx1 再运行)" >&2
  exit 1
fi

# 收集 key 列表：命令行参数优先，环境变量兜底
KEYS=("$@")
if [ "${#KEYS[@]}" -eq 0 ]; then
  IFS=',' read -r -a KEYS <<< "${USTC_API_KEY},${USTC_EXTRA_KEYS:-}"
fi

# 去重、去空白
declare -A SEEN
UNIQ=()
for K in "${KEYS[@]}"; do
  K="$(echo -n "$K" | tr -d ' \r\n')"
  [ -z "$K" ] && continue
  if [ -z "${SEEN[$K]:-}" ]; then
    SEEN[$K]=1
    UNIQ+=("$K")
  fi
done
if [ "${#UNIQ[@]}" -eq 0 ]; then
  echo "错误: 没有有效的 API key" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f proxy-server.py ]; then
  echo "错误: 未找到 proxy-server.py，请把本目录完整上传到虚拟机再运行。" >&2
  exit 1
fi

echo "==> [1/4] 创建 Python 环境并安装依赖"
if command -v uv >/dev/null 2>&1; then
  uv venv .venv --python 3.12 2>/dev/null || uv venv .venv
  uv pip install --python .venv/bin/python --upgrade pip fastapi uvicorn httpx
else
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  ./.venv/bin/pip install -q fastapi uvicorn httpx
fi

echo "==> [2/4] 写入 .env（权限 600）"
umask 077
cat > .env <<EOF
USTC_API_KEY=${UNIQ[0]}
USTC_EXTRA_KEYS=$(IFS=,; echo -n "${UNIQ[*]:1}")
USTC_UPSTREAM_BASE=${USTC_UPSTREAM_BASE:-https://api.llm.ustc.edu.cn}
USTC_LISTEN_HOST=127.0.0.1
USTC_LISTEN_PORT=${USTC_LISTEN_PORT:-4000}
USTC_TIMEOUT=600
EOF

echo "==> [3/4] 生成启动脚本 start.sh"
cat > start.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a
source .env
set +a
exec ./.venv/bin/python proxy-server.py
EOF
chmod +x start.sh

echo "==> [4/4] 启动代理（优先 tmux，其次 nohup）"
if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t ustc-proxy 2>/dev/null || true
  tmux new-session -d -s ustc-proxy './start.sh'
  echo "    已用 tmux 启动，会话名: ustc-proxy"
  echo "    查看日志: tmux attach -t ustc-proxy   (Ctrl+b 然后 d 脱离)"
else
  pkill -f "ustc-proxy/start.sh" 2>/dev/null || true
  nohup ./start.sh > proxy.log 2>&1 &
  echo "    已用 nohup 启动，日志: tail -f ${SCRIPT_DIR}/proxy.log"
fi

echo ""
echo "==> 自检（等待服务就绪）"
sleep 2
PORT="${USTC_LISTEN_PORT:-4000}"
MODEL="${USTC_TEST_MODEL:-deepseek-v4-flash-ascend}"
curl -s -o /dev/null -w "  HTTP %{http_code} (非流式探测)\n" \
  -X POST "http://127.0.0.1:${PORT}/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: placeholder" \
  -H "anthropic-version: 2023-06-01" \
  -d "{\"model\":\"${MODEL}\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
  || echo "  (自检未通过，请查看上方日志)"

echo ""
echo "完成！下一步在校外电脑上建立 SSH 隧道："
echo "  ssh -NT -o UpdateHostKeys=no -L 127.0.0.1:4000:localhost:4000 ustc-vm"
