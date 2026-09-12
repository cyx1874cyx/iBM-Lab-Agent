# WebVPN「真正侧边栏」（child 窗口嵌入）方案评估

> **2026-09-12 独立复核结论：本文 §6 的“框架无法实现”结论不成立。**此前真机实验只测试了
> `WebviewWindowBuilder + parent_raw(HWND)`，没有测试 Tauri 2.11.5 官方提供的多 WebView 路径
> `Window::add_child(WebviewBuilder, position, size)`。两者原生层级不同：前者额外创建 tao
> `WS_CHILD` 窗口，后者把 WebView2 容器直接加入主原生窗口。复核时使用本仓库依赖执行了
> `cargo check --example child_webview_probe --features tauri/unstable`，包含独立 `data_directory`、
> `on_navigation`、`on_download` 和 `add_child`，编译通过。原编译探针已删除，没有留下源码改动。
>
> 因此当前正确表述应为：**真正侧边栏可用现有 Tauri 框架实现，但依赖 `unstable` 多 WebView API，
> 仍需一次真机渲染验证；此前白屏只能否定 `parent_raw` 路线。**实施时还必须把 capability 从
> `windows: ["main"]` 改为仅匹配主 `webview`，否则同一主窗口内的远程 WebVPN 子 WebView 会继承
> `core:default`。详见新增 §7。

> 2026-09-11 · 分支 `release-0.4.3`（位点 0.4.4）· 相关代码 `desktop/src-tauri/src/webvpn.rs`
>
> 背景：用户要求「参考主流 Agent 工具，点击后在主窗口右侧来一个侧边栏」。当前落地是
> **独立窗口贴靠主窗口右侧**（能渲染），但「真正嵌入主窗口 client area」的 child 窗口方案
> 实测**白屏**。本文定位白屏根因，并评估可行的落地方案。

## 一、结论摘要

| 方案 | 效果 | 工作量 | 风险 | 推荐 |
|---|---|---|---|---|
| **A. 开启 tauri `unstable` + `parent_raw`** | 真正嵌入的 child 侧边栏 | 小（改 Cargo.toml + 恢复 child 代码） | 中（unstable 改变**所有窗口**的 webview 构建方式，需验证主窗口） | ✅ 首选 |
| B. patch wry（fork 修 `is_child`） | 同上 | 大 | 高（维护 fork） | 备选 |
| C. 独立窗口贴靠（现状） | 贴靠窗口，非真嵌入 | 无 | 无 | 兜底 |

**推荐先做方案 A 的真机验证**：它本质是「一行 feature 开关」的改动，若验证通过则零成本拿到真侧边栏；若主窗口渲染受影响，回退即可，代价极小。

## 二、child 窗口白屏的根因（源码级）

**现象**：`parent_raw(HWND)` 建窗后，`webvpn.log` 里 `windowCreated` + `navigation` 都正常
（portal→login→passport→id），但窗口渲染为纯白。

**根因**：Tauri 的「窗口是 WS_CHILD」和「webview 是 child webview」是**两件独立的事**，
`parent_raw` 只做了前者，后者被 `unstable` feature 门控。

证据链（`tauri-runtime-wry-2.11.4/src/lib.rs`）：

```rust
// 窗口初始化时的主 webview，用哪种构建方式取决于 unstable feature：
if let Some(webview) = webview {
    webviews.push(create_webview(
        #[cfg(feature = "unstable")]
        WebviewKind::WindowChild,      // → webview_builder.build_as_child(&window) → wry is_child = true
        #[cfg(not(feature = "unstable"))]
        WebviewKind::WindowContent,    // → 默认构建 → wry is_child = false
        ...
    ));
}
```

而 wry（`wry-0.55.1/src/webview2/mod.rs`）对 child webview 的 bounds 有专门处理：

```rust
// is_child = false（当前）：直接用 controller.Bounds()
unsafe { self.controller.Bounds(&mut rect) }?;

// is_child = true（build_as_child）：用 GetClientRect + MapWindowPoints 换算相对 parent 的坐标
unsafe { GetClientRect(self.hwnd, &mut rect)? };
MapWindowPoints(Some(self.hwnd), Some(*self.parent.borrow()), position_point);
```

- 当前项目 `Cargo.toml` 是 `tauri = { version = "2.11.5", features = [] }`（未开 `unstable`），
  因此 webview 走 `WindowContent`（`is_child = false`），对 WS_CHILD 窗口用错误的 bounds 计算
  （`controller.Bounds()` 返回的是相对**顶层窗口**的坐标，而非相对 parent 的 client area），
  渲染 surface 尺寸/位置错位 → 白屏。
- `unstable` 只是**新增** API（`app.get_window()`、`windows()` 等 10 处），不删现有 API，
  但会连带 `tauri-runtime-wry/unstable`（`tauri/Cargo.toml: unstable = ["tauri-runtime-wry?/unstable"]`）。

## 三、方案 A 详细说明（开启 `unstable` + `parent_raw`）

### 改动点

1. `desktop/src-tauri/Cargo.toml`：
   ```toml
   tauri = { version = "2.11.5", features = ["unstable"] }
   ```
2. `webvpn.rs` 恢复 child 窗口写法（当前已回退为独立窗口贴靠，需改回）：
   ```rust
   let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(target.clone()))
       .title("WebVPN")
       .inner_size(width, height).position(x, y)
       .decorations(false)                    // 无边框，真侧边栏外观
       .visible(false).data_directory(profile_dir);
   if let Some(main) = app.get_webview_window("main") {
       builder = builder.parent_raw(main.hwnd()?);   // WS_CHILD
   }
   ```
3. `side_panel_geometry` 改读 `inner_size()`（client area），坐标相对 client area（x = 客户区宽 − 560）。
4. `desktop/src/index.html` 恢复「让位」：`.shell[data-webvpn-open]{padding-right:560px}` + 轮询 `webvpn_status`。
5. 关闭入口：无边框后无 X，用 index.html topbar 的「WebVPN」toggle 按钮（已具备）。

### 关键风险（必须真机验证）

- ⚠️ **开启 `unstable` 后，主窗口自身的 webview 也从 `WindowContent` 变成 `WindowChild`**
  （`build_as_child`）。理论上对单 webview 顶层窗口 bounds 结果等价（MapWindowPoints 到自己 = (0,0)），
  但需真机确认主窗口渲染不受影响。**这是方案 A 的唯一实质风险**。
- `unstable` 是「不稳定 API」，未来 tauri 升级时其行为可能变化，升级需回归。
- `unstable` 会开放 `app.get_window()`/`windows()` 等 API，当前代码未用，无冲突。

### 验证清单（真机）

1. 主窗口正常渲染（不受 unstable 影响）。
2. 点「WebVPN」→ 侧边栏**贴主窗口右侧、嵌入 client area、不盖内容**。
3. 再点 → 收起。
4. 拖动/缩放主窗口 → 侧边栏跟随。
5. 登录 + 打开文献 → 内容正常显示（不再白屏）。

## 四、方案 B（patch wry）—— 不推荐，仅列备选

若方案 A 的主窗口渲染受影响（unstable 副作用不可接受），可 fork wry，把 `is_child` 的判断
从「是否 build_as_child」改为「窗口是否 WS_CHILD」，从而在非 unstable 下也让 parent_raw 的窗口
走正确 bounds。工作量大（维护 fork、跟踪上游）、风险高，仅在 A 不可行时考虑。

## 五、结论

优先验证 **方案 A**（一行 feature 开关 + 恢复 child 代码），失败再谈 B，兜底保持 C（现状）。

---

## 六、实测结果 + 深挖后的根因定性（2026-09-12 更新）

**实测**：方案 A（`unstable` + `parent_raw`）仍白屏，且无边框下无法收起。→ 已回退方案 C（独立窗口贴靠）。

**深挖 wry 0.55.1 源码后的根因定性**（推翻「unstable 门控 WebviewKind 是唯一根因」的假设）：

1. wry 的 WebView2 渲染**永远**创建一个 `WS_CHILD` 容器 hwnd（`create_container_hwnd`，
   `window_styles = WS_CHILD | WS_CLIPCHILDREN`），把 WebView2 controller 挂在这个容器上。
2. `parent_raw(HWND)` 让 tao 窗口**本身**也变成 `WS_CHILD`（`Parent::ChildOf` → `WindowFlags::CHILD`），
   于是形成「主窗口(顶层) → tao WS_CHILD 窗口 → wry WS_CHILD 容器 → WebView2」的**三层嵌套**。
3. 日志已证明**导航正常**（`on_navigation` 一路走到 id.ustc.edu.cn），白屏是**渲染 surface 没映射**，
   不是导航失败。WebView2 的 DirectComposition compositor 假定宿主窗口是 top-level，多层 WS_CHILD
   嵌套下渲染 surface 无法正确映射到屏幕 → 白屏。
4. `unstable` 的 `build_as_child`（`is_child`）语义是「webview 作为**多 webview 容器**的 child」，
   与「窗口本身是 WS_CHILD」是两回事；开启后 `init_webview` 里 `!is_child` 为 false 反而**不挂**
   `attach_parent_subclass`（WM_SIZE 刷新 bounds），所以 unstable 救不了，甚至少了一条 resize 恢复路径。

**结论**：这是 wry 对「child 窗口（WS_CHILD 宿主）」场景的底层渲染缺陷，上层（feature 开关 / 坐标）
无法修复。要落地真侧边栏，必须 fork wry，在 WebView2 初始化时正确处理 WS_CHILD 宿主的 compositor 映射
（如 `WS_EX_NOREDIRECTIONBITMAP` + `NotifyParentWindowPositionChanged`），高风险、需长期维护 fork。
该结论只适用于 `parent_raw` 方案，不能外推到 Tauri 官方 `Window::add_child` 方案。

---

## 七、2026-09-12 独立复核：遗漏的官方多 WebView 路线

### 7.1 为什么此前实验不能证明“无法实现”

此前代码仍从 `WebviewWindowBuilder` 出发，再用 `parent_raw` 把完整原生窗口挂到主窗口下：

```text
主原生窗口 → tao 子窗口 → wry WebView2 容器 → WebView2
```

白屏根因分析对这条路径是成立的。Tauri 2.11.5 另有专门的多 WebView API：

```rust
let main = app.get_window("main").unwrap();
let builder = WebviewBuilder::new("webvpn", WebviewUrl::External(target))
    .data_directory(profile_dir)
    .on_navigation(...)
    .on_new_window(...)
    .on_download(...);
main.add_child(builder, position, size)?;
```

它的层级是：

```text
主原生窗口 → 主 WebView2 容器
           → WebVPN WebView2 容器
```

这里没有中间 tao `WS_CHILD` 窗口，不能用 `parent_raw` 的三层嵌套白屏结果否定它。Tauri
2.11.5 的源码和官方 API 文档都把 `Window::add_child` 定义为“向该窗口添加一个新的 child
webview”，并给出了在同一窗口创建 WebView 的示例。该 API 由 `tauri/unstable` feature 门控。

### 7.2 已完成的编译验证

复核时建立了临时 example，使用的核心代码包含：

- `app.get_window("main")`；
- `WebviewBuilder::new("webvpn", External(...))`；
- 专属 `data_directory`；
- `on_navigation` 和 `on_download`；
- `main.add_child(..., LogicalPosition, LogicalSize)`。

执行：

```text
cargo check --example child_webview_probe --features tauri/unstable
```

结果：`Finished dev profile`，编译通过。临时 example 随后删除。这个结果证明锁定依赖的类型、
feature 和回调组合可用；是否存在具体设备上的 WebView2 显示问题仍应通过下一步真机 spike 验证。

### 7.3 实施时必须同步修改的安全边界

当前 `capabilities/default.json` 使用：

```json
"windows": ["main"]
```

Tauri 官方 capability 语义是：窗口 label 命中 `windows` 后，该窗口内的**所有 WebView**都会
获得此 capability。真正侧边栏会让远程 WebVPN 与本地主 WebView 同属 `main` 原生窗口；若保持
现状，远程页面会继承 `core:default`，不符合本项目既有隔离要求。

迁移时应改为只按 WebView label 授权，例如：

```json
"webviews": ["main"]
```

并移除 `windows` 匹配。`webvpn` 子 WebView 不列入任何 capability。随后同步修改
`verify-package.ps1` 和相关 Node 护栏：正式包必须断言主 WebView 获权、`webvpn` 未获权。

### 7.4 推荐的最小真机 spike

1. 在 Cargo.toml 为 tauri 启用 `unstable`。
2. 保留当前 WebVPN 状态机、profile、导航和下载回调，只把窗口载体从
   `WebviewWindowBuilder` 换成 `WebviewBuilder + main.add_child`。
3. 打开时把主 WebView bounds 缩到 `窗口宽度 - 560`，把 WebVPN 放在右侧 560 px；收起时
   `webvpn.hide()` 并恢复主 WebView bounds。主窗口 `Resized` 时重算两个 bounds。
4. 将 capability 改成 `webviews: ["main"]` 后，验证远程 WebVPN 无法调用 IPC。
5. 真机依次验证主 DSH、WebVPN 登录、Nature 页面、PDF 下载回调、隐藏/显示、缩放、最大化、
   多显示器 DPI 和跨重启 profile。

若这个官方 `add_child` spike 仍白屏，才能把问题定性为当前 Tauri/Wry/WebView2 组合的实际
运行限制；届时保留独立窗口贴靠。无需先 fork wry，也不应继续修补 `parent_raw` 路线。
