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

## 运行时 npm 依赖（本插件直接声明）

| 包 | 用途 | 许可证 |
|---|---|---|
| `jszip` | PPTX（zip）解压，模板导入解析 | MIT |
| `fast-xml-parser` | OOXML/关系 XML 解析 | MIT |
| `zod` | 版本行/配置 schema 校验 | MIT |

精确版本见 `package-lock.json`；升级前跑完整回归套件（`scripts/regression/run.mjs`）。

## 可选 Python 依赖（venv）与外部开放数据

| 依赖/服务 | 用途 | 许可证/条款 |
|---|---|---|
| `rdkit`（venv 可选） | SMILES 级 MW/logP/TPSA/HBD/HBA 计算 | BSD-3-Clause；未安装时本插件明确降级为分子式级计算 |
| `markitdown`（Python 可选，微软） | Office/PDF/图片等 → Markdown 文档转换 | MIT；未安装时 `ctx.labConvert` 明确降级并给出安装指引 |
| PubChem REST API（NIH） | 化合物数据库实测值查询（`db-measured`） | 美国 NIH 开放数据；使用需遵守 PubChem 使用条款，发送的仅为化合物名称/结构查询 |
| OpenAlex（nature-academic-search） | 文献检索（无 key） | CC0 元数据；礼貌池使用（`--mailto`） |
| USPTO PatentsView | 专利开放检索（无 key） | 美国专利商标局开放数据；端点正迁移至 USPTO Open Data Portal，适配器按端点封装 |
| CAS Common Chemistry / SciFinder | CAS 查询入口（仅准备 URL） | **未获书面授权前不访问**；本插件不自动操作、不把 CAS 内容输入模型 |

所有外部查询均只在显式调用时发起，发送前由调用方/agent 说明数据范围（计划默认条件）。


## 分发边界

本仓库 `files` 字段包含 `vendor/`，确保安装时完整携带第三方目录与声明；
不启用 nature-skills 自动更新，升级仅通过 `scripts/pin-vendor.mjs` 手动执行。
