# 当前架构与 DSH 加载审计

审计对象：`iBM-Lab-Agent-release`，基线提交 `cef20ec18f9ca1dc639783bd0368510e230774cd`。

## 结论

iBM Lab Agent 是一个 DSH bundle，而不是独立 Web 前端。DSH 的 profile 依次组合
`dsh-base`、`dsh-web-app` 和本包的 `cordis.patch.yml`；DSH Web UI 再从本包的
`client/index.js` 加载浏览器扩展。因此 Desktop MVP 应当托管现有 Web UI，不应重写它。

新的专用 profile 名称为 `ibm-lab`。它的受管 bundle 顺序为：

```text
@deepseek-ai/dsh-base
  → @deepseek-ai/dsh-web-app
  → dsh-lab-agent
```

`scripts/ensure-ibm-lab-profile.mjs` 只创建或规范化此 profile，绝不改写共享的
`web` profile 或用户的全局设置。

## 插件入口与服务注册

- 主入口：[lib/index.js](../lib/index.js) 导出 `LabAgentService`，其构造函数调用
  `super(ctx, "labAgent")`。这是固定的 Cordis 服务名。
- bundle 入口：[cordis.patch.yml](../cordis.patch.yml) 只在 `lab-client` 行以裸包名
  `dsh-lab-agent` 加载这个主入口；同一 patch 还以子路径加载各个宿主服务，例如
  `dsh-lab-agent/tasks` 和 `dsh-lab-agent/remote`。
- Web 客户端入口：[client/index.js](../client/index.js) 通过
  `window.__ModuleLoader__.load({ id: "dsh-lab-agent", ... })` 注册实验室侧栏、
  课题空间和远程接口描述符。它并不再次注册 `labAgent` 服务。
- `presets/lab-research/agent.cordis.yml` 只挂载模型工具层；它不应再加载主 bundle。

## `service "labAgent" has been registered` 的原因与最小修复

错误是同一个 Cordis 上下文中两次实例化 `LabAgentService` 的直接结果。经当前源码
审计，bundle 自身只有一个 `lab-client` 载体；最可能的外部诱因是：

1. `dsh-lab-agent` 在 profile 的 `dsh.profile.bundles` 中出现两次；
2. 插件已经作为 bundle 安装，又在 profile 的 `cordis.patch.yml` 或命令行
   `--patch` 中再次 include 了同一个 `cordis.patch.yml`；
3. 插件同时被加入共享 `web` profile 和另一个自定义 profile，并在同一进程把两层
   都组合进来。

同时启动两个彼此独立的 DSH 进程不会单独造成此错误；错误要求相同的 Cordis 进程
重复装载服务。

最小修复是不改变任何服务名或插件实现，而是让 `ibm-lab` 成为唯一的运行 profile，
并使 `dsh-lab-agent` 在 bundle 列表中最多出现一次。安装器与启动器已改为使用
`ibm-lab`；`src/ibm-lab-profile.js` 会保留其他第三方 bundle，但会规范化 DSH Base、
DSH Web 与 Lab bundle 的顺序和去重结果。

## 配置与数据边界

- DSH profile：`$DSH_HOME/profiles/ibm-lab/`。
- 预设：`$DSH_HOME/.agent-presets/lab-research/`。
- 插件数据：`$DSH_HOME/lab-agent/`，包括 vendor、Python 环境、课题工作区、模板和
  storage 数据。
- 启动时不执行 npm/pnpm/pip 安装；这些只属于显式安装或升级阶段。

这一边界可直接映射到 Windows Desktop 的后续目录：程序内置 runtime 与 bundle，用户
数据迁移到 `%LOCALAPPDATA%\\iBM-Lab-Agent`，并以该目录作为独立的 `DSH_HOME`。
