# 文献下载流程交接：0.5.5-beta11

更新时间：2026-09-27（beta11 出包完成）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA10.md`（保留为历史记录）。

## 当前代码状态

- 分支：release-0.5.0
- 关键提交：`30269c4`（beta5 编译修复）、`3f587d2`（beta6）、`aa05571`（beta7 白屏真因）、
  `ba3b538`（beta8 验证页误判）、`e9f76a3`（beta9 原生 PDF 保存）、`83b348d`（beta10 加载完成才动手 + 小球队列）、
  `213a7be`（beta11 多地址栏 + 打开方式降级 + issue.md 四项）
- 版本号：0.5.5-beta11

## 本版四件事

1. **多条地址栏**：注入壳是初始化脚本，**每个 frame 都会执行**；publisher 页面的同源 iframe 各挂一套。
   现在 `if (window.top !== window.self) return;`，只在最外层文档挂。
2. **「无法获取应用列表」**：一句话根因 —— DSH 在 Windows 上用 PowerShell 调 `SHAssocEnumHandlers`
   枚举「打开方式」，DllImport 是 `PreserveSig = false`，而**这台机器上它对所有扩展名/路径都返回
   E_FAIL**（已用同一条命令独立复现），异常一路冒到会话远程 → 界面报错。
   修法：给**打包进安装包的 DSH** 打降级补丁（`scripts/patch-dsh-native-file-associations.mjs`）：
   枚举失败即当作"没有可用应用"，界面保留「在文件资源管理器里显示」——它走
   `explorer.exe /select,`，不含 COM，本来就可用。
3. **issue.md 的 O2/B2、B6、O5**：观察候选新增脱敏 `target` 与 `file`（Science 上三个同名
   `DOWNLOAD` 从此可分）；过滤 `Downloads: 981` 这类历史气泡；观察期 15 秒 → 2 分钟，并额外要求
   页面 URL 未变；状态暴露 `maxCaptureBytes` 且超限时直接说明可用
   `lab_tasks_update_bundle_file` 绕行。
4. **未做**：B1（自动化在 Science 的识别/评分）、B3（网络中断重试）、B5、B7/O6/O7、O4 —— 见发布说明的排队表。

## 两个必须记住的工程坑（本版各踩一次）

- **补丁不能放进"需要重铺才执行"的条件块**。`prepare-runtime.ps1` 里 DSH 只在指纹变化时才重铺，
  而补丁不改指纹 —— 第一次构建因此**悄悄发了一个未打补丁的 DSH**。现在补丁在两条路径上都对
  **正式树**执行：换入之后、以及"全部未变"提前返回之前。打包后务必用
  `grep -c "PreserveSig = true" resources/dsh/node_modules/@deepseek-ai/dsh-native-command/lib/index.js` 复核。
- **别把 `npm test | grep | head` 和 `&&` 串成一条命令**：`head` 提前关闭管道会让 `grep` 非零退出，
  整条 `&&` 链静默中断（本版两次：一次没提交、一次没启动构建）。分步执行，或看 `tail`。

## 排查要点（沿用）

- 白屏先量三件事：子窗口 z 序 / `WS_VISIBLE` / 表面颜色数，并同时量主 WebView 作对照。
- profile 是活证据：`Default/History`、`Default/Session Storage/000003.log`。
- 能在 Edge 里重放注入脚本就别改代码（`desktop/.build/inject-probe.mjs`）。
- 改版本号后必须跑**全量**单测（`release-version-consistency` 会核对 README）。
- `Session { ... }` 字面量（`status()` 内）在加字段后必须同步，否则 E0063。
- 生成的 `.ps1` 必须纯 ASCII。

## 尚未完成

- beta11 安装后的实测：三条见发布说明。
- issue.md 里排队的 B1/B3/B5/B7/O4/O6/O7。
- 八家出版社的已登录 iWAN 标定（全部仍 `pending`）。
