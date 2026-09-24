# DSH 0.1.7-rc.1 迁移评估（iBM Lab Agent）

> 评估对象：把本项目从当前锁定的 DeepSeek Harness `0.1.5-rc.1` 迁移到 `0.1.7-rc.1`。
> 结论均来自对两个版本 npm 发行物的实测（依赖闭包安装、逐文件哈希、补丁锚点实跑），
> 不是按 changelog 推断。未实测的部分在 §8 单独列出。

## 1. 结论摘要

**可以迁移，但这不是一次「跟随小版本」的动作。** 风险分布很不均匀：

| 面 | 占比 | 结论 |
|---|---|---|
| 插件主机代码（`lib/` + `src/`，47 处导入、8 个具名导出） | 大头 | **只需改 1 个文件**（剪贴板补丁）—— 核心依赖字节级未变 |
| **插件浏览器侧（`client/`）** | 小 | ❌ **1 处硬阻断** —— descriptor codec 字段改名，`$mount` 抛错，整个客户端失效 |
| 三处对 DSH 产物的就地补丁 | 小 | **1 处必须重做**，1 处只换哈希，1 处无需动 |
| agent preset 机制 | 中 | **必须改造** —— 目录约定被上游删除 |
| 版本/哈希钉子 | 小 | 机械替换，但散布 6 个文件 |

**三条最重要的事实：**

1. 本项目依赖最重的 `@deepseek-ai/dsh-storage-domain` **全部文件逐字节相同**（不只入口），
   `cordis` 的 `Service` 类体、`dsh-tools` 的 `defineTool`、`dsh-app-boot` 的四个 profile
   函数、`dsh-api-gateway` 的 source-mode descriptor 路径同样字节相同。47 处导入、
   8 个具名导出**全部存活**；26 行组合、18 个注入服务名**无一缺失**。
2. **但浏览器侧有 1 处硬阻断**：`ctx.remote.$mount` 的 descriptor codec 字段
   从 `schema` 改名为 `create`，本项目 276 个 strict codec **全部不合格**，
   `$mount` 抛错 → 客户端 `apply()` 整体 reject → 角标/侧栏/浮层全失效。（§3.4）
3. **agent preset 从「目录」改成了「组合树里的声明行」**，上游自带的
   `editing-cordis-compositions` 技能原文写着 *"Nothing reads that directory any more."* ——
   本项目的 `presets/lab-research/{preset.yml,agent.cordis.yml}` 安装模型在 0.1.7 上失效。

**工作量估计：5–8 人日**（含 Windows 出包验证）；若只做 Linux/Web 形态，**3–4 人日**。

### 1.1 最需要警惕的是「静默失效」而不是「编译/启动报错」

本次评估确认了**三处不会报错、只会安静丢功能**的失败，它们的破坏力大于任何 throw：

| 静默失效 | 现象 | 证据 |
|---|---|---|
| preset 目录契约被删 | roster 为空，会话照常启动但**不加载科研 Agent 行** | §4.1 |
| 默认预设写入路径作废 | 段被拒只记 warn，`settings.yaml` 还被改名 → **新会话不再默认科研 Agent** | §4.4 |
| 剪贴板补丁暂存探测恒假 | 不报错，只是**每次出包重拷整棵 DSH 树** | §3.3 |

所以迁移验收不能只看「能启动」，必须显式断言：preset roster 里有 `lab-research`、
新会话的默认预设是它、DSH 暂存缓存命中。

---

## 2. 版本事实

| 项 | 当前 | 目标 |
|---|---|---|
| DSH CLI | `0.1.5-rc.1` | `0.1.7-rc.1` |
| npm dist-tag | — | `next=0.1.7-rc.1`（**`latest` 仍是 `0.1.5-rc.3`**） |
| 依赖闭包规模 | 233 包 | **278 包** |
| 变化 | — | 新增 50、移除 5、版本变更 228 |
| cordis | 4.0.2 | 4.0.4 |
| zod | 4.5.4 | 4.6.5 |
| js-yaml | 4.3.2 | 4.3.2（不变） |

**被移除的包（5 个）：**
`dsh-agent-presets`、`dsh-code-runtime`、`dsh-code-runtime-worker-thread`、
`dsh-settings-file`、`dsh-workflow-worker-thread`

**改名/拆分：** `dsh-agent-presets` → `dsh-agent-preset` + `dsh-agent-preset-registry`
（已确认 `dsh-agent-preset` 成为 dsh 本体的直接依赖）

**关键包体积变化（`lib/index.js` 字节）：**

| 包 | 0.1.5-rc.3 | 0.1.7-rc.1 | 倍数 |
|---|---|---|---|
| `dsh-app-boot` | 69,668 | **181,291** | **2.60×** |
| `dsh-api-gateway` | 48,194 | 62,665 | 1.30× |
| `dsh-tools` | 151,784 | 157,824 | 1.04× |
| `dsh-agent-loop` | 71,267 | 71,150 | 1.00× |

> **基线口径说明（重要）。** 上表「当前」列取自一个**混合身份**的临时安装树
> （顶层 `@deepseek-ai/dsh` 实为 `0.1.5-rc.2`，嵌套子包为 `0.1.5-rc.3`），
> 它**不是**本项目的真实基线。本项目真实基线已直接实测：仓库 `node_modules` 解析到
> `dsh@0.1.5-rc.1`、`cordis@4.0.2`、`zod@4.5.4`，且与 `harness.lock.json` 记录的
> 值**逐项一致** —— 也就是说 **锁文件当前并不过期**，上表的 cordis/zod 变化是
> **本次迁移要引入的**，不是既存欠债。
>
> 这个口径差异有实际后果：剪贴板补丁（§3.3）在 rc.1 上锚点完好、在 rc.2 上已失效。
> 本项目之所以一直是绿的，正是因为锁死在 rc.1。任何「以前是好的」的结论都不能
> 从这个混合树读出。
>
> **rc.1 ↔ rc.3 的漂移已量化**：跨两棵树并集 **241 个包**逐文件比对，**所有 `lib/` 树
> 逐字节相同**（含本项目导入的全部 5 个包、3 个外部服务提供方、`dsh-agent-loop`）。
> 唯一漂移是 `dsh-web-frontend/dist/assets/index-*.js`、6 个 `dsh-client-ui-*` 的
> `lib/client.js` 与 `cosmokit` 新增的 `types/volatile.d.ts`。
> 也就是说：**§6 的主机 API 结论与基线取 rc.1 还是 rc.3 无关**；
> 唯一受基线口径影响的就是剪贴板补丁那一条。

### 2.1 战略选项：有没有更便宜的中间站？

有。`latest` 是 `0.1.5-rc.3`，与当前锁定同线：

- **只想「不落后」** → 升到 `0.1.5-rc.3`，是本表的极小集（无 preset 改造、无补丁重做）；
- **要 0.1.7 的能力**（PTC 运行期、`dsh-office-to-pdf`、`dsh-plugin-manager`、
  `dsh-client-ui-sidebar-browser`/`terminal`、`dsh-mcp-resources`、语音输入等 50 个新包）
  → 才需要走完整的 5–8 人日迁移。

建议先明确目标属于哪一类，再决定投入。

---

## 3. 产物级改动：三处就地补丁 + 一处客户端硬阻断

本项目对 DSH 发行产物做**就地改写**（这是最大的升级脆弱点）。实测结果：

| # | 补丁 | 目标文件 | 0.1.5-rc.1 | 0.1.7-rc.1 | 结论 |
|---|---|---|---|---|---|
| 1 | fake-`<invoke>` 自纠 | `dsh-agent-loop/lib/index.js` | `pristineAnchors=true` | **`pristineAnchors=true`** | ✅ 锚点存活，**只需换 sha256** |
| 2 | WebView2 cookie | `dsh-client-connection/lib/index.js` | `HttpOnly; SameSite=Strict` ×1 | **×1** | ✅ 无需改动 |
| 3 | 剪贴板回退 | `dsh-web-frontend/dist/assets/index-*.js` | `pristineAnchors=true` | **两个锚点全部消失** | ❌ **必须重新逆向** |

### 3.1 补丁 1 —— 只需换哈希

`src/dsh-runtime-patch.js` 的 `LAYOUTS` 锚点（制表符精确匹配）在 0.1.7 上仍然命中：

```
runtime/versions.env:18
- DSH_AGENT_LOOP_SHA256=257eb83c00a05ee068e9f4ba80ca71ab94e3a1275d24b7a0cf5038ff23dd0fd8
+ DSH_AGENT_LOOP_SHA256=c831f709b4ff86d855fdba0d60b32d32c7cbd0803ca058bea924e4e03639ff4f
```

（新值 = `@deepseek-ai/dsh-agent-loop@0.1.7-rc.1/lib/index.js` 的 sha256，已实测。）

涉及同样哈希的还有 `install.sh:239`、`dsh-agent-loop-fake-invoke-repatch.sh:19`
（两者都从 `runtime/versions.env` 取值，只改 env 一处即可）。

### 3.2 补丁 2 —— 无需改动

`desktop/scripts/prepare-runtime.ps1:395` 对 `dsh-client-connection` 的
`'HttpOnly; SameSite=Strict'` 做「出现次数必须恰好为 1」的断言后替换。
0.1.7-rc.1 上实测仍恰好 1 处，脚本不会 throw。

### 3.3 补丁 3 —— 必须重新推导（本项最费手）

`src/dsh-web-frontend-patch.js` 的两个锚点（`:9` `ORIGINAL_SHARED`、`:12` `ORIGINAL_JSON`）
在 0.1.7 的 `dist/assets/index-3dwByubT.js` 上**一个都匹配不到**。原因是压缩器变量重命名 +
上游重写了 JSON 复制路径：

| | 0.1.5 | 0.1.7 |
|---|---|---|
| 共享复制helper | `...writeText(t),!0}catch{return!1}const r=typeof document.execCommand` | `...writeText(e),!0}catch{return!1}const n=typeof document.execCommand` |
| JSON 树复制 | `try{await navigator.clipboard.writeText(rm(b,j)),$("copied")}catch{$("failed")}` | `try{await navigator.clipboard.writeText(w_(V,X)),G="copied"}catch{G="failed"}` |

**两点必须注意：**

1. 参数名 `t`→`e`、`r`→`n` 是压缩产物变化，锚点必须重取；建议照
   `src/dsh-runtime-patch.js` 的 `LAYOUTS` 多布局模式改，而不是原地替换常量。
2. **上游把「JSON 树复制」重写成了状态变量赋值（`G="copied"`/`G="failed"`），
   且依然没有 `execCommand` 回退** —— 也就是说本补丁要修的上游缺陷在 0.1.7 上
   依然存在，补丁仍然必要，只是形状变了。

同时要改 `tests/integration/harness-compatibility.test.mjs` 的
「clipboard fallback patch …」用例。

**受影响的消费方（不止一处 throw）：**

| 位置 | 后果 |
|---|---|
| `desktop/scripts/prepare-runtime.ps1:406-407` | 直接 `throw`，Windows 出包中止 |
| `desktop/scripts/prepare-runtime.ps1:239-252` `Test-DshWebFrontendPatch` | 常返 `false` → `Test-DshSnapshot` 永假 → **DSH 暂存缓存失效，每次出包重拷整棵 DSH 树**（约 3 万条目） |
| `tests/integration/harness-compatibility.test.mjs:37-50` | 断言失败 |
| `tests/unit/dsh-web-frontend-patch.test.mjs`、`tests/unit/windows-release-scripts.test.mjs:49-56` | 断言失败 |

> 也就是说这一项不只是「补丁打不上」，它还会**每次构建都触发全量重暂存**——
> 这是成本放大器，不只是功能缺陷。

> 顺带发现：该锚点在 `0.1.5-rc.2` 上**已经失效**（`SHARED` 在、`JSON` 已不在）。
> 换言之本项目当前之所以绿，是因为锁死在 `0.1.5-rc.1`。这条同线内的漂移说明
> 该补丁的维护成本应该被当作常态，而不是本次升级的一次性支出。

---

### 3.4 客户端硬阻断：descriptor codec 字段 `schema` → `create`

这一项**不在**上面三处「就地补丁」里 —— 它改的是本项目自己的 `client/` 代码，
但后果最严重：**浏览器侧整个插件不工作**。

**证据链（逐环实测）：**

| 环节 | rc.1（本仓库安装树） | 0.1.7-rc.1 |
|---|---|---|
| 类型 | `dsh-typert-protocol/lib/types/types.d.ts:155` `readonly schema: TypertSchema` | `:203` `readonly create: () => TypertSchema` |
| 校验 | `dsh-typert-registry/lib/client.js` `validateCodec`：`if (typeof codec.schema.parse !== "function") throw "… has no parse() method"` | 同函数：`if (typeof codec.create !== "function") throw "… has no create() factory"` |
| 本项目 | `client/src/descriptors.js:4-5`：`const pass = { parse: v => v }` → `{ mode:"strict", typeSymbol, schema: pass }` | **无 `create` 字段 → 校验抛错** |

**规模（用仓库自身的 `buildDescriptors()` 实测）：** **144 个 descriptor / 276 个 strict codec**，
其中 **0 个**有 `create()`、**276 个**有 `schema`。

**传播路径：** `client/src/apply.js:205` `await ctx.remote.$mount({package, descriptors})`
→ gateway `$mount` → typert `RemoteStore.register` → `DescriptorStore.validate` →
`validateCodec` 抛错 → 异常穿出 `await` → **客户端 `apply()` 整体 reject**。
角标、侧栏 tab、浮层全部不注册 —— 不是部分降级，是整个客户端没有。

**修复：** 单点一行 —— `client/src/descriptors.js:5`
`schema: pass` → `create: () => pass`，随后 `npm run build:client` 重新生成
`client/index.js`（当前它与源码同步，`--check` 通过，改完必须重建）。
`pass` 保留 `parse`，语义等价；且 0.1.7 客户端**今天没有任何调用 `codec.create()` 的代码点**
（只有宿主 `dsh-api-gateway/lib/index.js` 用），所以 `create` 只需是个能返回 `pass` 的工厂。

> **为什么前两轮审计都漏了它：** 主机侧审计只看 `lib/`+`src/`，把
> `TypertCodec schema → create` 判为「本项目未直接使用」——这对主机侧成立，
> 但这些 codec 是**手写在 `client/` 里**的；我在 §6 的安全面表也只核了客户端依赖
> 「包存在 + `./client` 导出 + `agentPresets.select` 存在」，没核 codec 契约。
> 两处范围盲区叠加，正好漏掉这一条。**这是本报告初版最严重的遗漏。**

### 3.5 次要项：侧栏 guide 条目缺 `id`

`client/src/webvpn-tab.js:117-121` 的 guide 条目 `{order,title,description}` 没有 `id`。
0.1.7 把 `SidebarRightGuideEntry.id` 变为**必填**，且 `register()` 对重复 id 抛错。
当前只有一个条目、`new Set([undefined]).size === 1`，所以**运行期不报错**；
属契约卫生问题，建议补 `id: "dsh-lab-agent/webvpn"`。

## 4. 必须改造：agent preset 机制（最大工程量）

### 4.1 事实

| | 0.1.5 | 0.1.7 |
|---|---|---|
| preset 存放 | `$DSH_HOME/.agent-presets/<id>/` + `preset.yml` + `agent.cordis.yml` | 组合树里的 `@deepseek-ai/dsh-agent-preset` 声明行 |
| 声明形式 | 目录（roster 扫描） | `config: { id, name, description, order, plugins: [...] }` |
| 默认 preset | `settings.yaml` 的 `agent-presets: default:` | `agent-preset-registry` 行的 `config.default` |
| 代码引用 `.agent-presets` | **11 处** | **0 处**（仅剩一份技能文档提及） |
| roster 服务 | `ctx.agentPresets`（`list`/`read`/`copy`/`standingKeyFor`） | `dsh-agent-preset-registry`；远程面保留 `list`/`read`/`select` |

上游 `@deepseek-ai/dsh-agent-preset/skills/editing-cordis-compositions/SKILL.md`
在 **"Migrate a legacy preset"** 一节明确写着：

> *"Before declaration rows, a user preset was a directory `$DSH_HOME/.agent-presets/<id>/`
> holding `preset.yml` … and `agent.cordis.yml` … **Nothing reads that directory any more.**"*

### 4.2 好消息：preset 内容本身不用重写

`presets/lab-research/agent.cordis.yml` 里 25 个 `name:` 全部在 0.1.7 上可解析
（17 个 `@deepseek-ai/*` + 7 个自有 `dsh-lab-agent/*` + `cordis:group`）。
也就是说 `agents.cordis.yml` 的**行列表可以逐字搬进 `plugins:`**，
`preset.yml` 的 `name`/`description`/`order` 映射到同名 config 字段。

### 4.3 受影响文件（全部已定位）

| 文件:行 | 现状 | 0.1.7 需要 |
|---|---|---|
| `presets/lab-research/preset.yml` | 目录元数据 | 并入声明行 `config.name/description/order` |
| `presets/lab-research/agent.cordis.yml` | 顶层行数组 | 变成声明行的 `config.plugins` |
| 新文件（bundle） | — | 需要一个 `dsh.bundle.patch` 指向的 patch 层 + `package.json` |
| `scripts/install.mjs:123` | `join(dsh, ".agent-presets", "lab-research")` | 改为安装 bundle / 写入 patch 层 |
| `scripts/configure-default-preset.mjs:18` | 写 `settings.yaml` 的 `agent-presets:` | **不是改写法，是整条路径作废**（见 §4.4） |
| `desktop/src-tauri/src/runtime/dsh.rs:186` | 物化到 `.agent-presets/lab-research` | 改为物化 bundle |
| `desktop/src-tauri/src/runtime/dsh.rs:375` | 断言 `agent.cordis.yml` | 断言新的 bundle 文件 |
| `scripts/linux-release-preflight.mjs:63-64` | 期望这两个文件存在 | 改为新 bundle 文件清单 |
| `desktop/scripts/verify-package.ps1:25` | 期望 `plugin\presets\lab-research\agent.cordis.yml` | 同上 |
| `tests/unit/linux-release-preflight.test.mjs:105` | 期望上述两个路径 | 同步 |
| `tests/unit/desktop-native.test.mjs:139` | 桌面原生路径断言 | 同步 |
| `scripts/check-preset-exports.mjs` | 扫描 `presets/**` 找 `dsh-lab-agent/` | ⚠️ 布局无关，**但只扫 `presets/`** —— 若把声明行挪进根 `cordis.patch.yml`，它会**静默扫不到**而报 OK |
| `tests/integration/preset.test.mjs:28-52` | 挂载已移除包，断言 `roots[].trust`、`resolve().path`、`read()` | **必须重写**：0.1.7 的 `AgentPreset = {id,name?,description?,order?,broken?}`，无 `trust`/`path`，读 API 变 `readDocument(id)` |
| `tests/unit/harness-surface.test.mjs:96` | `doesNotMatch(preset, /dsh-workflow-worker-thread/)` | 负向断言，仍通过但**已无意义**（包已移除） |
| `tests/unit/harness-surface.test.mjs:332` | 钉住 DSH 0.1.5 的首页 class `_titleGroup` | 需重新核对 |
| `tests/`（preset 相关） | 断言目录形态 | 需同步 |

### 4.4 `configure-default-preset.mjs` 是**双重失效**（本次审计新增确认）

该脚本把「新会话默认 lab-research」写进 `$DSH_HOME/settings.yaml` 的 `agent-presets:` 段
（`:18`、`:21`、`:36`）。在 0.1.7 上这条路**两个环节都断了**（均已实测）：

1. **文件本身会被改名消费掉。** 0.1.7 的 `@deepseek-ai/dsh-settings` 新增
   `importLegacyDocument()`：启动时把 `settings.yaml` **重命名为 `settings.yaml.imported`**，
   再按段名分发 `LEGACY_SECTION_ENTRIES[section] ?? section`。
   而 `LEGACY_SECTION_ENTRIES` 只有三项 —— `ui-developer-tools`、`ui-onboarding`、`shell`，
   **没有 `agent-presets` 映射**。于是段名原样落到 `agent-presets`，匹配不到任何可配置
   entry（0.1.7 的行 id 是 **`agent-preset-registry`**），抛
   `No configurable plugin entry "agent-presets"`，被 catch 成一条 warn 日志。
2. **即使命名空间写对也写不进去。** `dsh-agent-preset-registry` 的配置模式是
   `{ default: z.string().required(), selectedDefault: z.string().volatile(),
   modeSelectionEnabled: z.boolean().default(true).volatile() }` ——
   **`default` 不是 volatile**，而配置编辑器只接受 volatile 路径的写入，
   会抛 `Config field "default" is not volatile`。

**后果：** 安装器会**静默丢失**「新会话默认使用科研 Agent 预设」这一行为 ——
段被拒只记 warn，文件还被改名，事后很难看出发生过什么。

**正确做法：** 删除 `settings.yaml` 写入，改为在补丁层 **override `agent-preset-registry`
行的 `config.default: lab-research`**；同时重写
`tests/unit/configure-default-preset.test.mjs:11-24`（它现在把失效行为固化成断言）。

`agent-preset-registry` 的声明行在 0.1.7 的 `dsh-web-app/cordis.patch.yml:541-544`，
行 id 为 `agent-preset-registry`，`config.default: standard`。本项目 profile 的 bundle
顺序是 `[dsh-base, dsh-web-app, dsh-lab-agent]`，lab 补丁最后应用，因此 override 会生效。

---

## 5. 版本与哈希清单（逐条机械替换）

| # | 位置 | 现值 | 目标值 |
|---|---|---|---|
| 1 | `harness.lock.json:4` `cli` | `0.1.5-rc.1` | `0.1.7-rc.1` |
| 2 | `harness.lock.json` `packages` | 15 个包 @0.1.5-rc.1 | 重取（含移除 `dsh-agent-presets`） |
| 3 | `harness.lock.json` `recordedAt`/`notes` | — | 更新，notes 指向新评估文档 |
| 4 | `runtime/versions.env:5` | `DSH_VERSION=0.1.5-rc.1` | `0.1.7-rc.1` |
| 5 | `runtime/versions.env:18` | `257eb83c…` | `c831f709b4ff86d855fdba0d60b32d32c7cbd0803ca058bea924e4e03639ff4f` |
| 6 | `runtime/versions.env:4` | `IBM_LAB_AGENT_VERSION=0.5.3-beta8` | 新版本号 |
| 7 | `runtime/launcher/package.json:9` | `0.1.5-rc.1` | `0.1.7-rc.1` |
| 8 | `runtime/launcher/pnpm-lock.yaml` | 锁定 233 包 | **重新生成**（278 包） |
| 9 | `package.json` devDependencies | `@deepseek-ai/dsh@0.1.5-rc.1` | `0.1.7-rc.1` |
| 10 | `package.json:177-188` peerDependencies | 12 项 @0.1.5-rc.1 | 12 项 @0.1.7-rc.1 |
| 11 | `package-lock.json` | 含已移除包 | **重新生成**（硬门禁，见下） |
| 12 | `harness.lock.json:6,20` | `cordis 4.0.2` / `zod 4.5.4` | `4.0.4` / `4.6.5` |
| 13 | `pnpm-workspace.yaml:10-241` | **232 条** allowlist，全部 `@0.1.5-rc.1` | 整表重写；删 5 个已移除包，加 2 个新 preset 包 |
| 14 | `pnpm-workspace.yaml:17,84,85,175,239` | 引用 5 个已移除包 | 删行 |
| 15 | `desktop/src-tauri/src/runtime/mod.rs:115,176,268` | `0.1.5-rc.1` ×3 | `0.1.7-rc.1` |
| 16 | `desktop/scripts/prepare-runtime.ps1:601` | 版本横幅 | 同步 |
| 17 | `desktop/docs/release-manifest.json:3`、`desktop/docs/architecture.md:6`、`desktop/README.md:3`、`README.md:176` | 版本字面量 | 同步 |
| 18 | `desktop/docs/release-manifest.json` | 版本清单 | 同步（与 `package.json:3`、tauri/cargo 版本必须全等，`build-windows-release.ps1:210-224` 有断言） |

**两条硬门禁（不是「顺手」而是会直接中止）：**

- `install.sh:215` 用 `pnpm install --prod --frozen-lockfile` —— `runtime/launcher/pnpm-lock.yaml`
  不重新生成就直接失败（该文件 2164 行、含 4856 处 `0.1.5-rc.1`）。
- `install.sh:249` 用 `npm ci` —— `package-lock.json` 与 `package.json` 不同步就直接失败。

**一条成本放大：** `prepare-runtime.ps1:170-171` 把 `harness.lock.json` 的摘要算进
**DSH 暂存指纹**，所以改锁文件必然触发一次完整 DSH 重暂存（与 §3.3 的缓存失效叠加）。

> 提示：`@deepseek-ai/dsh` 的 `latest` 是 `0.1.5-rc.3`，而多数子包 `latest` 陈旧
> （`dsh-base` 的 latest 还指向 `0.0.1-rc.1`）。安装子包必须写精确版本，不能用 `latest`。
>
> `pnpm-workspace.yaml` 的 232 条 allowlist 疑似**惰性**（仓库内未设
> `minimumReleaseAge`，`.npmrc` 只有 node-linker/auto-install-peers）——
> 但**发布流水线是否在外部设置它未核实**，所以仍按需要更新处理。

---

## 6. 已实测的「安全面」（主机侧为主）

以下都是我逐个实测确认的，**不需要改动**，可用于收缩评审范围。

> ⚠️ **本表覆盖主机侧（`lib/`+`src/`）、组合层与依赖解析面，不覆盖 `client/` 的 codec 契约。**
> 那一处的硬阻断记在 §3.4。下表「客户端」两行只证明依赖与服务**存在**，
> **不构成「客户端可用」的结论** —— 初版曾据此误判客户端安全。

| 项 | 实测结果 |
|---|---|
| `dsh-storage-domain` | **全部文件字节相同**（不只入口）✅ |
| `dsh-session-projection` / `dsh-base` / `dsh-persona` / `dsh-tool-skill` / `dsh-storage` / `dsh-storage-json` | **字节相同** ✅ |
| `cordis` `Service` 类体 + `ctx.effect/on/get/logger` | **字节相同** ✅（24 处使用） |
| `defineTool`（7 处使用） | 签名与函数体相同，仅新增可选 `projectContent` ✅ |
| `Remote` / `TypertRemoteService`（`lib/remote.js`，146 处调用） | 实现字节相同 ✅ |
| `dsh-api-gateway` 的 source-mode descriptor 路径 | 字节相同 ✅ |
| `initProfile` / `readProfileManifest` / `resolveProfileDir` / `writeProfileManifest`（`src/ibm-lab-profile.js`） | 0.1.7 全部导出，实现相同／仅去掉未用的第 3 参 ✅ |
| `webServer`（`ctx.webServer.register`，8 处） | `index.d.ts` 字节相同 ✅ |
| `llm` + `llm/stream` waterfall（`lib/llm-diag.js`） | 类型与提供行均不变 ✅ |
| `dsh.client.inject` 6 个包 + peerDependencies 12 个包（共 18 个） | **18/18 解析成功**，浏览器模块均有 `./client` 导出 ✅ |
| 客户端 `ctx.remote.agentPresets.select(sessionId, presetId)` | **仍然存在** ✅（仅 `copy`/`deletePreset` 被 `create` 取代，本项目未用） |
| **`ctx.remote.$mount` 的 descriptor codec 契约** | ❌ **BREAKS** —— `schema` 改名 `create`，276 个 codec 全不合格（§3.4） |
| `cordis.patch.yml` 注入的 DSH 服务 `storageDomain` / `webServer` / `llm` | **全部仍然存在** ✅ |
| `cordis.patch.yml` 的 `- insert: [...]` 数组方言 | `PatchOptions.insert?: EntryOptions[]` **未变** ✅ |
| `package.json` 的 `dsh.bundle.patch` 单文件字符串 | 0.1.7 明确支持「单文件或有序文件列表」 ✅ |
| 自有 preset 的 25 个行 `name:` | **25/25 可解析** ✅ |
| `resolveProfileDir`/`initProfile`/`readProfileManifest`/`writeProfileManifest`/`composeEntries`/`loadOverlayPatches`/`boot()` 签名 | 0.1.7 **签名一致** ✅ → `src/ibm-lab-profile.js`、`scripts/ensure-ibm-lab-profile.mjs`、`tests/helpers/boot-lite.mjs:139` **无需 API 改动** |
| `profiles/<name>/package.json` + `cordis.patch.yml` 的 profile 契约 | **不变** ✅ |
| `dsh.client.inject` 6 个包的 `./client` 导出 | **6/6 存在** ✅（已逐包解析 `exports["./client"]`） |
| `DSH_HARNESS_NODE_MODULES` | 本项目自有约定，两棵 DSH 树中 **0 处引用** → 不受影响 ✅ |
| `--dump-config` / `dsh plugin add` CLI | 0.1.7 `dsh/lib/bin.js:76-86,114-121` 仍存在 ✅（`add <本地目录>` 语义未核实） |

**已知改名/删除但本项目未使用（landmine 清单，供未来排查）：**

| 项 | 0.1.7 变化 | 本项目 |
|---|---|---|
| `ctx.codeRuntime` | → **`ctx.ptcRuntime`**（唯一的宿主服务改名；`dsh-code-runtime*` 包被 `dsh-ptc-runtime*` 取代） | 未引用 ✅ |
| `dsh-system-prompt` `PromptSectionPriority.TOOL_CORDIS` | 常量被删 | 未导入 ✅ |
| `dsh-skill` `path` | 上移到 `SkillSummary` | 未用 `ctx.skills` ✅ |
| `dsh-app-boot` `healProfilesModuleFallback` / `DEFAULT_PROFILE_PATCH_RELOAD` / `assertEntriesLoaded` / `assertEntriesActivated` / `watchUserPatches` | 导出被删 | 未使用 ✅ |
| `dsh-package-manifest` `ProfilePatchReload` / `configTrees` / `sessionFormatMigration` / `moduleFallback` | 公开类型移除 | 未使用 ✅（组合层已由 `dsh.bundle.patch` 取代） |

**关于上游 issue 的澄清：** 有报告称 0.1.7 上「array patch 被拒」——经实测那是第三方
profile 诊断器（dsh-market #676）自己的 `typeof === 'string'` 假设过时，**真实 loader
完全支持数组**。本项目用的是单文件字符串，两种形态都不受影响。

---

## 7. 工作量估计与建议路径

### 7.1 分解

| 工作流 | 内容 | 人日 |
|---|---|---|
| A 版本与哈希 | §5 的 18 项 + 两个 lock 重新生成 | 0.5 |
| B 剪贴板补丁重推导 | 重新逆向 2 个压缩锚点 + 多布局化 + 改兼容性用例 + **真机验证复制行为** | 0.5–1.0 |
| **B2 客户端 codec 修复（阻断项）** | §3.4 一行改动 + `npm run build:client` + 客户端真机冒烟 | **0.25** |
| C preset 机制迁移 | §4.3 的 13 个文件，含 Rust 桌面路径与两条安装路径 | 2.0–3.0 |
| D 移除包清理 | `dsh-agent-presets` 等引用核对 | 0.5 |
| E 回归与出包 | 356 单测/集成 + 11 回归 + 7 浏览器 + client `--check` + Windows 全流水线 | 1.0–2.0 |
| **合计** | | **5–8 人日** |

仅 Linux/Web 形态（跳过 Rust 与 NSIS）约 **3–4 人日**。

### 7.2 建议分阶段路径

**阶段 0（1 小时，最先做）——组合层干跑。**
用 0.1.7 的 `dsh --profile <p> --dump-config` 加载本项目 `cordis.patch.yml` 与
迁移后的 preset 声明，先确认组合能不能成树。这是最早、最便宜的证伪点，
不要等到出包阶段才发现 layered 组合问题。
（注意 0.1.7 的 `dsh-web-app` 自身 `dsh.bundle.patch` 已从 1 个文件变成 **5 个文件**，
包含 `presets/{standard,ptc,minimal,cordis}.patch.yml`；本项目声明「在 dsh-web-app
补丁层之后应用」，顺序假设仍成立，但被组合的基底树变了，需重新核对。）

**阶段 1** A + B → 跑 `tests/integration/harness-compatibility.test.mjs` 转绿。

**阶段 2** C：先把 preset 声明跑通 Linux/Web 路径，再改 Rust 桌面路径。
`preset.yml`+`agent.cordis.yml` 的内容可逐字搬运，主要是**载体**改造。

**阶段 3** D + 全量门禁（`npm test`、`npm run regression`、`playwright` 浏览器、
`npm run check:client`）。注意：只要动了 `harness.lock.json`，
DSH 暂存指纹就会变，**首次出包必然全量重暂存**，属预期而非故障。

**阶段 4** Windows 出包 + `verify-package.ps1` 冒烟。注意 0.1.5 起 Web 面强制
process token（`verify-package.ps1` 已改为从启动横幅解析），0.1.7 需重新确认该
行为是否又变。

**阶段 5** 按 `docs/releases/v0.4.3.md` 的模板写新发布说明，并更新
`harness.lock.json` 的 `notes` 指针。

### 7.3 参照系

上一次 DSH 升级（`0.1.1-rc.2` → `0.1.5-rc.1`）的代价记录在
`docs/releases/v0.4.3.md`：客户端服务迁移（`sessions`/`workspaces` → `uiWorkspace`）、
Windows token 修复、注入面断言同步、浏览器验收 flake 修复，外加一次
`tauri-nsis` 14m31s + bundled-python 5m23s 的完整出包。
**本次在「代码改动量」上更小（核心 API 几乎全保），但在「载体改造」上更大
（preset 机制）。总量与上次同量级。**

---

## 8. 未验证项与残余风险

明确标注我**没有**实测的部分：

1. **没有真正用 0.1.7 启动过本插件。** 上述 API 面结论来自类型声明与导出比对，
   不是运行时验证。阶段 0 的 `dump-config` 干跑必须补上。
2. `dsh-app-boot` 体积涨到 2.60×。其 **profile 侧 API 已确认签名一致**（§6），
   但**语义**（`initProfile` 对 profile 目录/链接投影的行为）未逐行比对。
   桌面启动链路依赖它，仍属中风险。
3. `dsh-tool-todo` / `dsh-tool-web` / `dsh-tool-ask-user` 在我的 npm 安装树中随闭包存在，
   但**未确认真实 launcher 安装后仍在**（它们是否被 0.1.7 升级为可选包未核实）。
4. ~~未核对 0.1.7 是否仍读 `settings.yaml` 的 `agent-presets` 段~~ —— **已核实**：
   不读。`LEGACY_SECTION_ENTRIES` 无该映射，段名原样落到不存在的 entry 并被拒（§4.4）。
   剩余未知：被改名成 `settings.yaml.imported` 后是否有其它代码再读它（未发现）。
5. Rust 侧未编译验证；`desktop/` 的改动需要 Windows/WSL 构建机。
6. 补丁 3 的新锚点需要 WebView2 真机确认「复制可用」，压缩锚点重取本身可静态完成。
7. `dsh plugin add <本地目录>` 在 0.1.7 改为转发给 pnpm，**本地路径语义未核实**
   （`install.sh:306` 依赖它）。
8. `pnpm-workspace.yaml` 的 232 条 allowlist 是否真的惰性 —— 仓库内未设
   `minimumReleaseAge`，但**发布流水线是否在外部设置未核实**。
9. 生成型 lockfile 内的行号会随重新生成而漂移（本报告引用的行号以当前快照为准）。
10. 未核实 npm registry 是否仍提供 `@deepseek-ai/dsh-agent-presets@0.1.5-rc.1`
    （对回滚路径有影响）。
11. **`TabRecord` 自身的形状未知** —— `dsh-client-ui-dockkit` 在两棵树里都不存在，
    只核到了它的消费方契约（`useTabInfo` 的 props）。
12. `dsh-client-ui-slots` / `dsh-client-ui-dockkit` 的内部实现是 rc.3↔0.1.7 比对
    （rc.1 未安装这两个包），不是 rc.1↔0.1.7。
13. §3.4 的 `create: () => pass` 修复在**今天**行为充分（0.1.7 客户端无任何调用
    `codec.create()` 的代码点，只有宿主用）。若未来某个补丁开始在客户端 materialize
    codec，返回对象必须保留可用的 `parse`——`pass` 满足这一点。
14. `/root/ibm-lab/dist` 是发布产物（安装包/归档，未入 git），
    不在插件加载路径上（`package.json` `main` = `./lib/index.js`）——**已确认非问题**，
    不存在「陈旧构建副本」风险。

---

## 9. 附：一条维护性建议

补丁 3 的锚点在**同一条 `0.1.5` 线内**（rc.1 → rc.2）就已经失效，说明「压缩产物锚点」
的寿命远短于「源码锚点」（补丁 1 跨 0.1.5→0.1.7 仍存活）。建议：

- 把补丁 3 的锚点做成**多布局表**（照 `src/dsh-runtime-patch.js` 的 `LAYOUTS`），
  并在每次 DSH 升级时把旧锚点保留为「可识别但已过期」；
- 给 `harness-compatibility.test.mjs` 增加一条「锚点匹配失败时给出可操作报错」的断言，
  避免出包阶段才以 `throw` 形式暴露。

---

*评估方法：对 `@deepseek-ai/dsh@0.1.5-rc.2` 与 `@0.1.7-rc.1` 分别安装完整依赖闭包并逐一比对；
对 `dsh-agent-loop`、`dsh-web-frontend`、`dsh-client-connection` 直接实跑本项目
`src/dsh-*-patch.js` 的锚点探针；对 18 个声明依赖与 25 个 preset 行名逐个解析验证。*

---

# 执行记录：迁移已完成（2026-09-24）

本文件前九节是**迁移前的评估**，结论已被实际执行验证或修正。本节记录执行结果，
以及评估没写到、实施时才暴露的项。

## E1 评估结论中**被证实**的部分

| 评估项 | 实施结果 |
|---|---|
| §3.4 客户端 codec `schema`→`create` 是硬阻断 | ✅ 属实。改为 `create: () => pass` 后 `check:client` 通过；单测断言同步 |
| §4.1/§4.2 preset 内容可逐字搬进声明行 | ✅ 属实。319 行 `agent.cordis.yml` 直接缩进成 `config.plugins`，25 个行名全部可解析 |
| §4.4 `settings.yaml` 的 `agent-presets:` 段双重失效 | ✅ 属实。改为写 profile patch 覆盖 `agent-preset-registry.config.default` |
| §3.3 剪贴板补丁两个锚点在 0.1.7 全部消失 | ✅ 属实。新锚点与评估给出的形状一致（`tr`/`e`/`n`，`G="copied"`） |
| §3.1 fake-`<invoke>` 锚点存活、只需换 sha256 | ✅ 属实。`harness-compatibility` 用例对新哈希实测通过 |
| §6 主机侧 API 面全部存活 | ✅ 属实。493 单测 + 73 集成 + 11 回归全绿，无 API 缺失 |
| §7.2 阶段 0「先做组合干跑」 | ✅ 做了，且它是**唯一**能证明 preset 真能挂载的检查（见 E3） |

## E2 评估**没写到**、实施时才发现的三项

1. **0.1.7 把 DSH 内部依赖改成了 peerDependencies。** 评估只比对了两棵已装好的树，
   没有重跑安装命令。实际按旧命令
   `npm ci --omit=peer --legacy-peer-deps` 安装后，`cordis-plugin-group`、
   `dsh-sandbox` 等 26 个包缺失，`dsh-app-boot` / `dsh-tools` 直接
   `ERR_MODULE_NOT_FOUND`，任何 bootLite 用例都跑不起来。**这是比 preset 更早触发的
   阻断项**，修法是 `install.sh` 与两条 CI 工作流改成装 peer 的 `npm ci`。
2. **`Test-DshWebFrontendPatch` 的失效后果比评估写的更值钱。** 评估已经指出它会让
   DSH 暂存缓存失效，但没说清「两处锚点必然分叉」这一结构性原因——PowerShell 里
   复制了一份 JS 锚点。本版把它改成调用同一支 node CLI，消除了这个分叉源。
3. **`--dump-config` 通过 ≠ preset 可用。** Dump 只组合 patch 层，不激活
   `@deepseek-ai/dsh-agent-preset`。真正的验证必须启动宿主读
   `agentPresets.list()`；本版用一个临时 `--patch` 探针行完成（见 E3）。

## E3 决定性验证：真实 0.1.7 宿主挂载

以真实 0.1.7 依赖闭包建立 `ibm-lab` profile（`dsh-base` + `dsh-web-app` +
`dsh-lab-agent`，profile patch 写默认预设），叠加一个只读探针行后启动宿主：

```json
{"defaultId":"lab-research",
 "ids":["standard","ptc","minimal","cordis","lab-research"],
 "lab":{"id":"lab-research","name":"iBM科研Agent","order":10},
 "documentBytes":13373}
```

`lab-research` 的 `broken` 为 `undefined`，即声明里的每一行都在真实宿主里激活成功。
这条验证同时排除了四种失败：包解析不到、config 非法、行未激活、服务泄漏到 root realm。

## E4 与评估不同的取舍

- 评估 §4.3 设想把声明行「挪进根 `cordis.patch.yml`」；实施改为**新增第二个 patch 层**
  `presets/lab-research/preset.patch.yml`，并让 `dsh.bundle.patch` 变成有序列表。
  这样 `check-preset-exports.mjs`（只扫 `presets/`）继续覆盖得到，不会静默扫空。
- 评估建议把默认预设直接写进 bundle patch；实施改为写 **profile patch**。
  原因：bundle patch 是无条件的，写在那里会让 `--keep-default-preset` 这个已发布开关失效。
- 旧的 `preset.yml` / `agent.cordis.yml` 直接删除，而不是保留为「历史模板」——
  0.1.7 不再读它们，保留只会让人以为还能编辑。

## E5 残余验证（2026-09-24 已出包，状态更新）

1. ~~Windows 出包流水线~~ **已完成**：本环境是 WSL2（interop 可用），
   `scripts/windows-release-from-wsl.sh` 驱动 Windows 原生工具链跑完 11 个阶段，
   `release-report.json` 为 `publishable: true`，安装包 259,193,194 B /
   `C9B1567C…7D7F55B26`。Rust 侧由 `cargo`（Windows 原生）实际编译通过。
   期间修掉四个只在真出包时暴露的缺陷（见 `docs/releases/v0.5.3-beta9.md` 的
   「出包链路」一节）：根依赖不自动更新、半装树被放行、npmjs 从 Windows 不可达、
   以及剪贴板补丁缺分号导致补丁后前端语法错误。
2. WebView2 里「复制」的真实行为仍未验证（锚点重取是静态完成的；补丁后前端的语法
   已由 `node --check` + 集成测试守住）。
3. `dsh plugin --profile ibm-lab add <本地目录>` 在 0.1.7 的本地路径语义仍未走；
   本次用 profile + `node_modules` 软链等价复现了 composer 输入。
4. ~~产物体积与 SHA-256~~ **已测**：Windows 安装包 259,193,194 B（比 beta8 的
   172,150,786 B 大 50%），Linux 归档 24,122,035 B。体积增长已定位到 0.1.7 新增的
   `libreoffice-kit-win32-x64`（解包 325 MB，`office-to-pdf` 行启用所以必须随包）。
