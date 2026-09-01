# iBM Lab 文献下载桥（MV3）

本扩展只配合 iBM Lab Agent Windows 桌面应用工作。用户在文献条目中点击尚未获取的
PDF/SI 后，桌面应用会在 Edge 打开一个本机 handoff 页面；扩展从该页面接收一次性
任务，监听随后出现的下一份匹配下载，并通过 Native Messaging 上传。服务端依据任务
绑定关系把文件归档到对应课题目录。

## 边界

- 只在 `127.0.0.1/localhost` 的固定 `/lab/capture/?taskId=...` 页面注入布防桥。
- 不需要也不提供“信任当前页面”。
- 不向出版社、学校数据库或普通 iBM 页面注入脚本。
- 不读取 Cookie、浏览历史或未布防的下载文件。
- 不保存 PPTX/DOCX；桌面应用的报告/PPT 下载由 Tauri 原生文件服务负责。
- Native Host 只接受 `upload`，目标必须是本机一次性捕获接口；项目目标目录由服务端
  决定，扩展不能指定。

## 文件

- `manifest.json` — 最小权限、固定 loopback handoff 注入范围。
- `background.js` — 单任务状态机、下载匹配、Native Messaging 上传。
- `content.js` — handoff 页面到扩展的 `ARM_CAPTURE` 单向桥。
- `popup.*` — 只显示等待/归档/完成/失败状态，可取消等待中的任务。
- `native-bridge/host.py` — 无桌面安装包时的开发回退 Host；正式桌面版使用内置 Node Host。

## 开发模式安装

1. 打开 `edge://extensions`，启用开发者模式。
2. 选择“加载解压缩的扩展”，指向本目录。
3. 记下扩展 ID；未运行桌面版时可执行
   `python native-bridge\install-bridge.py <扩展ID>` 注册开发 Host。
4. 运行 iBM Lab Agent 桌面应用，再从文献条目点击 PDF/SI。无需进行网页信任操作。

升级到 0.5.1 后必须在 `edge://extensions` 点击“重新加载”，使固定 handoff 路由和
下载桥代码生效；从 0.4.x 升级时也会同时清除旧版动态内容脚本和
可选站点权限。必要时先移除旧版扩展再重新加载本目录。

运行 `package-store.ps1` 可生成 Edge Add-ons 提交 ZIP。正式桌面安装包会用固定扩展 ID
注册 `com.ibm.lab.capture` Native Host。
