# 第三方声明（Third-Party Notices）

## nature-skills

- 来源：<https://github.com/Yuan1z0825/nature-skills>
- 引入方式：`vendor/nature-skills/`（完整第三方目录，固定 commit，见 `vendor.lock.json`）
- 许可证：Apache-2.0（以仓库内 `LICENSE` 为准，本文件为摘要性声明）
- 引入的 Skill：
  - `nature-shared`
  - `nature-academic-search`
  - `nature-reader`
  - `nature-paper-card`
  - `nature-paper2ppt`
- 按上游要求保留完整技能目录（`SKILL.md`、`manifest.yaml`、`scripts/`、
  `references/`、`static/`、`agents/`、`evals/`、共享文件），未做删改。
- 许可证全文：见 `vendor/nature-skills/LICENSE`（随仓库一起分发）。

## DeepSeek Harness

- 来源：<https://github.com/deepseek-ai/deepseek-harness>
- 引入方式：npm 精确版本（`harness.lock.json`），未修改其源码；本插件仅以其
  Loader/Cordis 组合机制叠加 patch 层。
- 许可证：MIT（见各 `@deepseek-ai/*` 包内 LICENSE）。

## 分发边界

本仓库 `files` 字段包含 `vendor/`，确保安装时完整携带第三方目录与声明；
不启用 nature-skills 自动更新，升级仅通过 `scripts/pin-vendor.mjs` 手动执行。
