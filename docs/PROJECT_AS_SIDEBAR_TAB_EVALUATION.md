# 评估：把课题主页面做成右侧栏的一种类型（每课题一标签页）

> 2026-09-22 · 起因：人工审核提出「把课题主页面做成侧边栏的一种类型，每个课题作为一个标签页」。
> 结论先行：**可行，但不能用「页面 tab」实现**——必须走「资源 tab + 每课题一个地址」。
> 真正的工作量不在 tab 注册，而在课题面板目前的**全屏 overlay 布局假设**。

## 一、硬约束：页面 tab 的身份只由 kind 决定

`@deepseek-ai/dsh-client-ui-sidebar-right` 里，页面 tab 的记录地址是：

```js
/** The address a page tab is recorded under: `sidebar://<kind>`. */
function pageAddress(kind) { return `sidebar://${kind}`; }
```

`placeTab()` 用 `pageAddress(kind)` 当 `contentId`，**完全不看 `params`**。而 tab 的
去重语义是「同一 (kind, contentId) 视为同一个 tab」。所以：

> 一个 `kind` 只能有一个页面 tab。用 `kind: "lab-project"` + `params: { projectId }`
> 打开第二个课题，只会**聚焦第一个课题的 tab**，不会新开一个。

这条直接否掉了「用页面类型 + 参数区分课题」的直觉做法。

## 二、三条可选路线

### 路线 A：单一「课题」页面 tab，正文内部自己切课题

一个 kind、一个 tab，正文里放课题列表/切换器。

- 工作量：小。与现有机制零冲突，`openTab("lab-project")` 即可。
- 缺点：不是「每课题一标签」，与需求字面不符。

### 路线 B：资源类型 + 每课题一个地址（满足「每课题一标签」）✅ 推荐

资源 tab 的 `contentId` **就是地址本身**，所以按课题拼地址就能得到每课题一个 tab：

```js
ctx.sidebarRightTabs.register({
  id: "dsh-lab-agent/project",
  kind: "lab-project",
  patterns: ["dsh-resource://lab-project/**"],   // 含 ":" → 匹配整条地址
  priority: "extension",
  title: (address) => "课题"                      // 打开时捕获；实时标题另走 title 座位
});
// 打开：
ctx.sidebarRight.openResource(`dsh-resource://lab-project/${projectId}`);
```

已核实的两点前提：

- `openResource` 要求地址落在 `dsh-resource://` 下，否则抛错；`patterns` 里带 `:` 的模式
  匹配整条地址——所以 `dsh-resource://lab-project/**` 是合法且够用的。
- `ctx.resources.pin(address, signal)` 对**未注册协议**的地址是安全的：它只是建一条
  `state: none` 的记录并持有，不会抛错。因此不必额外注册 provider；正文直接从
  `tab.contentId` 解析出 projectId 再调 `remote.lab.*` 即可。若将来想显示文件 stat 之类
  的元数据，再注册 provider。

需要注意的两个细节：

- **标题**：`title(address)` 在打开时被捕获进记录。要显示课题名，要么打开前先查一次课题
  列表（多一次往返），要么接受占位标题并注册 `sidebar.right.pane.tab.title` 座位做实时标题
  （该座位按类型的 `id` 注册，能读到 `tab.contentId`，可以异步解析名称）。
- **`useResource` 永远是 `none`**：正文不能依赖它拿数据，必须自己按地址里的 id 调 remote。

### 路线 C：不做侧栏类型，改成左侧栏/对话头部的课题切换器

最省事，但偏离「侧边栏的一种类型」的诉求，仅在 B 的布局改造被否时考虑。

## 三、真正的工作量：课题面板不是为窄列设计的

当前课题主页面是一个**全屏 overlay**：`client/src/apply.js` 的 `open()` 把
`OverlayBoundary` + `Panel` 渲染到 `document.body` 的一个新节点上，样式见
`client/src/styles.js`：

```css
.ib-overlay{position:fixed;inset:0;z-index:1000;overflow:auto;...}
```

它自带顶栏（`.ib-top`）、面包屑、`max-width:1260px` 的内容区，以及按 3 列排布的课题卡片、
两栏的文献/路线工作台。把它直接塞进约 360–560px 宽的侧栏列里会全面塌掉。

所以路线 B 的实际改造是**给课题界面做一套紧凑渲染**，而不是「把 Panel 挪个位置」：

| 工作项 | 说明 |
|---|---|
| 抽出可复用内容 | 把 `Panel` 里的课题视图拆成「数据 + 视图」，视图接受 `compact` 形态 |
| 紧凑布局 | 单列卡片、折叠的分区、去掉 `.ib-top`（侧栏已有 tab 条与面板控件） |
| 与对话的联动 | 「开始科研 Agent 对话」等按钮要能在侧栏里工作（当前会 `close()` 掉 overlay） |
| 状态来源 | 复用现有 `remote.lab` 调用，不新增 host 服务 |

粗估：路由 B 的 tab 注册部分约半天；紧凑视图改造是主要部分，取决于要保留多少板块。

## 四、结论与建议

1. **要「每课题一标签」就只能走资源类型（路线 B）**；页面类型做不到，这是框架语义决定的，
   不是实现选择。
2. 建议**分两步**：先按路线 B 把 tab 打开通路做通（用现有的简化内容占位），验证
   「一个课题一个 tab、切课题不串台」；确认交互合适后，再投入紧凑视图的改造。
3. 如果评审后认为「一个课题 tab + 内部切换」也能接受，路线 A 的成本低一个数量级，且不需要
   动 `Panel` 的布局。

---

## 五、已实施：路线 B 的步骤 1 + 步骤 2（2026-09-22）

按上面第 2 条落地了「通路」，并按人工审核的修正把**课题空间页面本身**放进了标签页。

**新增**

- `client/src/project-address.js` —— 寻址规则，**无 React 依赖**（`projectAddress` /
  `projectIdOf` / `PROJECT_PATTERNS`）。拆出来是为了让「每课题一标签」这条不变量能被
  Node 直接单测，而不是只存在于注释里。
- `client/src/project-tab.js` —— tab 类型（`patterns: ["dsh-resource://lab-project/**"]`）、
  正文、标题座位（把课题名写进标签条）、opener（`openResource(address)`）。
- `tests/unit/project-sidebar-tab.test.mjs` —— 5 条契约：地址往返（含空格/斜杠/中文/`%zz`）、
  类型互不侵吞、**用右侧栏真正使用的 picomatch 实测模式命中**、装配面必须走 `openResource`、
  以及「正文里嵌的是真正的课题空间页面」。

**入口：课题徽章本身**

对话头部右上角的课题徽章（`conversation.session.header.utilities`）点击即
`openProjectTab(project.id)`，直接在右侧栏开一个该课题的标签页；右侧栏服务不可用时才回落到
原来的全屏面板。上一版曾在徽章旁另挂一个按钮，人工审核指出「那个按钮」就是徽章本身，
已撤掉。

**正文：复用 `Project`，不另写一份**

侧栏 tab 里渲染的就是全屏面板里的那一页 `Project`（`← 所有课题 / 核心记忆 / 删除课题 /
开始科研 Agent 对话 / 文献资料 / 研究设计 / 表征分析`），只是套一层
`.ib-overlay.ib-panel-embed`：

- **不走 `Panel`**：它用 `ReactDOM.createPortal(..., document.body)` 渲染全屏 overlay 外壳，
  天生进不了侧栏列。
- **两个类一起用**（`.ib-overlay.ib-panel-embed`）把 `.ib-overlay` 的
  `position:fixed;inset:0;z-index:1000` 压掉——双类优先级 0,2,0 高于单类 0,1,0，不依赖
  书写顺序。
- 多列栅格（`.ib-lit`/`.ib-artifacts`/`.ib-memory`/`.ib-grid`/`.ib-tabs`/`.ib-db-grid`）
  在嵌入模式下收敛成单列。**必须用容器类而不是媒体查询**：侧栏是窄列，但视口可能是宽的，
  `@media(max-width:…)` 在这里永远不会命中。
- `Project` 只用到 `project.id`（名称等由它自己 `projects_workspace` 加载），所以正文不必先
  预取一次课题；预取只用于标签条的课题名。

**标题为什么要单独一个座位**：`title(address)` 在打开时被捕获，而它是同步接口、课题名要查
一次 remote。因此用一个模块级名称缓存 + 订阅：正文与标题座位谁先拿到名字都能让另一边更新；
标题座位对未激活的 tab 也会渲染，所以它自己会触发一次加载。

**仍未做**

- 课题列表侧入口：目前只能从「已绑定课题」的徽章进入；从课题列表点某个课题直接开 tab，
  需要在卡片上加同款入口。
- 嵌入模式的视觉打磨：现在是把全屏页按单列塞进窄列，`项目记忆.md` 编辑器、合成路线工作台
  这类宽内容还需要逐一确认（见发布说明的真机验收清单）。


