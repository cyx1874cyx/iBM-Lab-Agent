# P1 复现说明

在迁移工作区执行。每次验证建立新的独立 home，保留输出，不连接用户已有 home。以下是本机已验证路径；换机器时需替换为自己的绝对路径。

## 已准备环境中的一键验证

```powershell
node scripts/migration/verify-next-prototype.mjs `
  --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next' `
  --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/prototype' `
  --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' `
  --python-runtime 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/python-runtime' `
  --electron

& 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/python-runtime/Scripts/python.exe' `
  scripts/migration/verify-python-runtime.py `
  --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/scientific-runtime'
```

去掉 `--electron` 可验证 Node Host；去掉 `--browser` 只检查 Host/Remote/持久化，不能替代最终客户端验收。去掉 `--python-runtime` 不验证科研运行时。最终 P1 PASS 使用全部参数。

脚本使用 NEXT 官方 Profile 和 plugin runner 安装 `link:` 本地单包；不复制旧 node_modules，也不额外持久化 NEXT 的动态 layer。输出 `verification.json` 中 `ok: true` 才代表本次通过。Host 登录 token 在输出和保存日志中脱敏。

## 从固定输入准备

1. 检出 P0 固定的 NEXT 提交及其内核子模块 pin；保持两者源码干净。完整源码下载受限时可使用稀疏检出，但构建和测试所需文件必须存在。不得直接运行刷新 latest 的根构建脚本。
2. 使用 Yarn 4.18.0 执行固定锁安装，然后直接运行 NEXT workspace 的 `build`、`typecheck`、`test` 和 `verify:frontend`。
3. 在 iBM 迁移工作区使用 pnpm 10.34.5 执行冻结锁安装，并运行 `node scripts/build-client.mjs`。
4. 将 CPython 3.12.11 安装至独立资源目录，建立独立 venv，以基线 `python/requirements.lock` 安装科研依赖。不要使用系统 Python 代替目标解释器。
5. 按基线 Windows recipe 安装 MarkItDown 与其转换依赖；从固定 vendor/mnova-mcp 安装 Mnova MCP 0.3.1。运行既有 `patch-markitdown.mjs`，必须通过原文件 hash 校验。原型脚本将该 venv 连接到新 home 的 lab-agent/.venv，不把 Python 环境变量当作桌面能力。
6. 显式安装 Electron 44.0.0 的运行制品。下载镜像可以替换，但不能关闭固定 npm 包内的 checksums 校验。

本机缺少 Corepack，临时使用固定的 `@yarnpkg/cli-dist@4.18.0` 执行 Yarn，没有改变全局工具：

```powershell
pnpm --package='@yarnpkg/cli-dist@4.18.0' dlx yarn --cwd '<NEXT 根目录>' install --immutable
pnpm --package='@yarnpkg/cli-dist@4.18.0' dlx yarn --cwd '<NEXT 根目录>' workspace dsh-desktop-next build
pnpm --package='pnpm@10.34.5' dlx pnpm install --frozen-lockfile
```

完整版本、关键制品指纹、实际验证路径及范围见 [P1_VERIFICATION.json](P1_VERIFICATION.json)。正式离线安装、自动更新和旧数据迁移的复现条件将在 P4/P6 补充。
