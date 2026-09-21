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
| L3 | `magika` + `onnxruntime` + `flatbuffers` + `protobuf` | ~~66 MB~~ → **0** | ✅ 已实施：markitdown 把 magika 列为**无条件**依赖，无法照路线书用 `--no-deps` 硬摘；改为打「magika 可选化」补丁（`src/markitdown-patch.js`）。实测 −65 MB，7 格式逐字一致 | 🟢 已验证（见 §13） |
| L4 | `matplotlib` 25 M + `fontTools` 23 M | **48 MB** | `process_1d.py:295-300` 是 `except ImportError: plt = None`，**软依赖** | 🟡 需 S3 拍板 |
| L5 | `pytest` + `iniconfig` + `pluggy` | **3 MB** | 项目自有 Python 测试用 **unittest**（`npm run test:bridge`），全仓库对 pytest 的唯一引用就是 `requirements.lock:72` 自身 | 🟢 低，但见 §6 的耦合 |
| L6 | `pygments` 5 M、`rdkit-stubs` 4 M | **9 MB** | 运行期无引用（stubs 为类型存根） | 🟢 低 |

**已回收：L1 63 MB + L2 44 MB + L3 65 MB = 172 MB（venv）＋ S1 32.2 MiB（归档）**
**待回收（不含已判定保留的 L4）：L5 3 MB + L6 9 MB = 12 MB**

> L4（matplotlib 25 MB + fontTools 23 MB）经核实**判定保留**：`SKILL.md:32` 要求 preflight
> 必须确认 `matplotlib` 存在，`process_1d.py:301-316` 会产出 `processing_quicklook.png`。
> 按路线书自己的判据（「是否承诺出谱图？是 → 保留」）结论是保留。

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
| 0.3 体积门禁（只报警） | `scripts/linux-release-preflight.mjs`：归档体积告警 + 必需项下限 | ✅ 完成（见 §8） |
| 0.4 回归基线快照 | §1 全绿 | ✅ 完成 |
| 1.1 pycache 红利 | 不适用（无 `pip --target` 产物缓存） | 不适用 |
| 1.2 剔除第三方 tests/ | **L2**：`install.sh` 的 `strip_python_test_trees()`，实测 −44 MB，含 import 守卫 + 变异测试 | ✅ 完成（见 §5） |
| 1.2' Windows 侧同样扩展 | 路线书原文要求扩 `build-bundled-python.ps1:86-89`；本机无 pwsh/Windows，**不写不可验证的发布流水线改动** | ⬜ 留给 Windows 机器 |
| 1.3 vendor 白名单 | `vendor.manifest.json` + `src/vendor-manifest.js` + `scripts/prune-vendor.mjs`。剔除 `figures4papers`(28.97 MB/70 文件) 与顶层 `assets`(4.75 MB/6 文件) = **32.2 MiB**；归档 −54.9%。记录写入 `vendor.lock.json.vendorManifest`，`pin-vendor.mjs` 每次升级后幂等重应用 | ✅ 完成（见 §8.3） |
| 1.4 import 探测脚本 | `scripts/audit-imports.mjs`：静态扫描（正确正则）+ 运行期追踪 + 锁文件差集 | ✅ 完成（见 §11） |
| 2.1 摘 magika 链 | **L3**：markitdown 0.1.7 把 magika 列为**无条件**依赖（`_markitdown.py:15 import magika` + `__init__` 里无条件 `magika.Magika()`），故路线书的「`--no-deps` 手工摘」按字面**不可行**——摘掉后 `import markitdown` 直接失败（已实测）。改为打「magika 可选化」补丁（锚点 + sha256 + 可回滚） | ✅ 完成（见 §13） |
| 2.2 matplotlib 策略 | **L4**（48 MB）→ **判定保留**：`SKILL.md:32` 要求 preflight 确认 matplotlib，`process_1d.py` 产出 quicklook 图；按路线书判据属「承诺出图」 | ✅ 已裁定（见 §3） |
| 2.3 双 PDF 栈收敛 | 同样存在：`PyMuPDF`(60 M)+`pdfminer.six`(9 M)+`pdfplumber`+`pypdf`+`pypdfium2`；`vendor/` 中 `pdfplumber` 1 文件、`pypdf` 2 文件、`fitz` 1 文件，与 `agent.cordis.yml` 的禁令冲突 | 🔴 先调研 |
| 3.x 结构拆分 | 3.1 `lib/tasks/*`、3.2 `capabilities`、3.3 `adapters/browser`、3.4 `applications/registry` 均已落地并通过闸门 | ✅ 完成 |
| 5.x 发布与门禁 | `scripts/linux-release-preflight.mjs` + CI 在 `Build Linux archive` 后调用 `--report-only`；`build-linux-release.sh` 仍只负责出包 | ✅ 完成（见 §8.4） |

## 8. Linux 体积门禁（已建立）

路线书 0.3/5.1 的 Linux 对应物：`scripts/linux-release-preflight.mjs`，做**双向断言**。

### 8.1 归档体积基线（实测）

```
bash scripts/build-linux-release.sh HEAD     # → dist/ibm-lab-agent-v0.5.2-rc.1-linux.tar.gz
```

| 时点 | 归档字节 | 说明 |
|---|---|---|
| `release-0.5.0` + Phase 3 拆分后 | 51,291,488 (48.9 MiB) | 初始基线 |
| **vendor 白名单剔除后（当前）** | **23,122,955 (22.1 MiB)** | **−26.9 MB / −54.9%** |

当前值即脚本里的 `SIZE_BASELINE_BYTES`；告警阈值 = 基线 × 1.10 = 24.3 MiB。
注意 `build-linux-release.sh` 用的是 `git archive HEAD` —— **读已提交的树**，
所以剔除后必须先提交再打包才能看到效果（实测踩过：未提交时归档体积纹丝不动）。

按路线书纪律，体积超标**只告警不阻断**（Phase 0.3），退出码仍为 0；Phase 5.1 才转强制。

### 8.2 下限断言（必需的"东西还在"）

- 25 个必需路径，含 Phase 3 拆分后的 `lib/tasks/index.js`、`lib/capabilities.js`、
  `lib/adapters/browser.js`、`lib/applications/registry.js`；
- 19 个 nature skill 与 `vendor.lock.json` 的 `skills` 登记数量一致；
- 4 个 bash 入口 `bash -n`；
- 发布要求工作区干净（`--allow-dirty` 可跳过）。

### 8.3 归档体积构成与已发现的冗余（**仅记录，未擅自删除**）

| 项 | 体积 | 说明 |
|---|---|---|
| `client/assets/ketcher-standalone` | 30 MB | 预构建编辑器，单文件 `index-*.js` 即 28.9 MB；**必需** |
| `vendor/.../nature-figure/assets/figures4papers` | ~~28.97 MB~~ → **0** | ✅ 已剔除（S1）：上游 `manifest.yaml` 标为 `references.on_demand`，且 `demos.md` 声明不由根 MIT 覆盖 |
| `vendor/nature-skills/assets`（README 配图） | ~~4.75 MB~~ → **0** | ✅ 已剔除：经全仓核查无任何 skill 引用 |
| `scripts/pdf-viewer-shell/public/{pdf.worker,pdf.worker.min}.mjs` | 3.5 MB | 与 `client/assets/pdf-viewer-standalone/` 下同名文件 **sha256 完全相同** → 纯冗余（提交了两次） |

> 剔除 `figures4papers` 与 README 配图会让 `vendor/` 偏离固定 commit，需同步
> `vendor.lock.json` —— 属路线书 **停车点 S1**，本文件只记录实测数字，不擅自改动。

### 8.4 用法

```bash
node scripts/linux-release-preflight.mjs                 # 预检 + 闸门 + 体积
node scripts/linux-release-preflight.mjs --report-only   # 只做必需项 + 体积（CI 构建后）
node scripts/linux-release-preflight.mjs --json
node scripts/linux-release-preflight.mjs --tarball <path> --size-ceiling-mb <n>
```

CI（`.github/workflows/linux-release.yml`）在 `Build Linux archive` 之后、
`upload-artifact` 之前调用 `--report-only`。

### 8.5 尚未覆盖的维度

1. **venv 磁盘占用**：`$DSH_HOME/lab-agent/.venv` 的 site-packages 总量（§2 即其基线）。
   该目录在发布时不存在，只能在安装后测量；要纳入门禁需在 CI 里真跑一次 `install.sh`
   （当前被 `soffice` 硬依赖阻断，见 §5 末与停车点）。
2. **安装报告**：`install.sh` 已用 `pip --report` 产出
   `$DSH_HOME/lab-agent/python-linux-install-report.json`，可据其断言必需包仍在；
   目前必需包的下限断言放在 `install.sh` 内的 import 守卫（见 §5）。

## 9. 复现命令

```bash
# 闸门
npm run test && npm run regression && npm run lint \
  && npm run check:preset-exports && npm run check:client

# 一条命令跑完预检 + 闸门 + 体积（推荐；等价于上面 + 必需项/体积断言）
node scripts/linux-release-preflight.mjs

# 出包后再做一次必需项与体积检查（CI 即此用法）
bash scripts/build-linux-release.sh HEAD
node scripts/linux-release-preflight.mjs --report-only

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


## 11. import 可达性审计（路线书 1.4）

`scripts/audit-imports.mjs`：为「依赖能不能删」提供**证据**。此前一次真实误判是把
scipy（143 MB）当成可删，根因是静态扫描用了 `^import`，漏掉函数体内的缩进导入。

### 11.1 那个坑的实测（`process_1d.py`）

| 正则 | 命中行数 | 漏掉的 |
|---|---|---|
| `^\s*(?:import\|from)\s+`（本工具） | **15** | — |
| `^import`（历史误用） | **6** | `nmrglue`(143)、`scipy.signal`(147)、`matplotlib`(295/297)、`shutil`(83) |

漏掉的恰好就是 scipy 与 nmrglue —— 这就是那次误判的完整机制。

### 11.2 两条互补证据

- **静态扫描**：正则允许任意缩进层级，能看见函数体内的导入；
- **运行期追踪**：`<python> -X importtime <target>`，只统计**真正被导入**的模块。

两者**分开列示**，不合并成一个「可删」结论：函数体内的导入只有走到那条代码路径才会
出现，所以「运行期没出现」不等于「用不到」。硬/软依赖同样分开看（路线书纪律 #2）——
`process_1d.py:295-300` 的 `import matplotlib` 就在 `except ImportError: plt = None` 里，
是软依赖，一样不能删。

### 11.3 验收（路线书原文要求的三条）

交付内容：`node scripts/audit-imports.mjs --target <process_1d.py> --python <venv/bin/python>`
输出必须含 `nmrglue` 与 `scipy`，且不含 `pandas`。实测：

```
静态扫描命中模块 : __future__, argparse, csv, datetime, json, math, matplotlib,
                   nmrglue, numpy, pathlib, scipy, shutil, sys, typing
运行期实际导入   : （仅 import 模块时）不含 nmrglue/scipy
运行期退出码     : 2（argparse 缺参；如实标注运行期证据不完整）
可达发行版       : matplotlib, nmrglue, numpy, scipy          ← 含 nmrglue 与 scipy ✓
⚠ 仅静态可达     : matplotlib, nmrglue, scipy                 ← 如实标注需补调用路径
```

### 11.4 "逐功能路径触发"的实证

用同目录的 `simulate_1d.py` 生成合成 FID，再让 `process_1d.py` 真正处理它，然后把该
调用作为 `--run-args` 交给审计：

```
simulate_1d.py  model.json --output /tmp/nmr-e2e/fid        → 合成 Varian FID（readback 误差 0）
process_1d.py   .../synthetic_1d.fid --output ... --overwrite → 105 个峰，输出 4 个文件
audit-imports.mjs --target process_1d.py --run-args "<上面的参数>"
```

结果：运行期追踪**捕获到 `nmrglue` 与 `scipy`**，"⚠ 仅静态可达"整行消失 ——
证明"逐功能路径触发"能闭合静态与运行期的差距。该次可达发行版为：
`charset-normalizer, cycler, defusedxml, fonttools, kiwisolver, matplotlib, nmrglue,
numpy, packaging, pillow, pyparsing, python-dateutil, scipy, six`（`pandas` 始终不出现）。

### 11.5 锁文件差集（Phase 2 决策依据）

`--lock python/requirements.lock` 报告「锁定但未被本次路径触达」的发行版。单一 NMR
路径触达 66 个锁定包中的 13 个，其余 53 个列为**候选**。

> ⚠ 候选 ≠ 可删。真实反例就在本次结果里：`contourpy` 被列为未触达，但它是 matplotlib
> 的**惰性依赖**（只在画等高线时导入）。动态导入、插件注册表、CLI 入口同理。
> 该工具**只读不写**：不删文件、不改锁文件。

## 12. Phase 3.2 的 5 处平台假设：逐条去向

路线书列出 5 处隐式平台假设。逐条核实后的去向（避免以后重复调研）：

| # | 假设 | 位置 | 去向 |
|---|---|---|---|
| ① | 假设 node_modules 可写 | `scripts/patch-dsh-runtime.mjs` | ✅ 已处理：写失败（备份拷贝与 `atomicWrite` 两条路径）统一转成带 errno、成因与出路的提示，不再抛裸 `EACCES/EROFS`。见 `tests/unit/patch-dsh-runtime-writability.test.mjs` |
| ② | 硬编码 `browserMode: 'desktop-edge-handoff'` | `cordis.patch.yml` | ✅ 已处理：改为运行期探测（`lib/capabilities.js`），Linux 解析为 `web-current` |
| ③ | 假设 `window.parent` 是 Tauri | `client/src/lib.js:241-304` | ✅ **原本已优雅**：4 秒超时后给出「请检查是否运行在 iBM Lab Agent 桌面版」，不静默挂起。仅文档化，无需改码 |
| ④ | 假设捆绑 Python 存在 | `desktop/src-tauri/src/runtime/process.rs:205-214` | ✅ **原本已按隔离边界设计**：`src/python-env.js::pythonCandidates` 在设置 `IBM_LAB_AGENT_BUNDLED_PYTHON` 时 `allowSystemFallback !== true` 即**不回落**系统 Python。桌面专属，Linux 线走 venv，无需改码 |
| ⑤ | 强依赖 `soffice` | `scripts/install.mjs`、`install.sh`、`runtime/apt-packages.txt` | ✅ 已处理（路线书 4.3，见 §14）：安装期改为**警告不阻断**；仍默认安装 LibreOffice |

结论：Phase 3.2 的验收（① browserMode 运行期探测 ② Linux 不再命中 Windows 分支 ③ 回归全过）
均已满足；5 处假设中 4 处已闭环，剩余 1 处是停车点。

## 13. S2 已实施：摘除 magika→onnxruntime 链（−65 MB）

### 13.1 为什么不能照路线书原文做

路线书 2.1 的方案 A 是「上游 markitdown + `--no-deps` 手工摘 magika」。实测**不可行**：

```
$ rm -rf site-packages/{magika,onnxruntime}
$ python -c "import markitdown"
ModuleNotFoundError: No module named 'magika'
```

原因：`markitdown/_markitdown.py:15` 是**顶层 `import magika`，无 try/except**，
且 `__init__` 里无条件 `self._magika = magika.Magika()`。magika 不是 extra，是
无条件依赖；它又要求 `onnxruntime`（实测 60.9 MB）。

另外 `identify_stream` 的调用点只在 `try/finally` 里（**没有 except**），所以
"塞一个会抛异常的 stub"也会炸——只有"返回非 ok 状态"才等于优雅降级。

### 13.2 实际做法：把 magika 变成可选

`src/markitdown-patch.js` + `scripts/patch-markitdown.mjs`（沿用
`patch-dsh-runtime.mjs` 的范式：marker + 锚点 + sha256 校验 + 可回滚 + `.bak`）：

| 钩子 | 补丁 |
|---|---|
| imports | `import magika` → `try: import magika / except ImportError: magika = None` |
| constructor | `magika.Magika()` → `magika.Magika() if magika is not None else None` |
| stream-info | `self._magika.identify_stream(...)` → `... if self._magika is not None else None`，条件加 `result is not None` |

语义等价：magika 在 `_get_stream_info_guesses()` 里只用于在扩展名/mimetype 之外
**细化**流类型猜测，非 ok 时本来就回退 `enhanced_guess`（扩展名猜测）。本插件按
扩展名显式判定（`lib/convert.js` 的 `CONVERTIBLE_UPLOAD_EXTENSIONS`），不依赖内容嗅探。

锚点不匹配（例如未来 markitdown 自己把 magika 变可选）时**拒绝修改**并明确报错，
不会猜着改。

### 13.3 装法（install.sh 第 5 步与 install-markitdown.mjs 一致）

```bash
pip install -r python/requirements-linux.lock      # 格式依赖，全部精确 pin
pip install --no-deps 'markitdown==0.1.7'          # 本体：不加 --no-deps 就会拉 magika
node scripts/patch-markitdown.mjs patch --target <venv>/.../markitdown/_markitdown.py
```

`markitdown` **刻意不写进锁文件**：只要写进去，`pip install -r` 就会解析出 magika。

### 13.4 证据

**负对照（证明装法是承重的，不是摆设）**：

| 对照 | 命令 | 结果 |
|---|---|---|
| A | `pip install --dry-run 'markitdown==0.1.7'`（不加 `--no-deps`） | 解析出 `magika-0.6.3`、`onnxruntime-1.30.0` |
| B | `pip install --dry-run -r python/requirements-linux.lock` | ✅ 不含 magika/onnxruntime |

**全新环境实测**（`uv venv --python 3.12.11`，逐步执行上面的装法）：

```
基础锁           428 MB
+ 格式依赖       575 MB
+ markitdown     576 MB      → Linux extras 共 148 MB（原为 ~270 MB）
打补丁           patched markitdown 0.1.7: magika 变为可选
smoke test       import markitdown; MarkItDown()  OK
```

7 格式转换与含 magika 时**逐字一致**：`.docx OK:161 / .epub OK:158 / .html OK:56 /
.pdf OK:343 / .pptx OK:97 / .xls OK:61 / .xlsx OK:68`。
移除 `onnxruntime / magika / flatbuffers / protobuf`（−65 MB）；
保留 `mammoth` 与 `cobble` —— `cobble` 是 **mammoth 的依赖**
（`mammoth requires cobble<0.2,>=0.1.3`），误删会让 `.docx` 报
`MissingDependencyException`（实验中被真实抓到过一次）。

### 13.5 一个过程中踩到的错

我第一版闭包脚本跳过了「带 extra 条件」的依赖，于是 `mammoth` 不在根集合里、
`cobble` 被误判为 magika 独占的孤儿。删掉后 `.docx` 立刻失败。教训与路线书纪律 #2
一致：**extra 依赖不等于可选依赖** —— 我们**需要** docx 这个 extra，它的依赖
（mammoth → cobble）就必须留在保留集合里。

## 14. 4.3 已实施：soffice 不再阻断安装

**改动前**：`install.mjs` 缺 soffice 直接 throw；`install.sh --skip-system-deps` 直接
`exit 1`；`apt-packages.txt` 注释写着 "Office preview is intentionally hard-required:
no text-only fallback"。后果：**没装 LibreOffice 的机器完全无法安装**（「形态① 即插即用」
在这类机器上直接不可用）。本机也因此一直无法端到端跑完 `install.sh`。

**改动后**：安装期只给可操作警告并继续；LibreOffice 仍默认安装。

为什么改成警告是安全的：运行期本来就不静默降级 —— `lib/office-preview.js` 的注释写明
`a missing renderer is an environment error`，`lib/artifact-download.js` 在缺渲染器时
明确返回 **503**。所以安装期不必替运行期做决定；把缺失当成安装失败，反而把"没装
LibreOffice"和"装不上"混为一谈。

**顺带修掉一个真实缺陷**：`install.mjs` 原先自己跑 `soffice --headless --version` 探测，
在 Windows 上会**误判**——`soffice.exe` 是 GUI 启动器，stdout 被管道化时常常不输出版本，
必须用同目录的 `soffice.com`。现在改为复用 `lib/office-preview.js::resolveSofficeExecutable`
（已有自己的单元测试，且覆盖典型安装路径与 PATH 查找顺序）。

验证：
- `node scripts/install.mjs --skip-python --dsh-home /tmp/e2e-dsh`（本机无 soffice）
  → 打印警告后**继续**，完成 vendor 同步 / preset 安装 / 19 个 skill 注册，退出码 **0**；
  且同步出的 vendor 树为修剪后的 **11 MB**（`figures4papers` 未被同步回来，兼验 S1）。
- 源码级守卫（`tests/unit/office-preview-install.test.mjs`）：install.mjs 复用解析器且
  探测函数内无 `throw`、install.sh 该分支无 `exit 1`、apt-packages.txt 不再声明硬依赖。
- 隔离的完整安装 E2E：以普通用户（`install.sh` 拒绝 root）在无 soffice 的机器上跑
  `--skip-system-deps`，确认 `[2/8]` 不再中止并继续到后续阶段。

## 15. 完整安装 E2E：抓到一个使一行式安装必然失败的缺陷

### 15.1 怎么跑（可复现）

`install.sh` 刻意拒绝 root（`EUID -ne 0`），所以隔离验证需要一个普通用户：

```bash
useradd -m -s /bin/bash e2etest
tar -C <repo> --exclude=node_modules --exclude=.git --exclude=dist -cf - . \
  | tar -C /tmp/ibm-src -xf - && chown -R e2etest /tmp/ibm-src
rm -rf /tmp/e2e-data /tmp/e2e-dsh          # 必须由 root 清理：root 建的目录 e2etest 删不掉
su - e2etest -c 'bash /tmp/ibm-src/install.sh --source-dir /tmp/ibm-src \
  --skip-system-deps --no-dsh-patch --data-dir /tmp/e2e-data --dsh-home /tmp/e2e-dsh'
```

⚠️ 第一次尝试时我把 `rm -rf` 放在 `su` 内部，结果 e2etest 删不掉 root 遗留的
`/tmp/e2e-dsh`，`install.mjs` 在 `rmdir` 上报 EACCES —— 那是**测试脚本的 bug**，
不是产品问题。

### 15.2 抓到的产品缺陷：`[6/8]` 从无 node_modules 的目录执行脚本

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-app-boot'
  imported from /tmp/ibm-lab-agent-install.XXXX/source/src/ibm-lab-profile.js
```

`$tmp_root/source` 是 tar 复制的源码快照，按设计**排除 node_modules**；`npm ci` 只装在
`$release_dir`。而 `[6/8]` 的 `ensure-ibm-lab-profile.mjs` 从 `$tmp_root/source` 执行，
它经 `src/ibm-lab-profile.js` import `@deepseek-ai/dsh-app-boot` —— 必然失败。
**即官方的一行式 Linux 安装此前固定卡在 6/8**（`--source-dir` 与下载 GitLab 归档两条路径
都没有 node_modules）。修法：改从 `$release_dir` 执行。

对照：`[4/8]` 的 `patch-dsh-runtime.mjs` 也在 source 里跑，但那时 `$release_dir` 尚未
创建，且它只 import 本地模块 —— 是安全的，**不动**。守卫因此只管 `release_dir` 创建之后的
部分（`tests/unit/install-sh-script-paths.test.mjs`）。

### 15.3 全绿结果（隔离、无 soffice、普通用户）

```
[2/8] 警告：未找到 LibreOffice soffice —— 安装继续（不再中止）
[5/8] 已剥离第三方测试树：718 MB → 628 MB
[6/8] ibm-lab profile ready / default preset -> lab-research
[8/8] 安装完成   iBM Lab Agent 0.5.2-rc.1 / DSH 0.1.5-rc.1
退出码 = 0
```

产物核验：`current` 软链指向 release；venv 为 Python 3.12.11；
**magika / onnxruntime / flatbuffers / protobuf 缺失**（S2）；mammoth / cobble 保留；
`markitdown OK (magika optional)`；补丁 `present`；vendor 树 **11 MB** 且
`figures4papers` 不存在（S1）；`doctor-linux.json` 已生成。

耗时约 **2 分钟**（00:54:23 → 00:56:17）—— 补上 pip 镜像后从"一个多小时"降到分钟级。
