# P3 复现

在迁移工作区执行，继续使用 P1 已冻结的 NEXT/内核及运行资源，不运行刷新 latest 的根构建。

```powershell
node --test "tests/unit/*.test.mjs" "tests/integration/*.test.mjs"
node --test tests/integration/domain-compositions.test.mjs
node scripts/migration/compose-domain-bundles.mjs --check
node scripts/build-client.mjs --check
py -3.12 scripts/migration/freeze-electron-next-baseline.py --check --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-plugin-assessment/dsh-desktop-v2.0.17-next'
pnpm --package='pnpm@10.34.5' dlx pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile
```

严格新增文件检查：

```powershell
node node_modules/eslint/bin/eslint.js lib/runtime.js lib/documents.js lib/design.js lib/analysis.js lib/domain-remotes.js lib/runtime-remote.js lib/documents-remote.js lib/literature-remote.js lib/design-remote.js lib/analysis-remote.js lib/core/history-files.js src/artifact-integrity.js src/contracts/artifact-events.js scripts/migration/compose-domain-bundles.mjs tests/integration/domain-compositions.test.mjs tests/unit/lab-runtime.test.mjs --max-warnings=0
```

真实宿主验收：

```powershell
node scripts/migration/verify-next-prototype.mjs `
  --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next' `
  --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p3/prototype' `
  --electron --exercise-domains `
  --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' `
  --python-runtime 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/python-runtime'
```

脚本使用新 home，官方 plugin runner 安装本地 link 包，验证完整科研预设、Python 转换、无头客户端、课题记忆与绑定。随后在该 home 中重启独立设计、独立分析、恢复领域、core-only、恢复完整组合。

成功条件：对应 run 的 verification.json 为 phase=P3、ok=true，包含 design-namespace-without-literature-documents-other-domain、analysis-namespace-without-literature-documents-other-domain、domain-namespaces-restored 及原 core-only/完整恢复验收项。脚本停止自己的 Host 与浏览器，保留证据，不操作用户 profile。
