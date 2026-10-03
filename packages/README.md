# iBM P5 独立激活包

六个 Host 领域包加一个 UI 包。构建版本均为 0.5.8-rc.1；开发验收使用固定 NEXT v2.0.17-next 和内核 0.2.0-rc.2。

| 包 | 必须先启用的包 |
| --- | --- |
| dsh-lab-core | DSH storage |
| dsh-lab-runtime | core |
| dsh-lab-documents | core、runtime |
| dsh-lab-literature | core、runtime、documents |
| dsh-lab-design | core、runtime |
| dsh-lab-analysis | core、runtime |
| dsh-lab-ui | core |

这些包拥有独立 DSH bundle patch、导出入口和依赖声明，统一依赖固定 `dsh-lab-agent@0.5.8-rc.1` 共享实现。安装该库不等于启用它的完整兼容 bundle；**不得与这七个分域 bundle 同时启用完整兼容 bundle**，否则会重复注册服务与存储域。当前没有把公共实现复制成七份，也没有实现物理资源瘦身。

`node scripts/migration/build-domain-packages.mjs` 根据已冻结的领域组合及当前客户端生成包，`--check` 检查漂移。先执行客户端构建，再生成包；生成文件不手工编辑。包生成不修改 NEXT 或内核。

真实 NEXT 验收通过官方 package runner 安装本地 link 包，并验证在线停用、恢复、UI 卸载和更新样例。tgz 是结构及哈希已验证的本地制品；尚未证明从这些 tgz 和共享实现离线安装到干净机器，不能当作完整安装器。该步骤、资源合包和发行签名属于后续工作。
