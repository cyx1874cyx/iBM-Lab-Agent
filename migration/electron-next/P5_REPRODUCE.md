# P5 检查点复现

在 `H:/107-iBM-Agent/iBM-Agent/Code/iBM-Lab-Agent-electron-next` 执行。只使用新 home，不对旧业务数据运行。

```powershell
node scripts/build-client.mjs
node scripts/migration/compose-domain-bundles.mjs --check
node scripts/migration/build-domain-packages.mjs
node scripts/migration/build-domain-packages.mjs --check
node --test 'tests/unit/*.test.mjs' 'tests/integration/*.test.mjs'
node scripts/migration/verify-next-bundles.mjs --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next' --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p5/new-run' --electron --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
```

验证器创建隔离 NEXT profile 和浏览器配置，安装本地 link 包，通过 Remote 做在线停用和恢复，检查记忆，关闭自身测试浏览器，并要求 Host 按 NEXT 原有的 10 秒期限正常退出。首次引导只在该隔离浏览器点击“继续”和“稍后配置”，不配置真实 API Key。

`p5-isolated-host.mjs` 复用固定 NEXT 的隔离 fixture。仅在 shutdown 后 8 秒仍运行时记录活动句柄的类型、事件名称和是否监听，不输出句柄内容、路径、Cookie、凭据或环境值；诊断不强行关闭未知资源。版本更新只修改 staging 的 UI 包元数据并回退，不修改源包版本。测试 package runner 使用 link 与已安装开发依赖，不是 tgz 安装证明。

本地制品：逐包执行 `pnpm -C packages/dsh-lab-core pack --pack-destination <新制品目录>`，替换成七个包名分别打包，然后运行：

```powershell
python scripts/migration/verify-domain-archives.py --directory '<制品目录>'
```

七个包依赖固定共享库，但不得同时激活该库的完整兼容 bundle。完整发行前仍需部署共享实现、锁定离线依赖与 Python/Skills 资源，并验证干净环境安装。

科研桌面接线验收仍只使用隔离目录，不测试暂缓的保存弹窗：

```powershell
node scripts/migration/verify-desktop-client-actions.mjs --electron 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next/dsh-desktop-next/node_modules/electron/dist/electron.exe' --python 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/python-resource/python.exe' --pdf 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/file-dialogs/sample.pdf' --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p5/new-native-actions'
node scripts/migration/verify-next-bundles.mjs --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next' --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p5/new-native-ui' --electron --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' --scientific-ui --python 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/python-resource/python.exe'
```

第二个验证器会在新 profile 内配置隐藏的隔离 Electron 科研窗口，以本机 HTTP 页面验证正式按钮；不复用真实机构认证。文件动作接口样例中的保存取消使用传输替身，不是原生弹窗显示证明。

带记录的课题 UI 和持久化验收：

```powershell
node scripts/migration/verify-next-bundles.mjs --next-root 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next' --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p5/new-populated-run' --electron --browser 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' --scientific-ui --python 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/python-resource/python.exe' --populated --pdf 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/file-dialogs/sample.pdf'
node --test tests/integration/domain-compositions.test.mjs
```

`p5-populated-fixture.mjs` 只由验证器复制到独立测试包并显式插入该隔离 profile。不能直接用其源码 file URL 注册到产品，避免 NEXT 按所在兼容包推导客户端而重复加载。样例创建后不重复覆盖数据，插件停用/恢复及 Host 重启不把已修改条目重置。验证器不会提交模型任务、人工审核决策或执行 Origin/Mnova。
