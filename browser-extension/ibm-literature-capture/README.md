# iBM Lab 文献捕获扩展（MV3）

配合 iBM Lab Agent「手工下载文献自动捕获」功能使用：用户在文献精读面板点击
灰色 PDF/SI 按钮后，本扩展捕获**下一次匹配类型的手工下载**，经本地桥接上传到
iBM Lab Agent 服务端并登记到原文献条目。

## 目录

- `manifest.json` — Manifest V3；站点权限由用户在 iBM 页面明确授权，不再向所有
  网页静态注入脚本
- `background.js` — Service Worker：布防（ARM_CAPTURE）、下载匹配、状态机、
  过期清理、Native Messaging 上传、页面通知
- `content.js` — 页面（`window.postMessage`）↔ 扩展（`chrome.runtime`）桥
- `popup.html/js/css` — 六状态（未启动/等待下载/上传中/完成/失败/取消）+ 取消按钮
- `icons/` — 扩展图标
- `native-bridge/` — 本地桥接：`host.py`（读取下载文件并上传）、
  `com.ibm.lab.capture.json`（host manifest 模板）、`install-bridge.py`
  （Windows 注册脚本）、`bridge.cmd`、`make-icons.py`

## 为什么需要本地桥接

Chrome 扩展 Service Worker 不支持稳定读取下载后的本地文件；`chrome.downloads`
返回的是绝对本地路径。因此文件读取与上传交给 Native Messaging 本地桥接；
桥接只接受位于 Chrome/Edge 配置或系统下载目录内的文件，不读取 Cookie、浏览
历史或其他目录中的文件。

## 安装

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录；
2. 记下扩展 id（32 位 a–p 字母）；
3. `python native-bridge\install-bridge.py <扩展 id>`；
4. 刷新扩展；
5. 打开 iBM 页面，点击扩展图标，再点击“信任当前 iBM 页面”；页面会自动刷新。

完整流程与失败排查见仓库 `docs/MANUAL_CAPTURE.md`。
