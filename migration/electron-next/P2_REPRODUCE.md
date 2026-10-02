# P2 复现

复用 P1 已验证的固定 NEXT、Electron 44.0.0、内核 0.2.0-rc.2、Python 3.12.11 与依赖锁。不要运行刷新 latest 的 NEXT 根构建命令。以下在迁移工作区执行。

```powershell
node --test "tests/unit/*.test.mjs" "tests/integration/*.test.mjs"
node node_modules/eslint/bin/eslint.js lib/core lib/repositories src/contracts lib/tasks/index.js lib/tasks/projects.js lib/tasks/provenance.js lib/remote.js src/goal-profile.js src/task-models.js tests/helpers/boot-lite.mjs tests/integration/core.test.mjs scripts/migration/verify-next-prototype.mjs --max-warnings=0
node scripts/build-client.mjs --check
py -3.12 scripts/migration/freeze-electron-next-baseline.py --check --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/dsh-desktop-v2.0.17-next'
pnpm --package='pnpm@10.34.5' dlx pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile
```

真实宿主验证：

```powershell
node scripts/migration/verify-next-prototype.mjs `
  --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next' `
  --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p2/prototype' `
  --electron --exercise-core `
  --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' `
  --python-runtime 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/python-runtime'
```

脚本固定检查输入版本，通过官方 NEXT plugin runner 离线安装本地 `link:` 包，创建新 profile/home 和浏览器配置。先验收完整科研组合，再在该新 profile 中停用业务并重启，验证 core-only API，最后恢复原配置再重启。登录凭据不写入证据。

仅当对应 run 目录的 `verification.json` 中 `phase: P2`、`ok: true`，且包含 `core-only-host-history-create-memory-delete-and-feature-error` 与 `full-workflows-restored-without-data-loss` 两项时，代表真实组合验收通过。原型在退出时停止自己的宿主和无头浏览器，保留本次 home 与证据，不操作用户已有 profile。

定向验证为 `node --test tests/integration/core.test.mjs`。这 3 个用例实际启动 rc.2 存储/Cordis/Gateway，不以 mock 替代 core 的生命周期、持久化或兼容入口。
