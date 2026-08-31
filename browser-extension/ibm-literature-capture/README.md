# iBM Lab 文献捕获扩展（MV3）

配合 iBM Lab Agent 使用：用户在文献精读面板点击灰色 PDF/SI 按钮后，本扩展
捕获**下一次匹配类型的手工下载**，经本地桥接上传并登记到原文献条目；用户下载
已审核的 PPTX/DOCX 时，Windows 桌面版使用 Tauri 原生“另存为”；Web 版仍可由
本地桥接校验并保存。

## 目录

- `manifest.json` — Manifest V3；站点权限由用户在 iBM 页面明确授权，不再向所有
  网页静态注入脚本
- `background.js` — Service Worker：布防（ARM_CAPTURE）、安全保存
  （SAVE_ARTIFACT）、下载匹配、状态机、Native Messaging 与页面通知
- `content.js` — 页面（`window.postMessage`）↔ 扩展（`chrome.runtime`）桥
- `popup.html/js/css` — 六状态（未启动/等待下载/上传中/完成/失败/取消）+ 取消按钮
- `icons/` — 扩展图标
- `native-bridge/` — 本地桥接：`host.py`（读取捕获文件并上传；校验并保存
  PPTX/DOCX）、
  `com.ibm.lab.capture.json`（host manifest 模板）、`install-bridge.py`
  （Windows 注册脚本）、`bridge.cmd`、`make-icons.py`

## 为什么需要本地桥接

Chrome 扩展 Service Worker 不支持稳定读取或修复下载后的本地文件。因此文件读取、
上传和 Office 产物保存交给 Native Messaging 本地桥接。桥接只接受已授权页面发起的
本机 iBM 产物地址，只向 Chrome/Edge 配置或系统下载目录写入通过大小、SHA-256 和
OOXML 包结构校验的 PPTX/DOCX，不读取 Cookie、浏览历史或其他目录中的文件。

## Edge Add-ons 发布包

运行 `package-store.ps1` 生成不包含开发期 Native Host 脚本的商店提交 ZIP。首次在
Microsoft Partner Center 审核通过并获得固定 Catalog ID 后，将该 ID 写入发布环境的
`IBM_LAB_EXTENSION_ID`；桌面安装包会把同一 ID 编译进 Native Messaging
`allowed_origins`。具体发布门禁见 `docs/windows-release.md`。

## 开发模式安装

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录；
2. 记下扩展 id（32 位 a–p 字母）；
3. `python native-bridge\install-bridge.py <扩展 id>`；
4. 刷新扩展；
5. 打开 iBM 页面，点击扩展图标，再点击“信任当前 iBM 页面”。

升级扩展后请重新执行第 3 步并刷新扩展，确保 Windows 注册的桥接路径和当前扩展 id
一致。桌面客户端会自动注册 Node 版桥接；上面的 Python 注册步骤仅用于不运行桌面
客户端时的扩展独立开发。

完整流程与失败排查见仓库 `docs/MANUAL_CAPTURE.md`。
