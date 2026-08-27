# Linux 发行说明

## 支持范围

- Ubuntu / Debian，x86_64 或 arm64，glibc 环境。
- 服务只监听 DSH 默认回环地址 `127.0.0.1`，默认端口 `3080`。
- 安装阶段需要联网访问 GitHub、nodejs.org、npm、Astral Python 与 PyPI。
- 系统层仅安装 `runtime/apt-packages.txt` 中的 LibreOffice、PDF、字体及基础工具。
- Node、DSH、pnpm、uv、Python 与 Python 包全部位于用户目录。

## 一行安装

```bash
curl -fsSL https://raw.githubusercontent.com/cyx1874cyx/iBM-Lab-Agent/main/install.sh | bash -s -- --start
```

安装器先在临时目录完成下载和校验，再建立一个带时间戳的 release 目录；插件、
Python 环境和 DSH profile 全部验证成功后，才原子切换 `current` 软链接。重复运行
不会覆盖旧 release，因此失败时不会破坏上一次可运行版本。

## 目录布局

```text
~/.local/share/ibm-lab-agent/
├── current -> releases/0.1.4-<timestamp>/
├── releases/                       # 插件源码快照
└── runtime/
    ├── node -> node-v24.16.0-linux-<arch>/
    ├── launcher/                   # 固定版 DSH + pnpm
    ├── python/                     # uv 管理的 CPython 3.12
    └── python-bin/

~/.dsh/
├── profiles/web/                   # DSH Web profile
├── .agent-presets/lab-research/
└── lab-agent/                      # 项目、模板、venv、产物与版本登记
```

运行日志默认写入 `~/.local/state/ibm-lab-agent/dsh-web.log`。可分别通过
`IBM_LAB_AGENT_DATA_DIR`、`IBM_LAB_AGENT_STATE_DIR`、`DSH_HOME`、
`IBM_LAB_AGENT_PORT` 和 `IBM_LAB_AGENT_WORKSPACE` 改写这些位置。

## DSH 兼容补丁

发行版默认对锁定的 `dsh-agent-loop` 应用一个可逆兼容补丁：当模型把
`<invoke>` 错误输出为普通文本时，仅自动纠正重试一次。补丁前强制核对原文件
SHA-256，版本不匹配就拒绝修改，并在目标旁保存 `.ibm-lab-agent.bak`。
安装时传 `--no-dsh-patch` 可完全禁用。

## 升级、回滚与停止

- 升级：重新运行一行安装命令，或用 `--ref vX.Y.Z` 固定标签。
- 从 Windows 通过 SSH 交互式升级：在仓库根目录运行
  `powershell -ExecutionPolicy Bypass -File scripts/update-server.ps1`，按提示输入
  服务器地址、SSH 用户名和登录密码。脚本不会保存密码；它会停止旧服务、调用
  Linux 安装器、启动新版本并检查状态。可用 `-Port 端口`、`-Ref 分支或标签`
  和 `-SkipSystemDeps` 覆盖默认值。例如：

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/update-server.ps1 `
    -Server 192.0.2.10 -UserName labadmin -Ref main
  ```

  需要本地双击运行时，使用仓库根目录的 `update-server.cmd`。它会询问目标
  分支或标签并调用上述 PowerShell 脚本，执行完成后保留窗口供检查结果。

- 回滚：停止服务，把 `current` 软链接指回 `releases/` 内的旧版本，再对旧路径
  执行 `ibm-lab-agent dsh plugin --profile web add <旧版本绝对路径>`。
- 停止：`ibm-lab-agent stop`。
- 自检：`ibm-lab-agent doctor`，机器可读报告保存在
  `$DSH_HOME/lab-agent/doctor-linux.json`。

不要把 `$DSH_HOME/settings.yaml`、模型密钥、会话导出或 `.dsh-filess/` 提交到
Git。GitHub Release 附件提供 `SHA256SUMS`，可在安装前离线校验归档。
