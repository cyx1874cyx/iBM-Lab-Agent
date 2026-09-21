# Linux 迁移基线与冗余清单（实测）

> 配套：《执行路线-架构拆分与冗余清理.md》
> 基线：`release-0.5.0` @ `12f978c`
> 日期：2026-09-21
> 本文件记录**实测数字**，不写外推值。所有体积均在本机 Linux/cp312 上用项目自己的
> `uv` + CPython 3.12.11 测得；命令与隔离目录见各节。

## 0. 为什么需要本文件

路线书是围绕 Windows 桌面安装包写的，其体积基线（`resources` 1.1 G、`__pycache__`
56 M、安装包 217 M）来自 Windows 开发机的本地产物，而 `desktop/src-tauri/resources/`
的 `node/ dsh/ plugin/ python/` 四棵树都在 `desktop/.gitignore` 内、不进仓库。

开发环境迁移到 Linux 后，需要一份**Linux 侧**的等价基线，否则路线书 Phase 1/2 的
"回收了多少"在 Linux 上无法验收。本文件即该基线。

## 1. 验收闸门基线（改动前）

在 `12f978c`、工作区干净、`pnpm 10.34.5` + Node v24.21.0 下测得：

| 闸门 | 命令 | 结果 |
|---|---|---|
| 单元 + 集成 | `npm run test` | **411/411 通过**（`ℹ pass 411 / fail 0`），17.2 s |
| 回归 | `npm run regression` | **11/11 passed, 0 failed** |
| Lint | `npm run lint` | 0 error / **88 warning**（上限 200） |
| Preset 导出 | `npm run check:preset-exports` | OK（6 loader ⊆ exports） |
| Client 一致性 | `npm run check:client` | OK（330232 字节） |

**这五项在 Linux 上全部可跑、全绿**，是后续所有改动的主要验收手段。

## 2. Python 环境体积基线

Windows 线把依赖 `pip --target` 装进随包分发的 `resources/python/dist`；Linux 线改由
`install.sh` 现场装进 `$DSH_HOME/lab-agent/.venv`。因此体积性质从「安装包体积」变为
「目标机磁盘占用 + 下载量」。

测量方式（全程隔离在 `/tmp`，不触碰工作区）：

```bash
uv venv --python 3.12.11 /tmp/linux-baseline/venv
uv pip install --python .../venv/bin/python -r python/requirements.lock
uv pip install --python .../venv/bin/python -r python/requirements-linux.lock
```

| 层级 | site-packages |
|---|---|
| 仅 `python/requirements.lock`（基础锁，66 个固定包） | **428 MB** |
| 再装 `python/requirements-linux.lock`（Linux extras） | **698–705 MB** |
| Linux extras 净增 | **≈ 270 MB** |

### 2.1 路线书数字的校准（重要）

路线书 B.8.1 / 2.1 按 Windows 结果推算 magika 链为「onnxruntime 33 M + sympy 29 M +
mpmath 2.1 M = 64 M」。**该外推在 Linux 上不成立**：

- `magika 0.6.1` 的 `requires_dist` 确认无条件依赖 `onnxruntime>=1.17.0`，
  但本机实测 `sympy` / `mpmath` **根本没有被安装**；
- `onnxruntime` 实测为 **62 MB**。

结论：Linux 侧 magika 链的规模需按 ~66 MB（magika 4 M + onnxruntime 62 M）计，
不能用 64 M 这个凑巧相近但构成错误的数字。

另：`magika` 不是 markitdown 的 extra —— 它是 markitdown 的**硬依赖**
（`markitdown 0.1.7` 元数据 `requires_dist` 含 `magika~=0.6.1`，无 extra 条件）。
所以在 Linux 上与 Windows 一样，摘除该链只能走 `--no-deps` 手工摘（路线书方案 A），
即**停车点 S2**，不能用切 extras 的方式绕开。

## 3. 冗余清单（实测，均已在本机量化）

| # | 项 | 实测体积 | 依据 | 风险 |
|---|---|---|---|---|
| L1 | `markitdown[all]` 独有链：`speechrecognition` 43 M + `youtube-transcript-api` 9 M + `azure` 6 M + `pydub` 1 M + 传递依赖 | **63 MB** | 仓库自有代码对这 4 个包**零引用**；`lib/convert.js` 的 `CONVERTIBLE_UPLOAD_EXTENSIONS` 白名单不含音频/YouTube 格式 | 🟢 已验证等价（见 §4） |
| L2 | `site-packages/*/tests/`（65 个目录） | **44 MB**（实测，非估算） | 运行期不加载；Windows 线已在 `build-bundled-python.ps1:88-89` 做过同类清理，Linux 线**无对应步骤** | 🟢 已实施并验证（见 §5） |
| L3 | `magika` + `onnxruntime` | **66 MB** | magika 仅用于猜文件格式，而扩展名白名单已显式判定 | 🟡 需 S2 拍板 |
| L4 | `matplotlib` 25 M + `fontTools` 23 M | **48 MB** | `process_1d.py:295-300` 是 `except ImportError: plt = None`，**软依赖** | 🟡 需 S3 拍板 |
| L5 | `pytest` + `iniconfig` + `pluggy` | **3 MB** | 项目自有 Python 测试用 **unittest**（`npm run test:bridge`），全仓库对 pytest 的唯一引用就是 `requirements.lock:72` 自身 | 🟢 低，但见 §6 的耦合 |
| L6 | `pygments` 5 M、`rdkit-stubs` 4 M | **9 MB** | 运行期无引用（stubs 为类型存根） | 🟢 低 |

**已回收：L1 63 MB + L2 44 MB = 107 MB**
**待回收（不含需拍板的 L3/L4）：L5 3 MB + L6 9 MB = 12 MB**

## 4. L1 已实施并验证：`markitdown[all]` → 窄 extras

改动：`python/requirements-linux.lock` 的 `markitdown[all]==0.1.7` 改为
`markitdown[pdf,docx,pptx,xls,xlsx]==0.1.7`，与 Windows 线
（`desktop/scripts/build-bundled-python.ps1:64`）一致。

**功能等价性不是靠断言，而是 E2E 对照**：同一批样本、同一脚本，分别在
`[all]` 环境与窄 extras 环境运行 `markitdown`：

| 格式 | `[all]` | 窄 extras |
|---|---|---|
| .docx | OK:161 | OK:161 |
| .epub | OK:158 | OK:158 |
| .html | OK:56 | OK:56 |
| .pdf | OK:343 | OK:343 |
| .pptx | OK:97 | OK:97 |
| .xls | OK:61 | OK:61 |
| .xlsx | OK:68 | OK:68 |

7/7 输出长度**逐一相同**（`.epub`/`.html` 由基础依赖 `beautifulsoup4`/`markdownify`
支撑，不依赖 extras）。样本生成：`.docx` 用仓库自带 `tests/fixtures/office-builder.mjs`，
`.xlsx`/`.pptx`/`.xls` 用 `openpyxl`/`python-pptx`/`xlwt`（`xlwt` 仅作样本生成器，
不入任何锁），`.pdf` 取自 `vendor/`，`.epub` 手写最小合法结构。

附带收益 —— **未固定的依赖面收缩**（`[all]` 会引入未 pin 的传递依赖，与本锁
「Top-level versions are pinned」的定位冲突）：

| 环境 | 已装包 | 其中未在基础锁中固定 |
|---|---|---|
| `[all]` | 92 | 27 |
| 窄 extras | 80 | 15 |

验收：`node scripts/regression/run.mjs --tag python` → `python-lock PASS
(66 pinned requirements, hash ok)`。该改动**不触碰** `requirements.lock`，
因此不影响 `vendor.lock.json` 的 `pythonDeps.sha256` 断言。

## 5. L2 已实施并验证：剥离第三方测试树

改动：`install.sh` 新增 `strip_python_test_trees()`，在基础锁与 Linux extras
都装完后统一执行一次；并追加**双向守卫断言**（见下）。

工作量实测（隔离副本 `/tmp`，`cp -a` 自 §4 的窄 extras 环境）：

| 指标 | 实测 |
|---|---|
| 命中 `tests`/`test` 目录 | **65 个** |
| site-packages | **661 MB → 617 MB（−44 MB）** |
| 明细（按顶层包汇总） | `scipy` 43 M、`pandas` 16 M、`numpy` 16 M、`pybliometrics` 4 M、`matplotlib` 3 M、`mpl_toolkits` 3 M、`rdkit` 3 M、`nmrglue` 2 M、其余零散 |

**只删名字恰为 `tests` / `test` 的目录**：`numpy/testing` 与 `pandas.testing` 是
公共 API（名字含 `testing`，不是 `tests`），实测剥离后 `numpy/testing` 存活。

运行期探测（剥离后，全部通过）：

```
scipy.signal, scipy.optimize, numpy, nmrglue, matplotlib, markitdown, pandas,
openpyxl, xlrd, pptx, fitz, rdkit.Chem, origin_mcp, bs4, lxml, mcp, pydantic, yaml
```

7 种格式的转换输出与剥离前**逐一相同**（同 §4 的对照方法）。

守卫断言（`install.sh`，路线书 5.1 的"下限"方向）：

```bash
required_modules="scipy.signal, nmrglue, numpy, pandas, origin_mcp, yaml"
[[ $install_python_extras -eq 1 ]] && required_modules="markitdown, fitz, pptx, rdkit.Chem, $required_modules"
"$venv_python" -c "import $required_modules" || { ...; exit 1; }
```

裸装基础锁时 `markitdown`/`fitz`/`pptx`/`rdkit` 本就不存在，所以 extras 分支必须
条件化 —— 否则会把 `--no-python-extras` 的正常安装误判为失败。

**变异测试（路线书纪律 8.1，已做）**：向 `-c "import ..."` 注入不存在的模块名
`definitely_not_a_module_xyz` → 退出码非零，证明断言非恒真。

已验证范围与**未**验证范围（诚实声明）：

- ✅ `bash -n install.sh`（CI 的 shell 入口校验）与另外 3 个入口全过；
- ✅ 函数在全新的 `cp -a` 副本上真实执行，`site.getsitepackages()` 能正确解析 venv 路径；
- ⚠️ **未**端到端跑完整个 `install.sh`：本机缺 `soffice`，脚本在 `[2/8]` 会按设计
  退出（`command -v soffice || exit 1`）。若要让整条安装流程在无 LibreOffice 的
  机器上可跑，需先落实路线书 4.3（`soffice` 降级而非阻断）——那是**停车点**，见 §7 映射表。

## 6. 基础锁的耦合约束（改前必读）

`python/requirements.lock` 与 `vendor.lock.json` 的 `pythonDeps.sha256` **哈希绑定**，
而 `tests/regression/cases/python-lock.mjs` 会比对二者。因此：

> 任何对 `python/requirements.lock` 的改动（如移除 L5 的 `pytest`）都必须同步重算
> `vendor.lock.json` 的 `pythonDeps`，否则回归会红。

这正是路线书 Phase 1.3 要求 "改动需同步锁文件" 的同一类约束。
`python/requirements-linux.lock` 则**没有**哈希耦合，唯一消费者是 `install.sh:220`，
爆炸半径最小 —— 所以 L1 先做。

## 7. Windows → Linux 阶段映射

| 路线书 | Linux 等价物 | 状态 |
|---|---|---|
| 0.1 给 bundled-python 加输入指纹 | Linux 线由 `install.sh` 每次显式 `pip install -r` 驱动，**不存在「存在即永久跳过」**；无等价缺陷 | 不适用 |
| 0.2 重建产物、测真实基线 | §2 已用 uv 实测 | ✅ 完成 |
| 0.3 体积门禁（只报警） | 见 §8 | ⬜ 待做 |
| 0.4 回归基线快照 | §1 全绿 | ✅ 完成 |
| 1.1 pycache 红利 | 不适用（无 `pip --target` 产物缓存） | 不适用 |
| 1.2 剔除第三方 tests/ | **L2**：`install.sh` 的 `strip_python_test_trees()`，实测 −44 MB，含 import 守卫 + 变异测试 | ✅ 完成（见 §5） |
| 1.2' Windows 侧同样扩展 | 路线书原文要求扩 `build-bundled-python.ps1:86-89`；本机无 pwsh/Windows，**不写不可验证的发布流水线改动** | ⬜ 留给 Windows 机器 |
| 1.3 vendor 白名单 | 与 Windows 共用 `cordis.patch.yml:32`；`vendor.manifest.json` 机制仍适用。注：`vendor/nature-skills/skills/nature-figure/assets/figures4papers` 在本仓库中为 **tracked 文件**（`git ls-files` 可见），剔除会改 `vendor/` 树与 `vendor.lock.json` | 🟡 停车点 S1 |
| 1.4 import 探测脚本 | 仍适用（Linux 侧需覆盖 `requirements-linux.lock` 引入的 extras） | ⬜ 待做 |
| 2.1 摘 magika 链 | **L3**（66 MB） | 🟡 停车点 S2 |
| 2.2 matplotlib 策略 | **L4**（48 MB） | 🟡 停车点 S3 |
| 2.3 双 PDF 栈收敛 | 同样存在：`PyMuPDF`(60 M)+`pdfminer.six`(9 M)+`pdfplumber`+`pypdf`+`pypdfium2`；`vendor/` 中 `pdfplumber` 1 文件、`pypdf` 2 文件、`fitz` 1 文件，与 `agent.cordis.yml` 的禁令冲突 | 🔴 先调研 |
| 3.x 结构拆分 | 与平台无关，闸门在 Linux 上全绿 | 🔄 进行中 |
| 5.x 发布与门禁 | `.github/workflows/linux-release.yml` 已有 `test:all`+`regression`，但 `scripts/build-linux-release.sh` 仅 24 行（`git archive`+sha256，**零门禁**） | ⬜ 待做 |

## 8. 待建立的 Linux 体积门禁

路线书 0.3/5.1 的 Linux 对应物，应覆盖三个可测维度（当前**一个都没有**）：

1. **归档体积**：`dist/ibm-lab-agent-v<ver>-linux.tar.gz`（源码包，与 Python 无关）；
2. **venv 磁盘占用**：`$DSH_HOME/lab-agent/.venv` 的 site-packages 总量（本文件 §2 即其基线）；
3. **安装报告**：`install.sh` 已用 `pip --report` 产出
   `$DSH_HOME/lab-agent/python-linux-install-report.json`，可据其断言必需包仍在。

按路线书纪律，先只 `Write-Warning`，待基线稳定后再转强制；且必须**双向断言**
（上限 + 必需项下限），下限项至少含 `scipy/signal`、`nmrglue`、`markitdown`、`origin_mcp`。

## 9. 复现命令

```bash
# 闸门
npm run test && npm run regression && npm run lint \
  && npm run check:preset-exports && npm run check:client

# Linux Python 体积基线（隔离在 /tmp）
uv venv --python 3.12.11 /tmp/linux-baseline/venv
V=/tmp/linux-baseline/venv/bin/python
SP=/tmp/linux-baseline/venv/lib/python3.12/site-packages
uv pip install --python "$V" -r python/requirements.lock && du -sm "$SP"
uv pip install --python "$V" -r python/requirements-linux.lock && du -sm "$SP"
find "$SP" -type d -name tests -prune -exec du -sm {} + | sort -rn | head
```

## 10. 踩坑记录：composition 里的 `!!js` 不能写三元运算符

写 `cordis.patch.yml`（以及任何 cordis 组合）的 `!!js` 表达式时，**只能写不含
`?` 与 `: ` 的简单表达式**。

YAML 的 `? ` 是**复杂映射键指示符**，因此

```yaml
browserMode: !!js process.env['X'] ? 'a' : 'b'      # ❌
```

不会解析成标量，而是解析成映射对象：

```
{ '[object Object]': 'b' }
```

加载器随后把 `!!js …` 包装成惰性占位符 `{ __jsExpr: "<表达式原文>" }`；
被误解析的这一行连 `__jsExpr` 都没有，于是**静默传错值**，不报任何错。

生产里已被验证的写法是简单表达式，可安全裸写：

```yaml
command: !!js process.env['IBM_LAB_AGENT_BUNDLED_PYTHON']      # ✅
sessionsDir: !!js dshHomePath('lab-agent/literature-sessions')  # ✅
```

**为什么会漏掉**：基于「读文件 + 正则匹配原文 + 自行 eval」的断言**看不到这个错**——
它绕过了 YAML 解析，拿到的是自己 eval 出来的正确值，属于假阳性。必须用真实加载器
断言解析后的结构：

```js
import { composeEntries, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
const rows = composeEntries([loadOverlayPatches("test", patchPath)]);
// 再断言 config 的值要么是 string，要么是 { __jsExpr: string }
```

`tests/unit/capabilities.test.mjs` 的「防 YAML 误解析」用例就是这么写的，并且用变异
测试证明：注入裸三元 → 该用例失败并打印出 `{"[object Object]":"web-current"}`。

**结论性做法**：能放进 JS 的判断就不要放进 YAML。`browserMode` 最终没有写成
`!!js` 表达式，而是由 `lib/capabilities.js::defaultBrowserMode()` 在运行期决定，
YAML 里保持「不配置」，从而只有一个真源、也没有 YAML 转义陷阱。

