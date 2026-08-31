# Phase 0：DSH + iBM Lab Agent 运行基线

状态：**PASS**（2026-08-30）。本阶段只建立可复现的 CLI/Web 基线；未开始
Tauri、内置 Windows runtime 或 NSIS 打包。

## 锁定版本

| 组件 | 版本/标识 | 来源 |
|---|---:|---|
| iBM Lab Agent | `0.1.3`，提交 `cef20ec18f9ca1dc639783bd0368510e230774cd` | `package.json` / Git |
| Node.js（本次验证） | `v24.19.0` | 验证运行时 |
| 发行版 Node.js | `v24.16.0` | `runtime/versions.env` |
| DSH CLI | `0.1.1-rc.2` | `harness.lock.json` / launcher manifest |
| DSH Base / Web | `0.1.1-rc.2` | `harness.lock.json` |
| Cordis | `4.0.1` | `harness.lock.json` |
| Nature Skills | `c171989db699bd601d4373912b3fb8db96ecc95b` | `vendor.lock.json` |
| js-yaml / zod（锁文件解析值） | `4.3.1` / `4.4.3` | `package-lock.json` |

生产安装器的 `runtime/launcher/package.json` 已将 `@deepseek-ai/dsh` 精确锁为
`0.1.1-rc.2`；不得改用 `npx @deepseek-ai/dsh@latest`。

## Profile 建立与启动

使用专用的 `$DSH_HOME`，避免读写默认或现有用户 profile：

```powershell
$env:DSH_HOME = "$env:LOCALAPPDATA\iBM-Lab-Agent\dsh"
node scripts/ensure-ibm-lab-profile.mjs --dsh-home $env:DSH_HOME
dsh plugin --profile ibm-lab add <iBM-Lab-Agent 的绝对路径>

dsh --profile ibm-lab --dump-config
dsh --profile ibm-lab --no-open --port 3080
```

只有 `dsh plugin ... add` 负责安装 bundle；后续启动**不得**再传
`--patch cordis.patch.yml`，因为该 patch 已由 bundle 层加载。重复传入会再次尝试
注册 `labAgent`。

`scripts/ensure-ibm-lab-profile.mjs` 的受管基础层为 DSH Base 和 DSH Web。DSH 的
plugin 管理器在插件成功安装后追加唯一的 `dsh-lab-agent` bundle；脚本再次运行会把
重复 bundle 规范化为一个。

## 已执行验证

| 验证 | 结果 |
|---|---|
| 134 个单元测试（含 profile 与 Windows CRLF 锁哈希覆盖） | PASS |
| 26 个既有集成测试 | PASS |
| 11 个回归用例 | PASS |
| 新 profile 规范化测试 | PASS |
| `dsh --profile ibm-lab --dump-config` | PASS：1 个 `dsh-lab-agent` 主入口，14 个 `dsh-lab-agent/*` 服务行 |
| Web 启动与 health check | PASS：自动分配的 `127.0.0.1` 端口返回 HTTP 200 |
| 受控 shutdown | PASS：验证用 DSH 子进程已终止 |

验证使用一个临时、隔离的 `DSH_HOME`，并为测试 profile 建立了本地插件链接；没有创建或
修改 `%USERPROFILE%\\.dsh`。

## 已知边界

- 当前仓库提供 Linux 发行脚本，尚未提供 Windows Tauri 壳、内置 Windows Node 或 NSIS
  安装程序。
- 本次 Web 验证使用开发环境的 DSH/Node；“干净 Windows 机器无 Node”验收属于
  Desktop runtime 内置阶段。
- 默认端口仍由现有 Linux 启动器配置为 `3080`；Windows Runtime Manager 阶段需要改为
  仅监听 `127.0.0.1` 的动态端口选择和 HTTP ready 轮询。

## 下一步

Phase 0 已满足进入 Desktop MVP 的前提。下一步应先分析 `myYangyunfan/dsh_desktop` 的
许可证、sidecar 启动、端口检测、WebView 导航和进程清理实现，再建立最小 Tauri 窗口；
不要在此之前开始 installer 或内置 runtime 工作。
