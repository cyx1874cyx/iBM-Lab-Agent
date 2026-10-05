# 上传、首次捕获闪退与宠物显示修复

## 范围与计划

1. 在隔离数据中复现对话附件上传失败，修复桌面认证与上传载体的衔接。
2. 覆盖此前未验收的首次直接捕获：微信元数据登记后，不预先打开浏览器，直接获取正文；继续 SI、取消与重启。
3. 宠物仅选择 `running` 状态；排队、等待确认和所有终态均不显示。没有执行中的任务时显示空闲提示。
4. 运行相关单元、真实内核生命周期检查和整体回归，再验收打包程序、生成更新安装包。

## 复现与修复

- 旧包对话附件上传失败的记录：`outputs/electron-next-bugfix/baseline/run-ZyeRSN/verification.json`。官方默认后台 Worker 不属于 NEXT 允许认证的主页面；自有打包层在客户端启动前安装官方 `__DSH_FILE_UPLOAD__` 扩展接口，由主页面原样转发上传体与取消信号，保持原有权限边界。
- 旧包首次直接捕获的崩溃记录：`outputs/electron-next-bugfix/cold-baseline/run-M5qpWi/verification.json`。原适配器在 `did-start-navigation` 回调里同步调用 `guest.stop()`；修复将停止初始导航及完成租约预约延后到下一事件轮次，避免重入导航状态，也避免 Host 提前导航到出版社。
- 宠物按执行状态筛选，保留内部任务历史供业务和诊断使用；设置说明同步更新。

## 验证

全量回归 815 项：807 通过、8 跳过、0 失败；上传载体单元检查覆盖原样 Blob/取消信号、限制目的地及研究网页没有扩展接口。

最终打包程序验收全部通过，产品源码提交 `03229ec49888ae43d1f1a6a0a82b4945511ebaac`：

- 连续流程：`outputs/electron-next-bugfix/release-flows/run-ES4h20/verification.json`。对话 PDF 和中文 TXT 多文件上传都有真实接收回执；微信元数据登记后首次直接捕获未再退出；实际 PDF/SI 下载、哈希与归档，工作区隔离、取消、会话与宠物偏好跨重启保留通过。待精读报告和已归档任务均不显示在宠物中。
- 设置页：`outputs/electron-next-bugfix/release-ibm-settings/run-fRWmtH/verification.json`。模板、诊断、宠物开关实际点击通过，无永久加载占位和渲染错误。
- 升级：`outputs/electron-next-bugfix/release-upgrade/run-5pWeul/verification.json`。复制此前隔离旧版 profile 后，同版本更新、课题 v1 记忆保留、真实调度记忆工具、七个服务域和捆绑科学库通过。

上传验收仅记录主页面真实 fetch 返回的回执，未伪造响应或改变认证/业务服务。候选验证 `candidate-verification/run-cFn09X` 通过后，由上述最终打包验收取代；此前失败的候选记录保留用于追溯。

所有新验证使用独立目录和本地合成出版社文件。微信元数据登记调用实际业务服务，未联网读取真实微信公众号或机构账号。

## 安装包

- 文件：`outputs/electron-next-bugfix/release-windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`。
- 大小：437150074 字节。
- SHA256：`8D476228FFDE2BD21ECA70EB32D38316CD51DB93286532D0F1891D4760C7C3A8`。
- 保持 iBM 0.5.8-rc.1、NEXT 2.0.17-next、内核 0.2.0-rc.2、Electron 44.0.0 的固定版本；仍为未签名迁移预览包，自动更新关闭。
- 完整退出旧应用（包括托盘），在原位置安装。使用此更新包，不使用此前 sidebar-pet 安装包或 bugfix/candidate 测试目录。
