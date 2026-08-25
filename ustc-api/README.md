# 校外使用 USTC LLM API（SSH 隧道方案）

参考 ustcnic/ai 仓库中 `shares/zikangxu` 的教程改造而来，主要改进：

- Token 不写死在脚本里，改从环境变量 `.env` 读取（换 Key 不用改代码）
- 代理只监听 `127.0.0.1`，校内其他人无法蹭用你的 Token 额度
- 本地隧道做成 systemd 常驻服务，断线自动重连，开机自启
- 隧道只绑定本机回环口 `127.0.0.1:4000`，不暴露给局域网

## 架构

```
校外电脑(Linux)               校内虚拟机(跳板机)             USTC 服务
┌─────────────────┐   SSH -L   ┌────────────────────┐    ┌──────────────────┐
│ 任意客户端/脚本   │ 4000→4000 │ proxy-server.py    │    │ api.llm.ustc.edu.cn│
│ 指向             │ ════════▶ │ 监听 127.0.0.1:4000 │───▶│ (仅校内可达)      │
│ http://127.0.0.1 │  加密隧道  │ Token 在 .env 中    │    └──────────────────┘
│ :4000            │           └────────────────────┘
└─────────────────┘
```

## 文件清单

| 文件 | 放哪 | 作用 |
|---|---|---|
| `proxy-server.py` | 校内虚拟机 | 反向代理（改进了官方版） |
| `vm-setup.sh` | 校内虚拟机 | 一键建 venv、装依赖、写 .env、启动 |
| `ustc-tunnel.sh` | 校外电脑 WSL | expect 自动登录 vlab 并保持隧道（服务实际执行的命令） |
| `ustc-tunnel.service` | 校外电脑 WSL | SSH 隧道常驻服务 |
| `README.md` | 两边 | 本文档 |

## 前置条件

- 已从 <https://llm.ustc.edu.cn> 申请到 Token（`sk-xxx` 格式）
- 有一台校内虚拟机，且**校外可直接 SSH 连接**（教程用的是 vlab.ustc.edu.cn 申请的跳板机）
- 虚拟机上有 Python 3.10+（有 `uv` 更佳，没有也能装）

---

## Step 1 校外电脑：SSH 免密登录 + 主机别名

先用 `ssh-copy-id` 配置免密（systemd 服务里不能输密码），并在 `~/.ssh/config` 里加个别名，后续命令不用再写长地址：

```bash
# 1) 免密（首次会提示输入密码，即你登录虚拟机的学号/密码）
ssh-copy-id ubuntu@vlab.ustc.edu.cn

# 2) 编辑 ~/.ssh/config，追加：
# Host ustc-vm
#     HostName vlab.ustc.edu.cn
#     User ubuntu
#     ServerAliveInterval 30
#     ServerAliveCountMax 3

# 3) 验证：不需要密码能登录即成功
ssh ustc-vm
```

> 如果虚拟机不是 `ubuntu@vlab.ustc.edu.cn`，把别名里的 HostName/User 换成你的实际值。

## Step 2 上传文件到虚拟机并部署

```bash
# 在本目录执行（把 ustc-api 目录整个上传到虚拟机 home）
scp -r ustc-api ustc-vm:~/

# 登录虚拟机
ssh ustc-vm

# 部署（把 sk-xxx 换成你的真实 Token）
cd ~/ustc-api
chmod +x vm-setup.sh
./vm-setup.sh sk-xxx
```

脚本会：创建 `.venv` → 安装 `fastapi uvicorn httpx` → 把 Token 写进权限 600 的 `.env` → 用 tmux（或 nohup）启动代理，最后做一次自检。

看到 `HTTP 200` 就说明虚拟机侧已就绪：

```
==> 自检（等待服务就绪）
  HTTP 200 (非流式探测)
```

## Step 3 校外电脑：建立 SSH 隧道

先手动验证隧道可用（先不要装服务）：

```bash
ssh -NT -o UpdateHostKeys=no -o ExitOnForwardFailure=yes -L 127.0.0.1:4000:localhost:4000 ustc-vm
```

> **重要**：vlab 的自研 SSH 网关没有实现新版 OpenSSH 的 `hostkeys@openssh.com`
> 主机密钥证明机制，新版客户端（WSL 里的 OpenSSH 9.6+）会报
> `client_global_hostkeys_prove_confirm: server gave bad signature for RSA key 0`。
> 所有 ssh/scp 命令都要加 `-o UpdateHostKeys=no`。
> 如果还不行，用 Windows PowerShell 的旧版 ssh 建隧道（WSL2 与 Windows 的
> localhost 互通，隧道建在 Windows 上，WSL 里同样能访问 127.0.0.1:4000）。

另开一个终端验证：

```bash
curl -s http://127.0.0.1:4000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-any" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"deepseek-v4-flash-ascend","max_tokens":50,"messages":[{"role":"user","content":"say hi"}]}'
```

返回 JSON 响应即成功。（注意：客户端随便填 key 即可，真实 Token 在虚拟机 `.env` 里。）

## Step 4 隧道常驻（systemd + expect 自动登录，开机自启 + 断线重连）

> vlab 网关登录必须交互输入**学号+密码**（keyboard-interactive），systemd 没有终端，
> 所以用 `ustc-tunnel.sh`（expect 自动应答）代劳。服务运行时密码存于
> `~/.vlab-credentials`（权限 600）。

前置：安装 expect 并创建凭据文件：

```bash
sudo apt install -y expect
nano ~/.vlab-credentials        # 第一行学号，第二行 vlab 密码
chmod 600 ~/.vlab-credentials
```

安装服务：

```bash
sudo cp ustc-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ustc-tunnel

# 查看状态（Active: active (running) 即正常；日志里有 Permission denied 说明登录失败）
systemctl status ustc-tunnel
journalctl -u ustc-tunnel -f
```

之后每次开机自动连，断线由 `Restart=always` 自动拉起，无需 autossh。

> 不想存密码的替代方案：保留手动隧道窗口
> `ssh -NT -o UpdateHostKeys=no -L 127.0.0.1:4000:localhost:4000 ubuntu@vlab.ustc.edu.cn`
> 端口被占时改用其他端口：`USTC_TUNNEL_LOCAL_PORT=8080` 或改 `-L` 参数，
> 客户端 base_url 同步改成 `:8080`。

---

## Step 5 客户端接入

隧道建好后，所有客户端统一指向 `http://127.0.0.1:4000`，**API key 随便填**（或按各客户端要求填一个占位符）。

### 5.1 Python（OpenAI SDK）

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4000/v1",
    api_key="sk-anything",          # 占位即可
)

resp = client.chat.completions.create(
    model="deepseek-v4-flash-ascend",
    messages=[{"role": "user", "content": "你好"}],
    stream=False,
)
print(resp.choices[0].message.content)
```

### 5.2 Anthropic 协议（Claude Code，与官方教程一致）

在 CC-Switch 或环境变量里配置：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:4000"
export ANTHROPIC_MODEL="deepseek-v4-flash-ascend"
export ANTHROPIC_API_KEY="sk-anything"     # 占位
export ANTHROPIC_AUTH_TOKEN=""
```

### 5.3 curl（OpenAI 协议）

```bash
curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-anything" \
  -d '{"model":"deepseek-v4-flash-ascend","messages":[{"role":"user","content":"hi"}]}'
```

### 5.4 DSH（本环境）

隧道打通后，`http://127.0.0.1:4000` 就是一个标准 OpenAI 兼容端点。
若要把 DSH 的模型后端切到 USTC API（当前是 `deepseek-official`），
在 Harness 的 provider 配置里新增一个 OpenAI 兼容 provider、
`base_url` 填 `http://127.0.0.1:4000/v1` 即可，需要的话我可以帮你改配置。

---

## 日常维护

| 操作 | 命令 |
|---|---|
| 看虚拟机代理日志 | `ssh ustc-vm -t 'tmux attach -t ustc-proxy'`（Ctrl+b 然后 d 脱离） |
| 重启虚拟机代理 | `ssh ustc-vm -t 'tmux kill-session -t ustc-proxy; cd ~/ustc-api && ./start.sh'`（或用 tmux 重开） |
| 换 Token | `ssh ustc-vm -t 'sed -i "s/^USTC_API_KEY=.*/USTC_API_KEY=新key/" ~/ustc-api/.env'`，然后重启代理 |
| 看本地隧道状态 | `systemctl status ustc-tunnel` / `journalctl -u ustc-tunnel -f` |
| 停本地隧道 | `sudo systemctl stop ustc-tunnel` |

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 隧道 `Connection refused` | 虚拟机代理没起来：登录虚拟机跑自检；或端口被占，换端口 |
| `channel 3: open failed: connect failed` | 同上，确认 `start.sh` 在跑、监听 `127.0.0.1:4000` |
| systemd 服务反复重启 | 看 `journalctl -u ustc-tunnel`；多为免密未生效（重新 `ssh-copy-id`）或 `User=` 写错 |
| 401 / 403 | 虚拟机的 `.env` 里 Token 失效，去 llm.ustc.edu.cn 续期后重写 `.env` 并重启代理 |
| 响应超时 | `USTC_TIMEOUT` 默认 600 秒，深度思考模型长回答一般够用；仍超时则调大 `.env` 里的值 |
| 请求 404 | 确认路径带 `/v1`，且模型名正确（`deepseek-v4-flash-ascend` 等以官方页面为准） |

## 安全说明

- **Token 只存在虚拟机**，校外电脑和隧道里都没有真实 Key，泄露面最小
- 代理只监听 `127.0.0.1`，SSH 隧道也只绑定本机回环口，局域网不可见
- `.env` 权限 600，别提交到 git、别复制到公共机器
- 遵守学校 API 使用条款，不要公开分享 Token 或大量刷接口
