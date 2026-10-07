# 精读文件夹与人工 RIS 检索登记（2026-10-07）

精读板块新增课题内分类文件夹、全部/未分类筛选、新建、重命名、条目归属调整与删除文件夹。删除分类后文献回到未分类，保留原报告、PDF/SI/PPT 及归档路径。文件夹是板块内的分类容器，不迁移物理文献目录。

Agent 使用 `lab_tasks_list_reading_folders` 读取已有分类与可分类的报告路径，阅读报告后使用 `lab_tasks_classify_reading_report` 命名或复用文件夹并给出依据。`lab_tasks_register_report` 接受 folderName/classificationReason，报告生成与自查完成后登记分类。精读输入契约和界面精读任务均包含分类步骤；“Agent 自动分类”可以整理已有完成报告。未完成精读的报告不允许 Agent 仅凭题录分类。分类记录保留来源、理由和报告 Markdown 哈希。手动调整与 Agent 分类均按课题隔离。

检索板块新增“上传 RIS”，使用当前课题登记人工检索批次。支持 UTF-8、带 BOM 的 UTF-16 与 GB18030；保存作者、题名、DOI、期刊、年份、卷期页码、摘要以及原 RIS 文件。单文件 2 MB / 3000 条上限；格式异常整个批次拒绝，重复记录去重，相同 RIS 在同一课题重复上传复用原记录。导入的检索记录可查看文献、写综述和导出 RIS。

数据兼容：在既有课题、报告和检索 schema 中增加可选/default 字段，旧条目保留为未分类，未添加外部服务或启动依赖。

产品来源：1bdcbbbd831f38390ed0cb93ec1f84467003434a。

验证：826 项测试，818 通过、8 跳过、0 失败。客户端与域包生成一致性检查通过。最终打包应用在隔离课题中完成真实 RIS 文件选择器上传、文件夹创建与重命名、报告分类展示、重启保留，以及既有侧栏/PDF/SI/附件/宠物回归；证据为 `outputs/electron-next-literature-folders/packaged-ui/run-3i6DsY/verification.json`，ok=true，界面截图已查看。固定报告样例用于检验登记链路；不宣称使用真实模型完成了新的科研精读。

安装包：`outputs/electron-next-literature-folders/release-windows/dist/iBM-Lab-Agent-0.5.8-rc.1-Electron-x64-Setup.exe`，437201636 字节，SHA256 `68EF338BD4314337A7E740973F31F9E8AAF7E0DBD21FAAB88E75E36B5F12C525`。未签名，未自动安装。
