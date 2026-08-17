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
