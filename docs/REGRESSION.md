# 回归测试框架

阶段一交付的是框架与目录级金标准；文献/PPT 证据级金标准在阶段三起逐步加入。

## 运行

```bash
node scripts/regression/run.mjs                 # 全部用例
node scripts/regression/run.mjs --case catalog  # 单用例
node scripts/regression/run.mjs --tag nature    # 按标签过滤
node scripts/regression/run.mjs --record-pass   # 全绿后记录回归通过日期
node scripts/regression/golden-diff.mjs --old <sha> --new <sha>   # 跨版本对比
```

用例位于 `tests/regression/cases/*.mjs`，导出：

```js
export default {
  name: 'catalog',
  tags: ['nature-skills'],
  required: [],               // 资源缺失时 SKIP：vendor / harness / python / registry
  async run(ctx) { return { pass, details } }
};
```

## 阶段一用例

| 用例 | 覆盖计划 §八 的条目 |
|---|---|
| `catalog` | 固定 commit 可重复安装、完整共享目录与脚本存在、manifest 版本一致 |
| `registry` | NatureSkillVersion 登记/解析、commit/license/python 锁哈希一致 |
| `harness-pin` | Harness 固定版本与实际安装一致（上游漂移检测的 npm 侧） |
| `python-lock` | requirements.lock 可解析、哈希与 vendor.lock.json 一致 |

## 阶段二用例

| 用例 | 覆盖计划 §八 的条目 |
|---|---|
| `goal-profile` | 默认聚前药目标完整；01–16 契约保留；同一目标两配置 → 重点不同契约相同（转换层）；版本快照不可变；删除后历史可读 |
| `ppt-template` | 三种课题组模板导入识别比例/主题/布局/占位符；11 版式角色均可填充；无效映射生成前拒绝；nature-default 可用 |

## 阶段三用例

| 用例 | 覆盖计划 §八 的条目 |
|---|---|
| `task-flow` | 全流程（项目/检索/准备/精读/审计门禁/PPT/QA 门禁/provenance），检索网络路径以 stub 代替，其余调用真实 nature-skills 脚本 |

## 阶段四用例

| 用例 | 覆盖计划 §八 的条目 |
|---|---|
| `chemistry` | 分子式→MW（阿霉素校验）、Đ/DP/载药量/取代度、来源三类区分、实验计划完整性门禁与人工审核-only 状态机（无 executing/自动采购） |

## 阶段五用例

| 用例 | 覆盖计划 §八 的条目 |
|---|---|
| `nmr` | 工作流状态机与不可覆盖保护、积分计算公式（组成/转化率/端基DP/取代度/载药量）、计算只接受已审核积分 |

> 真实 NMR 数据验证（§八：至少 5 组课题组真实数据）使用 `ctx.labNmr` + mnova-mcp
> 在课题组本机执行（需要 Mnova 环境）；仓库内以合成积分 fixture 覆盖计算层。

> 端到端"同一论文 × 两个目标配置"的真实 paper-card 输出对比（`paper-card-evidence`
> golden 用例）需要 venv（PyMuPDF）与 LLM 调用，作为 `task-flow` 的扩展在领域验证阶段
> （§八：20–30 检索题 / 10 篇金标准论文 / 5 套模板 / NMR 数据）接入。

## 后续阶段用例（已预留接口）

- `paper-card-evidence`：同一篇金标准论文在两个 commit 下的 01–16 节结构、来源
  定位、数字与结论边界 diff（`golden-diff --case`）。
- `ppt-quality`：同一论文/同一模板在两个 commit 下的 PPTX QA 报告对比。
- 目标/模板系统用例：目标切换不改证据、旧任务引用旧版本快照等（计划 §八）。
- 领域验证语料（20–30 检索题、10 篇金标准论文、5 套模板、NMR 数据）放在
  `tests/fixtures/`，不进 npm 包发布清单。

## 结构对比（升级金标准）

`golden-diff.mjs` 的 `collect(ctx) → JSON` + `diff(old, new) → lines` 接口：
每个证据级用例实现一对收集/差异函数，即自动纳入跨 commit 对比，无需改主流程。
