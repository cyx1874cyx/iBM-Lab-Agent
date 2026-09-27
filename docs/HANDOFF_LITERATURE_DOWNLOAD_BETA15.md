# 文献下载流程交接：0.5.5-beta15

更新时间：2026-09-27（beta15 出包中）

上一份：`docs/HANDOFF_LITERATURE_DOWNLOAD_BETA14.md`（保留为历史记录）。

## 本版主线：保存入口（R1）

新增两个「保存到课题」入口，**都调同一条实现**：`save_current_pdf`（等终态 + 归档前
头/尾/大小三道校验）。不要在任一新入口里另写一份归档逻辑。

| 入口 | 位置 | 依赖 |
|---|---|---|
| A 页内浮层 | 文档右下角（壳注入，`__ibm_webvpn_save`） | 脚本注入到当前文档 |
| B 侧栏按钮 | 右侧栏「文献浏览器」tab 工具行 | 无（DSH 自己渲染） |

### 一条被实测推翻的旧假设

以前代码注释与交接里写着「原生 PDF 查看器的注入脚本不执行」。**这是错的**：
`oobserve(原生 PDF)` 能返回 `documentType/readyState`，说明脚本在那个文档里跑完了；
缺的只是"查看器 UI 不在 DOM 里，没有可点元素"。

动手前用 Edge 内建查看器（与 WebView2 同引擎同查看器）跑过探针，结论：

- 注入的 `position:fixed` 元素**画在 PDF 之上**，`elementFromPoint` 也命中它；
- `{有无 html transform} × {popover / 普通 fixed} × {左/右}` 五格矩阵，
  **每一格**都收到 trusted 的 pointer/mouse/click；
- 探针脚本在 `H:\build\overlay-probe\`（`probe.mjs` / `probe2.mjs` / `probe3.mjs`），
  改壳内实现前可以拿它先验证，比改完再猜便宜得多。

### 两条必须守住的约束

1. **PDF 页会被施加 `html{transform:translateY(76px)}`**（`__ibmWebVpnSetPageOffset`，
   为了露出查看器自带的工具栏）。这个 transform 会让 `position:fixed` 的后代改以
   `html` 为包含块 —— 浮层会跟着页面滚走。**两个浮层都必须用 popover 的 top layer 逃逸**
   （`host.setAttribute('popover','manual')` + `showPopover()`）。这条有测试钉着，
   只改位置不改逃逸会被判失败。
2. **侧栏工具行必须在上报矩形之外**。原生子 WebView 按 `webvpn_set_rect` 上报的矩形摆放，
   DOM 放在那个矩形里会被它盖住。所以 `hostRef` 只能挂在 `.ib-webvpn-stage` 上，
   不能挂在 `.ib-webvpn-tab` 上（也有测试钉着）。

### 交互上的不变量

- 载荷没被证明收全（`ready ∧ complete`）→ 按钮禁用并显示进度；**绝不出现"可点但一点就失败"**。
- 点过之后锁定（`dataset.busy`），不重复触发；归档中（`state == Uploading`）拒绝第二次保存。
- 顺带修掉一个隐患：`__ibmWebVpnSetPageOffset` 只在原生 PDF 上开（这是它唯一的用途），
  所以浮层面临的 transform 场景是可穷举的。

## 还没做（明确的下一步）

1. **动作延迟**：`browser_operation_claim` 长轮询 + 浏览器动作即时循环（beta12 起排队）。
2. **八家出版社 iWAN 标定**：全 `pending`，需人工真机逐家验收。**不要声称已完成。**
3. issue.md 排队项：B3（网络中断有限次重试）、B5（重启失效任务的 UI 区分）、
   B7/O6/O7、O4。

## 真机验收重点

页内浮层出现且可点（收满后一次性归档成功）；侧栏按钮作为兜底可点。
**如果页内浮层没出现、而侧栏按钮可用**，那就直接定位到"这个文档上注入缺席"，
不需要再猜按钮逻辑。
