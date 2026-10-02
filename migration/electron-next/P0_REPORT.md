# Electron NEXT 迁移：P0 执行报告

日期：2026-10-02。状态：**P0 源码输入冻结与清单验收 PASS**。P1 运行兼容验证尚未开始。

**工作区与固定版本**

- 迁移工作区：H:/107-iBM-Agent/iBM-Agent/Code/iBM-Lab-Agent-electron-next
- 分支：codex/electron-next-migration
- 基线：iBM Lab Agent v0.5.8-rc.1，提交 a400ac424e1ca89496a9ac706531d7a05a221a2d。
- NEXT：v2.0.17-next，提交 838ba60fd79362087c0a0d134efee671c284786a。
- 目标内核：v0.2.0-rc.2，上游 pin 639ed015397290b3745d163aafe02ffee4aa3f84。
- Electron 44.0.0、electron-builder 26.15.7、Yarn 4.18.0。
- 原 Code/iBM-Lab-Agent 工作区仍在 release-0.5.0；其中原有两份计划文件保留，业务代码未修改。

当前 app 所属根目录不是 Git 仓库，无法使用 app 的受管工作树创建接口；已从 Code 下的实际业务仓库建立普通 Git worktree。后续实现使用上面的迁移工作区。

**P0 交付**

| 文件 | 内容 |
|---|---|
| baseline.lock.json | 指定提交、目标版本、43 个关键输入文件 SHA-256、6 个源码树指纹、构建冻结规则 |
| inventories.json | 完整声明清单与 Remote 描述符，便于后续对比 |
| interfaces.md | 24 个 Host 服务、56 个 Agent 工具、157 个 Remote 方法、41 个桌面命令与迁移归属 |
| data-map.md | 14 个 domain、29 张表、数据根/产物/记忆/会话/密钥的迁移规则 |
| features.md | 27 项功能回归、对应源码证据与后续验收阶段 |
| resource-inputs.md | Python、Skills、Origin/Mnova、构建 recipe 与补丁来源及指纹 |
| verification.json | 指纹重算、快照一致性与篡改/缺失检测结果；运行测试未执行 |
| ../../scripts/migration/freeze-electron-next-baseline.py | 可重跑的源基线校验与声明清单生成器，拒绝覆盖已有冻结文件 |

SHA-256 对关键源码使用 Git 已提交 blob 原始字节；源码树另记录 Git tree 与 tree-listing 指纹。
所有版本从指定 tag/commit 读取，避免当前工作目录版本、旧文档或 CRLF 影响源码输入标识。
编译运行时、wheel、安装包的 hash 需在物化后单独登记，不能以源码指纹代替制品验收。

**完成的核对**

- 指定 iBM tag 解析为预期提交；迁移分支以该提交起步。
- NEXT tag 提交、package 版本、内核依赖、Electron、builder、上游引用与子模块 pin 一致。
- 原内核为 0.1.7-rc.1；rc.2 适配仍属于 P1，不在 P0 修改依赖。
- 源服务清单 24 个且名称唯一；lab_tasks 包含 8 张表。
- 157 个 Remote 描述符 ID 唯一且有对应 Host 方法声明；note_templates_list 保留 request 参数。
- 路线锁定不在通用 Remote/Agent 工具清单中，保留真实用户动作边界。
- 完整快照重算检查通过；快照篡改/缺失检测已验证会失败。
- 不读取用户课题、密钥、机构 Cookie，不升级用户数据，不安装依赖或运行 Electron。

**下一阶段前置事项**

| 条件 | 当前状态 | P1 处理 |
|---|---|---|
| 精确 Python 3.12.11 | 本机 py -3.12 为 3.12.10，默认 python 为 3.11.9 | 获取经校验的 3.12.11 基底；不能使用任意 3.12 替代 |
| NEXT 开发 Node | 本机 24.19.0，满足目标范围 | 开发 Node 与旧 24.16.0、打包 Host Node-mode 分开验证 |
| 内置 Python 与离线 wheel | 未在新分支物化 | 按固定 recipe 构建、保存制品 hash、检验离线能力 |
| NEXT 固定依赖构建 | 根脚本会刷新 market/AA | 使用经过审查、不刷新固定依赖的构建路径；记录制品 provenance |
| 旧资源目录 | Toolchain/windows-runtime-v0.4.2、Releases/v0.4.* 为历史输入 | 未批准复用，不作为 0.5.8 合格制品 |
| 当前存储与 Remote | 保留 0.5.8 原实现 | P1 先验证单包；P2 后才按服务边界拆分 |
| 机构浏览器/数据迁移 | 未实测 | P4/P6 验证，不从源码存在推断等价 |

P0 无需通过安装或升级来补齐这些后续事项。源码冻结已完成；首个下一阶段成果是“单包 iBM + NEXT + rc.2”的隔离原型。

**复核方式**

在迁移工作区运行 Python 基线校验器，传入固定 NEXT 源码目录并使用 --check。
成功只表示固定源码输入与声明清单一致，不能表示 rc.2 的行为、浏览器捕获、科研软件或安装包已通过测试。

附：此前的迁移计划和服务拆分评估已复制到此分支的 docs 目录，供实施阶段追踪。
