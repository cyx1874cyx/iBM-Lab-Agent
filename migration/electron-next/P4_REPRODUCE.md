# P4 检查点复现

工作区：`H:/107-iBM-Agent/iBM-Agent/Code/iBM-Lab-Agent-electron-next`。
输出根：`H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4`。
本说明复现检查点，不代表全部 P4 门槛已通过。

## 固定资源与常规检查

Electron 为 P1 固定 NEXT checkout 下 `dsh-desktop-next/node_modules/electron/dist/electron.exe`（44.0.0）；Python 为 P4 `python-resource/python.exe`（3.12.11）。不运行会刷新 latest 的 NEXT 根构建脚本。

```powershell
node --test 'tests/unit/*.test.mjs' 'tests/integration/*.test.mjs'
node scripts/migration/compose-domain-bundles.mjs --check
node scripts/build-client.mjs --check
node node_modules/eslint/bin/eslint.js src/runtime lib/runtime.js lib/scientific-desktop.js electron-next scripts/migration/verify-scientific-desktop.mjs scripts/migration/open-scientific-session.mjs tests/integration/owned-processes.test.mjs --max-warnings=0
```

源码冻结复核：使用固定 Python 执行 `scripts/migration/freeze-electron-next-baseline.py --next-root H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next --check`。

`scripts/migration/prepare-portable-python.py --source <固定 P1 python.exe> --output <新目录>` 从精确 3.12.11 基底和已安装的核心包构造独立资源，拒绝覆盖已有目录。原生附加 wheel 按 `python/requirements-electron-native.lock` 安装到新资源，不更改核心锁。使用 `--seal-existing` 重新核验版本、模块归属和文件清单；该选项只更新资源 manifest，不重新复制目录。实际离线能力和路径迁移仍须分别检查，生成 manifest 不能替代它们。

## 实际 Electron 隔离验收

为每次运行指定新的输出目录，避免复用测试状态。

```powershell
node scripts/migration/verify-scientific-desktop.mjs --electron 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p1/next/dsh-desktop-next/node_modules/electron/dist/electron.exe' --python 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/python-resource/python.exe' --output 'H:/107-iBM-Agent/iBM-Agent/outputs/electron-next-p4/desktop-new-run'
```

验证器使用实际 Electron BrowserWindow、rc.2 Cordis/MCP client、本机系统加密和隔离 HTTP 夹具。测试持久 Cookie、POST 机构弹窗、目的地限制、真实下载回传、旧 DPAPI 合成凭据导入、捕获任务替换和窗口关闭。只有夹具地址可作为测试本机来源；产品默认不开放本机网络。

Origin/MestReNova 在这里仅验证工具发现和安装状态。真实机构入口仅验证可到达认证页；真实认证、软件许可证和业务工作流须另存证据。

## 真实机构验收

由用户明确授权后运行 `scripts/migration/open-scientific-session.mjs`，使用同样的 `--electron`、`--python` 与专用 `--output` 参数。该脚本是仓库内验收辅助入口，P5 仍需完成产品 UI 接线。

1. 用户在隔离科研窗口完成机构登录，从 WebVPN 进入数据库和目标文章。
2. 辅助入口的 `request.json` 接收唯一 `id` 的 `navigate`、`links`、`capture`、`stop` 请求。`capture` 提供 DOI、原文 URL 和 `kind`（`pdf`/`si`）；令牌保留在 Host 内存，不写入请求或传给页面。
3. 下载从当前机构网页或 PDF 预览触发。捕获完成事件不能替代内容检查：核验实际文件签名、页数、标题、DOI、字节数和 SHA-256，并对照 core 归档记录。
4. 正文与 SI 各发起独立任务；每个任务仅接收一次下载。重新捕获会作废该窗口的旧任务。
5. 导出证据只包含公共路径、标题和文件验证结果；不读取、导出或登记用户 Cookie、浏览器配置目录和凭据文件。
6. 用 `stop` 正常关闭验收 Host，确保 Electron 会话正常落盘。真实机构可能使用不可跨重启延续的会话 Cookie；不得承诺无需重新登录。

本次真实验收对应 `10.1126/scirobotics.aed1960`：正文 15 页、SI PDF 57 页，均已验证并归档。未下载单列的视频、数据文件和 MDAR 清单。

## 尚需执行

Origin 真实往返可用 `verify-origin-workflow.mjs --python <固定 python.exe> --output <新的验收目录>` 复现；先由用户启动 Origin MCP Bridge Start。验证器只添加、读取、导出并删除自己创建的唯一测试工作簿，不新建/覆盖用户当前项目，也不退出用户软件。

MestReNova 真实处理可用 `verify-mnova-workflow.mjs --python <固定 python.exe> --output <样例根>` 复现。样例根须包含 `synthetic/synthetic_1d.fid`、技能生成的 `synthetic/simulation_metadata.json`、`preflight.json`。模拟脚本与预检路径来自 `C:/Users/admin/.codex/skills/nmr-analyze-simulate`；固定随机种子与模型存于本次输出目录。验证器校验明确的 synthetic 标记和选定解释器，使用官方 rc.2 MCP client 执行处理，比较三个最强模型峰，检查导出及原始 FID 哈希。不能据此作真实样品身份或定量结论。

原生文件对话框及 PDF 预览需单独人工验证：`verify-native-file-dialogs.mjs --electron <固定 electron.exe> --python <固定 python.exe> --output <新目录> --pdf <专用测试 PDF>`。第一保存窗口取消，第二保存；之后观察独立预览、系统 PDF 打开和资源管理器定位。辅助入口达到 `await-user-preview-open-and-reveal-observation` 后，由实际用户观察填写 `confirmation.json` 的 `previewVisible/systemPdfOpened/fileRevealed`，不能预先填入成功。首轮等待对话框操作超时，已添加可见父窗口，待复测。

保留当前机构会话时不能重启它来应用代码修正；新版本的真实下载窗口行为应在下一次有意启动时验证。P4 尚未完整通过。
