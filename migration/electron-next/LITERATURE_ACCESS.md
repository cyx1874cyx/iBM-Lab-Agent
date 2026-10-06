# 文献页面访问性与导航完成判断

## 用户场景

条目浏览器已成功打开，但正文不可访问。旧流程在等待整页加载时报告导航超时，将无权限、验证页与科研浏览器绑定失败混为一谈。本轮不对用户指定文章的真实机构权限作推断，不改动其文献条目、课题数据或机构登录会话。

## 实现

- 导航以主文档 DOM 就绪为可观察节点，不再要求图片、广告等所有资源加载完成。主文档未就绪仍保留 20 秒超时。
- 状态机新增检查访问权限阶段；在 DOM 就绪、页面完成加载和 Agent 重新观察时检查 HTTP 状态、可见登录控件及页面证据。
- `access` 字段独立报告 accessible / unknown / access-denied / login-required / verification-required / not-found / page-error，并保存判断依据与时间。摘要页或下载入口只能判为 unknown；获取成功仍必须通过真实下载字节及文件完整性验收。
- 明确无权限、页面不存在或页面错误时，持久化具体原因，结束捕获并释放浏览器预约。状态查询仍可读取该任务的访问性证据，不用重新创建任务来确认。
- 登录和验证页提示用户在侧栏处理；之后重新观察会重新检查权限。等待人工操作的任务不在桌面宠物中显示为执行中的任务。
- 正文付费提示不证明独立 SI 也收费；SI 任务仍可查找公开入口。直接拒绝访问的 HTTP 403、文章不存在等页面错误仍结束 SI 任务。
- 不读取输入框值、Cookie 或存储凭据；DOM 文本只在浏览器本地形成固定判断依据，不返回全文或认证信息。

## 验证

- 全量测试 818 项：810 通过、8 跳过、0 失败。
- `outputs/electron-next-access/development-flow/verification.json`：真实 Electron 本地页面覆盖 403、付费页、登录页、验证页及持续加载资源；拒绝任务释放预约、未写入正文占位，正常下载与 PDF 完整性归档继续通过。
- 新增单元验证覆盖访问性证据、终态展示、下载优先、登录等待及独立公开 SI。
- 最终打包程序 `outputs/electron-next-access/packaged-access/verification.json`：上述访问性页面、慢资源、正常下载和直接 PDF 导航全部通过。
- 最终官方侧栏 `outputs/electron-next-access/packaged-sidebar/run-m52EAj/verification.json`：实际多文件上传、微信元数据登记后首次正文捕获、PDF/SI 归档、任务取消、侧栏弹出页、宠物运行状态及 Cookie/偏好跨重启全部通过。

## 安装包

`outputs/electron-next-access/release-windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`，产品源码提交 `d36ed1c`；固定版本保持不变。安装更新前完整退出应用和托盘，在原位置更新，不自动停止用户当前会话。

访问性判断为页面证据判断，不替代机构授权核验。页面没有明确证据时返回 unknown，允许继续观察入口，不臆测正文可访问。
