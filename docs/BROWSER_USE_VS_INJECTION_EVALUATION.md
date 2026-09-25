# 用 browser-use 替代注入式捕获：可行性评估

> 评估日期：2026-09-25
> 问题：当前项目的文献获取自动化，能否改用 browser-use 做浏览器自动化、不再用「注入的方法」，
> 并配合实测的各出版社操作 Skill 完成文献下载？
>
> 评估对象：`lib/literature-sources.js`、`lib/literature-browser.js`、`lib/adapters/browser.js`、
> `lib/capabilities.js`、`lib/manual-capture.js`、`lib/capture-handoff.js`、
> `browser-extension/ibm-literature-capture/`、`desktop/src-tauri/src/webvpn.rs`、
> `vendor/nature-skills/skills/nature-downloader/`、`python/requirements.lock`。
> 标注「未实测」的是静态判断。

## 0. 结论先行

1. **这个提问里有一处前提需要先纠正**：当前的「注入」并不用来操作出版社页面。
   今天真正在出版社页面上点 PDF/SI 的是**用户本人**；注入只做两件事——
   在 loopback handoff 页布防一次性下载捕获（扩展），以及在软件内 WebVPN 浏览器里
   注入壳 UI（工具栏 + 捕获小球）。所以不是「用 browser-use 替代注入」，
   而是**新增一段今天由人承担的「页面操作」自动化**，注入与捕获层可以基本不动。
2. **browser-use 在技术上接得进来，但用它当主路径是错配**：你要适配的是 8 家
   已实测出版社的**固定步骤**，不是开放世界网页。LLM 驱动的浏览器 agent 会把你
   实测固化下来的确定性重新变成概率性，同时引入 Python/Chromium 打包、第二条
   LLM 出网通道、以及页面 DOM 外送三类新成本。
3. **「配合实测的出版社 Skill」这个想法成立，但要分清两种落地形态**：
   把 Skill 落成**声明式 adapter（选择器/步骤表）由确定性驱动层执行**，是最高性价比路线；
   把 Skill 当**给 LLM 的散文指导**交给 browser-use 即兴执行，会丢失你实测换来的可回归性。
4. **建议架构**：确定性的「出版社 adapter 驱动层」做**主路径**，沿用现有归档契约；
   browser-use 只作为 adapter 未命中时的**可选兜底**，默认关闭。
   若只想解决「点不到 PDF 入口」，甚至不必引入 browser-use —— 项目已有自写 CDP 客户端，
   把它从「启发式找链接」升级为「按出版社 adapter 执行」即可。

---

## 1. 「注入的方法」到底在做什么

项目今天有**三条互不相同的通道**（`lib/adapters/browser.js` 的语义矩阵），
「注入」这个词只对其中的两处成立，且都不是用来驱动出版社页面的：

| 通道 | 载体 | 「注入」指什么 | 出版社页面由谁操作 | 下载怎么回传 |
|---|---|---|---|---|
| `desktop-edge-handoff` | 系统 Chrome / Edge + MV3 扩展 | content script **只**注入 `127.0.0.1/localhost` 的 `/lab/capture/` handoff 页（`all_frames: false`），投递一次 `ARM_CAPTURE` 布防 | **用户本人** | `chrome.downloads` → Native Messaging → `PUT /api/lab-capture-upload` |
| `managed-edge` | 应用自己 spawn 的独立 Edge profile + CDP 端口 | 无扩展注入；直接 CDP 连 | **半自动**：`capturePublisherPdf` 用启发式打分挑 PDF 链接（`bestPdfCandidate`） | CDP `Network.getResponseBody` 取字节 |
| `web-current` | 宿主页所在浏览器当前标签 | 无 | 用户本人 | 无回传链 |

另有第四处注入，属于桌面壳内部：`desktop/src-tauri/src/webvpn.rs` 往软件内 WebView2
注入工具栏与「捕获小球」（交接文档 §2026-09-22）。它的作用是**让用户看见捕获阶段并可取消**，
不是驱动页面。

两条边界因此是清楚的：

- **扩展不向出版社/机构页面注入任何脚本**（`browser-extension/ibm-literature-capture/README.md:12`、
  `content.js:4-5`）——这是刻意的安全设计，不是能力缺失。
- **今天唯一存在的「自动化」是 `managed-edge` 那条 CDP 路径**，而它的能力上限是
  「按正则+文本打分挑一个最像 PDF 的链接然后导航过去」（`lib/literature-browser.js:158-176`）。
  它不会点「View PDF」进预览器、不会在预览器里点保存、不会处理 SI 的 DOCX/CIF/多附件——
  这恰好就是 `docs/PUBLISHER_NON_OA_TEST_CASES.md` 里逐条列的、目前只能人工完成的动作。

**这就是 browser-use（或任何页面自动化）真正要填的空白。** 空白是真实存在的，
只是它不在「注入」那一层。

## 2. browser-use 会替代哪一段

browser-use 是 Python 的 LLM 驱动浏览器 agent：`pip install browser-use`（Python 3.12 venv），
自带 Playwright 浏览器，**必须配一个 LLM**（默认指向它自己的 `ChatBrowserUse` 云模型，
也支持接自有模型）；支持通过 `cdp_url` 连接既有 Chrome（[quickstart](https://docs.browser-use.com/open-source/quickstart)、
[remote browser](https://docs.browser-use.com/open-source/customize/browser/remote)）。

把它放进现有分层，替代关系是：

```
今天的链路
  检索(OpenAlex/Crossref…) → 解析落地页 → [缺] 出版社页面操作 → 捕获 PDF 字节 → 校验/落盘/登记
                                            ↑
                                  人工点按钮（占 90% 工作量）
                                  或 managed-edge 的启发式（只对直链 PDF 有效）

browser-use 能替代的           保留不动的
  ── 出版社页面导航/找入口        ── 一次性令牌、Origin 校验、原子落盘、SHA-256
  ── 点开 PDF 预览器/保存         ── validatePdfBuffer（%PDF- / %%EOF / 大小）
  ── SI 附件枚举与逐个下载        ── registerCapturedFile 与 bundle 复用
  ── 意外弹窗/改版兜底            ── 状态机、审计、来源 provenance
```

即：**它替代的是「手」，不是「契约」。** 归档与凭据边界应当完全不动。

## 3. 可行性判据（五条，按阻断强度排序）

### 3.1 会话复用 —— 最硬的一条

机构授权的全部价值在登录态，而项目里登录态分布在两个 browser-use **接不到**的地方：

| 登录态位置 | 有 CDP 端口吗 | browser-use 能接吗 |
|---|---|---|
| 系统 Edge/Chrome（扩展通道，`edge-handoff`） | 没有 | ❌ `managedSession()` 显式排除 `edge-handoff` 与 `current-browser`（`lib/literature-sources.js:710-724`） |
| 软件内 WebVPN 子 WebView2（`webvpn-webview2` profile） | 没有（Tauri 侧非 CDP 端点） | ❌ |
| 应用自己 spawn 的受控 Edge（`managed-edge`） | 有 | ✅ 唯一可接的一条 |

后果直接命中 `vendor/.../nature-downloader/SKILL.md` 自己写下的 **Browser-state principle**：
「如果代理/CDP/自动化工具开了一个新 profile 或另一个浏览器而没有登录态，
不要把失败当成没有图书馆权限」。browser-use 默认行为正是「起一个自己的 Chromium」——
那会得到一篇又一篇的「未登录」，而这不是权限问题，是接错了浏览器。

要绕开，必须先把全链路收敛到 `managed-edge` 的单一 profile 上，并让用户在那个 profile 里
登录一次。这是**架构决策**，不是引入一个库就能解决的。

### 3.2 运行时与打包成本

- browser-use 是 Python 3.12 + Playwright + 自带 Chromium（数百 MB 量级），并要求 LLM API key。
- 本项目 Python 侧是**严格可复现 lock**：`python/requirements.lock` 固定到每个包的版本，
  且注释明确记录「不重新解析」的纪律与 Windows 捆绑解释器 3.12.10 / Linux 3.12.11 的对齐过程；
  新增依赖要重走一遍 CI 解析 + 双平台 wheel 核对。
- 桌面安装包体积、离线安装可行性、以及 Chromium 与 WebView2 两套内核并存，都是新的验证面。
- 相对地，Node 侧已有自写 CDP 客户端（`lib/literature-browser.js:74-133`）与
  `puppeteer-core`（目前仅为 devDependency，用于测试；要上生产需先提升为运行时依赖）。

**判断**：为「点几个固定按钮」付出一整个浏览器运行时 + 一条 Python 依赖链，性价比不高。

### 3.3 能力匹配：固定步骤 vs 开放世界

你实测的 8 家出版社（`docs/PUBLISHER_NON_OA_TEST_CASES.md`：Nature、SpringerLink、
Science/AAAS、Elsevier、ACS、RSC、IEEE、Wiley）的共同点是**操作序列固定**：
进文章页 → 找正文入口 → （部分）进 PDF 预览器 → 点保存 → 再回头抓 SI。
固定序列的正确工具是**选择器脚本**：毫秒级、可断言、可回归、失败时可精确定位到第几步。

browser-use 的优势场景是**没有预先映射过的页面**：它靠观察 DOM/截图逐步决策。
把它用在已映射页面上，等于用推理替换掉已经验证过的确定性——

- 每篇若干次多模态推理，几十秒到数分钟，token 成本随页面数线性上升；
- 同一篇论文两次运行可能走不同路径（对「审计留痕」和「失败可复现」都不友好）；
- 一旦失败，你得到的是「agent 说它卡住了」，而不是「第 3 步选择器在
  `sciencedirect.com` 新版页面上失效了」。

而且这条路已经有过教训：`nature-downloader` 的 reference 明确记着
「ScienceDirect 会因反复自动开 tab 触发 are-you-a-robot」，其对策是**一次一篇、
有界尝试两次、挑战交人**。探索式 agent 的点击倾向与这条纪律相反。

### 3.4 安全、合规与现有边界的冲突

| 现有边界 | 位置 | browser-use 带来的冲突 |
|---|---|---|
| 不向出版社/机构页面注入脚本 | 扩展 README、`content.js` | agent 必须在出版社页面执行脚本才能操作；需要重写这条声明的措辞与范围 |
| 不读取/导出 Cookie、localStorage、会话令牌 | `literature-sources.js` 头注释、`MANUAL_CAPTURE.md` | browser-use 靠 CDP 上下文工作，须明确禁止导出；但它把**页面 DOM 送进 LLM** —— 机构标识、检索历史、账户名可能一并出网 |
| `restrictedAutomation` 数据源不自动抓取/不向模型传输内容 | `src/literature/data-sources.js:171-179`（当前仅 SciFinder）、`literature-sources.js:772` | 需要把这条判据扩展到「是否允许把该站 DOM 送模型」的新维度 |
| 日志脱敏（去 fragment/凭据/不透明 query） | `webvpn.rs` 的 `redact_for_log` | 新增一条 LLM 出网通道，需要等价的脱敏/白名单 |
| 导航白名单 + 失败关闭 | `webvpn.rs` 的 `WebVpnPolicy` | agent 的可导航域必须同样受控；必须禁止顶层导航逃逸 |

另外两条非技术约束：出版社 ToS 对自动化的容忍度、以及「个人获取 ≠ 可再分发」的区分
（`nature-downloader` 的 reference 已把二者分开记录）。这两条不会因为是 LLM 驱动而变松。

### 3.5 可测试性

仓库有 113 个测试文件与明显的契约测试文化（`tests/unit`、`tests/integration` 里的
元测试会断言「某个 Rust 文件里不得出现某字面量」这类约束）。确定性 adapter 可以进单测与回归；
LLM 循环只能做「不崩」级别的冒烟，无法纳入 `npm test` 门禁。这是长期的维护成本差。

### 3.6 「配合我实测的出版社 Skill」在两种形态下的差别

browser-use 自己也有 Skills，但方向相反：它是把 `SKILL.md` 交给**编码 agent**，
教它怎么使用 browser-use（[skills overview](https://docs.browser-use.com/open-source/examples/skills/overview)）。
也就是说，你的出版社 Skill 在 browser-use 路线里会退化成**给 LLM 的散文指导**：

| | Skill 落成 adapter（确定性） | Skill 交给 browser-use |
|---|---|---|
| Skill 的形态 | 选择器/步骤表（数据） | 自然语言操作说明（提示词） |
| 你实测的固定步骤 | 逐字保留，可断言 | 由 LLM 每次重新解读 |
| 页面改版 | 改一行选择器 + 加一个回归用例 | 行为漂移，难以定位 |
| 失败信息 | 「第 3 步在 X 站超时」 | 「agent 未能完成任务」 |
| 测试门禁 | 可纳入 `npm test` | 只能冒烟 |

你实测的价值恰恰在「步骤被固定下来」，所以**应该把 Skill 当规格，而不是当提示词**。

## 4. 推荐架构

### 4.1 三层，而不是替换

```
① 出版社 adapter 驱动层（新增，主路径，确定性）
   每出版社一个声明式描述：入口选择器 / 预览器处理 / 保存动作 / SI 枚举规则 /
   期望产物类型（PDF|DOCX|CIF|MP4）/ 已知风控点
   驱动实现复用现有 CDP 客户端（Node），可选升级到 puppeteer-core

② 捕获与归档契约（完全不动）
   令牌 → 字节校验 → 原子落盘 → registerCapturedFile → 状态机/审计
   三条通道共用，与「谁驱动浏览器」正交

③ browser-use（可选兜底，默认关闭）
   仅当 ① 未命中适配器或页面结构异常时启用；
   跑在与 ① 相同的 CDP 会话上；有次数/时长上限；出网前做 DOM 白名单与脱敏
```

### 4.2 明确「可以动」与「不要动」

**可以动**

- 把 `bestPdfCandidate` 的单条启发式升级为按 host 分派的 adapter 表（这是收益最大的一步）。
- 把 `managed-edge` 从「辅助检索」提升为「主自动化通道」，并解决单一 profile 的登录收敛。
- 把 `docs/PUBLISHER_NON_OA_TEST_CASES.md` 里的人工检查点逐条转成 adapter 的断言。

**不要动**

- `lib/manual-capture.js` / `lib/capture-handoff.js` / 扩展 / Native Messaging / Tauri 下载回调：
  它们服务于「登录态在用户自己浏览器」这一无法回避的场景，删掉等于放弃一条合法通道。
- 软件内 WebVPN 浏览器与其壳注入：`docs/SIDEBAR_BROWSER_VS_LAB_BROWSER_EVALUATION.md`
  已经论证过「上游侧栏浏览器不是扩展宿主、`all_frames:false`、无下载观察能力」四道阻断，
  结论对 browser-use 同样适用——**换驱动方式不改变载体能力**。
- `validatePdfBuffer`、一次性令牌、`restrictedAutomation`、日志脱敏：安全边界与驱动选型无关。

### 4.3 如果仍要引入 browser-use，前置条件清单

按必要性排序，任一条不满足则不应进入实现：

1. 自动化浏览器的**登录态收敛到单一受控 profile**，且该 profile 有 CDP 端口（否则 3.1 直接否决）。
2. 明确 **DOM 出网白名单与脱敏规则**，并把 `restrictedAutomation` 扩展为「是否允许送模型」。
3. 完成 browser-use + Playwright + Chromium 的**双平台打包与离线安装验证**，
   并把依赖纳入 `python/requirements.lock` 的解析流程。
4. 定义 **成本/次数/时长上限**与「挑战交人」的交接点，与 `nature-downloader` 的
   `verification_auto_failed` / `publisher_verification_waiting_user` 状态语义对齐。
5. 明确它只做**兜底**：adapter 命中时不进入 LLM 路径，避免成本与不确定性扩散到主流程。

## 5. 待确认与未验证项

1. **用户实测的出版社 Skill 目前以什么形态存在**（SKILL.md 散文？脚本？录制的步骤？）。
   这直接决定 4.1 的 adapter 层是「改写」还是「翻译」。本次评估未能定位到这些文件。
2. 未验证 browser-use 通过 `cdp_url` 连接本项目 `managed-edge` 受控 Edge 的实际可用性
   （版本、`--remote-debugging-port` 参数、target 创建语义是否兼容）。
3. 未验证在 Tauri WebView2 上开启 CDP 的可行性（若可行，WebVPN 通道也能被自动化接管，
   但会与 `capabilities` 的权限收紧原则冲突）。
4. 未评估出版社 ToS 与学校授权条款对「自动点击下载」的具体约束，
   这一点必须由使用者确认，不能由实现方默认。
5. 未评估 `puppeteer-core` 提升为运行时依赖对安装包的影响（当前仅 devDependency）。

## 6. 一句话回答

**能接，但不该把主路径交给它。** 你要的「自动化出版社页面操作」是真实空白，
正确的填法是把实测 Skill 落成**确定性 adapter**、由 Node 侧 CDP 驱动，并沿用现有归档契约；
browser-use 适合作为未适配页面的兜底，而它替代不了「注入」——
因为注入本来就不负责操作出版社页面，它负责的是**捕获**，而捕获契约在三条通道上都应当保持不变。
