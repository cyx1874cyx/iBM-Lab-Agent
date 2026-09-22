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
