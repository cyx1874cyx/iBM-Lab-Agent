# 版本管理（固定 commit / 手动升级）

## 1. 固定的三层

| 层 | 固定方式 | 记录位置 |
|---|---|---|
| DeepSeek Harness | npm 精确版本（CLI 与包集 `0.1.1-rc.2`） | `harness.lock.json` |
| nature-skills | git commit SHA（40 hex） | `vendor.lock.json` `pinnedCommit` |
| Python 依赖 | `requirements.lock` 全量精确 pin + sha256 | `vendor.lock.json` `pythonDeps.sha256` |

不启用自动更新。升级前先建候选分支，跑完回归再改正式锁定版本。

## 2. 读取当前固定版本

```bash
node -e "console.log(require('./vendor.lock.json').pinnedCommit)"
node -e "console.log(require('./harness.lock.json').cli)"
```

## 3. 升级 nature-skills（手动流程）

物化方式：`scripts/vendor-fetch.mjs` 通过 jsdelivr CDN 按 commit SHA 拉取完整文件树
（无 git 历史，`vendor/nature-skills/.dsh-lab-agent-commit` 记录物化 SHA；
codeload/git 协议在部分网络被限流或过慢，故以 CDN 为主）。

```bash
# 1) 候选分支上取目标 commit，扫描并写 vendor.lock.json（回归日期重置）
node scripts/pin-vendor.mjs --sha <40-hex>        # 或 --latest（git ls-remote 取 HEAD）
git diff vendor.lock.json                          # 人工审查变更

# 2) 跑回归（catalog/registry/harness-pin/python-lock）
node scripts/regression/run.mjs
# 3) 全绿后记录回归通过日期（写回 registry 与 vendor.lock.json）
node scripts/regression/run.mjs --record-pass

# 4) 用同论文做跨版本差异对比（golden diff 脚手架；注意 jsdelivr 只缓存近期 commit）
node scripts/regression/golden-diff.mjs --old <旧sha> --new <新sha>

# 5) 部署刷新（物化树 + 锁 + registry 行）
node scripts/install.mjs
```

> 文献/PPT 证据级金标准用例（paper-card 章节、source_map、PPTX QA）在阶段三起
> 加入 `tests/regression/cases/`，通过 golden-diff 的 `collect/diff` 接口参与升级对比。

## 4. 升级 Harness

- 在**候选 profile**（非 `web`）中安装候选版本：`dsh plugin --profile lab-cand add ...`，
  跑 `node scripts/regression/run.mjs`（harness-pin 用例会比较锁文件与实际安装版本）。
- 通过后更新 `harness.lock.json` 的 `packages`/`cli` 与 `recordedAt`，再升级正式 profile。
- 不在本仓库安装任何 Harness 依赖；`scripts/dev-link.mjs` 只建立指向当前安装的
  开发链接（`DSH_HARNESS_NODE_MODULES` 或 PATH 上的 `dsh`）。

## 5. 复现性约定（阶段三起生效）

每个报告/任务产物记录：目标配置版本、Skill 版本（`NatureSkillVersion`）、模板版本、
模型与输入文件哈希。registry 的 `skillName@commitSha` 行保证旧报告引用的版本不因
后续升级而改变。
