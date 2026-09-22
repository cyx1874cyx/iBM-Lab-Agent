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

## 16. 迁移期抓到的一个真缺陷：PowerShell 脚本的 BOM

这条与路线书无关，是"把开发搬到 Linux"过程中暴露出来的：`desktop/scripts/build-windows-release.ps1`
在 Linux 工作区（LF 行尾）**根本无法被 Windows PowerShell 5.1 解析**。

```
表达式或语句中包含意外的标记"}"。
所在位置 ...build-windows-release.ps1:205 字符: 1
```

第 205 行本身与 HEAD 逐字节相同、花括号 109/109 平衡 —— 报错位置是纯粹误导。机理：
PS 5.1 读取脚本走**系统 ANSI 代码页**（本机 GBK），含中文注释的**无 BOM UTF-8** 文件被按 GBK
解码，中文尾字节与紧随的 `\n` 组成非法双字节序列 → **吞掉换行** → 下一行代码被并进注释 →
花括号失衡，报在别处。

实测矩阵（7 个仓库 `.ps1`，Windows PowerShell 5.1）：

| 行尾 | BOM | 结果 |
|---|---|---|
| LF | 无 | **PARSE-FAIL**（`build-windows-release.ps1` 实测） |
| CRLF | 无 | OK |
| LF | **有** | OK |
| CRLF | **有** | OK |

三个含中文注释的脚本（`build-bundled-python.ps1` / `build-windows-release.ps1` /
`verify-package.ps1`）当时**都没有 BOM**。此前能出包，只是因为 Windows 侧 `core.autocrlf=true`
恰好检出成 CRLF；`.gitattributes` 并没有把 `*.ps1` 钉成 CRLF。换个检出方式（或经非 git 手段
传输、或有人"顺手"加一条 `*.ps1 text eol=lf`）就会在打包流程中段突然炸掉。

处置：给这三个文件加 **UTF-8 BOM**（与行尾无关，是根治），并把规则固化成
`tests/unit/powershell-source-encoding.test.mjs`（4 条断言，含检测器自证与
`.gitattributes` 不得声明 `*.ps1 eol=lf`）。变异验证：剥掉 BOM → 2 条失败；
注入 `*.ps1 text eol=lf` → 1 条失败；两次恢复均 md5 一致。

复现命令（WSL 侧即可，Windows PowerShell 走 interop）：

```bash
# 逐字节构造四种行尾/BOM 组合并送 PS 5.1 解析
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <probe.ps1>
```

注意：**从 WSL 写 .ps1 文件给 Windows 执行时，文件必须是纯 ASCII**（heredoc 生成的驱动脚本
就踩过这个坑，`ParserError: TerminatorExpectedAtEndOfString`）；而仓库里带中文注释的
`.ps1` 则必须带 BOM。两条规则互补，不要混用。

补一条实战教训：**BOM 会被写入工具静默丢弃**。本次加完 BOM 后又用编辑器改了几行注释，
BOM 就没了 —— 而该文件在 LF 下"碰巧"仍能解析通过（它的非 ASCII 没落在会吞换行的位置），
所以行尾解析探测**发现不了**。抓住它的是 `powershell-source-encoding.test.mjs`。
因此：改完这类文件要立刻跑守卫，守卫的失败信息里直接给了补 BOM 的命令。

## 17. P0 任务卡 0.1 已实施：bundled-python 的输入指纹

路线书 §0.1 的发现是真的，且**恰好卡住本次 S2/L2 的验证**：`build-windows-release.ps1`
原先只用 `Test-Path python.exe` 判断捆绑 Python 是否需要重建 —— **一次生成，永久跳过**。
第一次尝试出包时 `resources/python/dist/python.exe` 存在，于是 bundled-python 阶段被整段
跳过：**S2（摘 magika）与 L2（剥 tests 树）根本不会被执行，也就无从验证**。现场证据
（两次构建的 Windows 侧日志逐字对照，日志为 UTF-16LE，`iconv -f UTF-16LE` 可读）：

```
# 修复前 release-20260922-094808.log —— client-bundle-check 之后直接进 tests
[09:48:10] Windows release preflight passed for 0.5.2-rc.1.
[09:48:10] START client-bundle-check (timeout 5m). ...
[09:48:10] DONE client-bundle-check in 00:00:00.
[09:48:10] START tests (timeout 20m). ...          ← 没有 bundled-python

# 修复后 release-20260922-095141.log —— 多出判定行，且确实重建
[09:51:42] Windows release preflight passed for 0.5.2-rc.1.
[09:51:42] bundled-python: REBUILD (no stamp: 该产物早于指纹机制，无法证明它对应当前 recipe)
[09:51:43] START client-bundle-check (timeout 5m). ...
```

产物侧同样可查：`resources/python/dist/python.exe` 的时间戳是 `Apr 2 2024`（基础解释器
的日期），而 `resources/python/dist` 目录本身 11 天未变。

### 17.1 做法：单一实现 + 两侧共用

路线书给的是"两个 .ps1 各算一遍"的样例（比对 `requirements.lock` 与 builder 脚本哈希）。
两份逻辑必然漂移，且 `requirements.lock` 的 LF 归一化哈希项目里**已经有**
`src/python-lock-hash.js`。故改为一个 Node 工具、两侧共用：

| 位置 | 角色 |
|---|---|
| `scripts/bundled-python-inputs.mjs` | 唯一的指纹实现；`--print` / `--write <dir>` / `--check <dir>` |
| `build-bundled-python.ps1` 收尾 | `--write`：重建成功后写指纹 |
| `build-windows-release.ps1` | `--check`：判定不通过（含缺失/损坏）就重建 |

`--check` 始终以退出码 0 输出一行 JSON `{current, reason, changed}`：**判定结果不由退出码
表达**，只有工具内部出错才非零退出（调用方据此走重建分支）。这样"产物过期"与"工具坏了"
不会混为一谈。

比路线书多算的输入（都是**确实决定 dist 内容**的）：

- `src/markitdown-patch.js` + `scripts/patch-markitdown.mjs` —— 补丁的锚点/替换文本变了，
  产物里的 `_markitdown.py` 就不同；
- `vendor/mnova-mcp/`（树摘要）—— 第 4b 步是从它本地打 wheel 装进 dist 的，只有 272 KB；
- `runtime/versions.env` —— 版本 pin。

另外多一条过期轴：**被捆绑解释器的版本**（`--python-exe` 读 `sys.version`）。基础 Python
打补丁升级而 dist 未重建，也是静默过期。读不到版本时不参与判定（不能因"读不到"就把新鲜
产物判成过期）。

### 17.2 指纹文件放在 `desktop/.build/`，不是 `dist/`

路线书写的是 `$dist\.build-stamp.json`。**没有照做**，因为 `tauri.conf.json` 的
`bundle.resources` 是 `"resources/python/": "python/"` —— 整个目录打进安装包，放在那里会
把构建元数据一起出货。改放 `desktop/.build/bundled-python.stamp.json`（`/.build/` 已
gitignore）。两个失效方向都安全：dist 在而指纹被清 → 缺指纹 → 重建；指纹在而 dist 被删 →
`python.exe` 存在性检查兜住 → 重建。代价只是清掉 `.build` 会多重建一次。

### 17.3 判定行挪到 `-PreflightOnly` 早返回之前

原脚本的 `-PreflightOnly` 在 bundled-python 判定**之前**就返回了，按路线书的验收办法
（"连续跑两次 `-PreflightOnly`，第二次应跳过"）根本观察不到。故把判定挪到早返回之前：

```
[hh:mm:ss] bundled-python: REBUILD (no stamp: 该产物早于指纹机制，无法证明它对应当前 recipe)
```

这条让**不做任何构建**就能看出"这次会不会重建"，验收成本从 20 分钟降到几秒。

### 17.4 验收与守卫

| 场景 | 期望 | 实测 |
|---|---|---|
| 旧产物（无指纹） | REBUILD | `no stamp: ...` ✅ |
| 刚构建完再判 | reuse | 指纹一致 ✅ |
| `touch python/requirements.lock`（只改 mtime） | reuse（指纹认内容） | reuse ✅ |
| 真的改一个字节 | REBUILD 并指名 | `inputs changed: <该文件>` ✅ |
| 指纹缺失/损坏/方案版本变 | REBUILD | 三种分支各有断言 ✅ |

守卫是 `tests/unit/bundled-python-inputs.test.mjs`（6 条）与
`tests/unit/windows-bundled-python-recipe.test.mjs` 新增的 2 条（共 7 条）。其中一条断言
刻意验证"指纹认内容而非行尾"：同一份代码的 LF / CRLF / 带 BOM 三种形态**指纹必须相同**，
否则 Windows 与 WSL 会互相把对方的产物判成过期。

注意验收表第 3 行：`touch` 只改 mtime 不改内容，所以**不应**触发重建 —— 指纹认的是内容。
要验证"改内容 → 重建"，得真的改一个字节。

变异验证：把调用方改回 `if ($RebuildBundledPython -or -not (Test-Path ...))` → 1 条失败；
恢复后 md5 一致。第一次变异尝试时我的正则写的是 `\$bundledPython\)` 而变量现名
`$bundledPythonExe`，**没抓住** —— 已把正则改成 `\$bundledPython\w*` 并重做变异。这条
"守卫自己有没有漏洞"的教训值得单独记下来：**先证明守卫能失败，再相信它通过。**

## 18. 出包链路本身抓到的两个缺陷

指纹补齐后重新出包，构建**失败**了 —— 但失败原因与报错方式各暴露一个问题。

### 18.1 Windows 的 tests 阶段拦住了一个不可移植的单元测试（同类第 3 次）

```
✖ tests/unit/bundled-python-inputs.test.mjs:143 捆绑解释器版本变化会触发重建
  AssertionError: 解释器版本变化必须判为过期  true !== false
```

我在测试里造了一个 `#!/bin/sh` 的假解释器来测"解释器版本变化"这条轴。Linux 上能跑，
**Windows 上根本执行不了** → 读到版本为 null → 判定不变 → 断言失败。

这是同一类错误在本仓库的第 3 次（前两次：断言里硬编码 `/repo/vendor/...`；用
`split("\n")` 读 CRLF 文件）。三点结论：

1. `tests/unit/*.test.mjs` 与 `tests/integration/*.test.mjs` **在 Windows 上也会跑**，
   这是发布流水线的真实闸门，不是可选项；
2. "造一个假可执行文件"这种手法天生不可移植 —— 改为**依赖注入**
   （`writeStamp(..., { pythonVersion: "3.11.9" })`），测试不再启动任何进程，还更快；
3. 既然同类错误已经 3 次，就用机械守卫兜住能精确判定的两条：
   `tests/unit/test-suite-portability.test.mjs` 禁止测试里 `chmod` 造可执行 fixture、
   禁止硬编码 `/repo/` 绝对路径（`split("\n")` 刻意**不**守：仓库里有 12 处合法用法，
   一律禁掉会造出误报，可移植性的边界交给 Windows 的 tests 阶段裁决）。

该守卫第一次运行就误报了 —— 命中的是 `patch-dsh-runtime-writability.test.mjs` 注释里的
"chmod 0555" 四个字。**守卫匹配到注释里的文字**已经是本仓库第二次（前一次是
`markitdown[all]`），所以扫描前先剥注释，并排除守卫自身（它必须内含违规样本作为自测数据）。

### 18.2 驱动脚本把上一次的产物说成了本次结果

失败现场（退出码 1）之后紧接着打印的是：

```
=== exit code: 1 ===
  report: ...windows-release-20260922-013253\release-report.json   ← 上一次的
  installer: ...\bundle\nsis\iBM Lab Agent_0.5.2-rc.1_x64-setup.exe
  bytes: 195059271  sha256: 951576A26736C7284...                  ← 上一次的
[09:52:08] 结束，退出码 1
```

驱动脚本无条件取 `desktop/.build` 下**最新**的 `release-report.json`，并列出 `target` 下
**任意** `*-setup.exe` 及其 SHA256。于是一次失败的构建会在屏幕上留下"一份安装包 + 一个
有效哈希"，极易被当成成功（本人在这次就一度看错）。

改法：记录 `$startedAt`（构建开始前的时间戳），只认**本次构建之后生成**的报告；失败时
明确输出 `THIS RUN PRODUCED NO ARTIFACT`，若仍列出既有产物则标注
`stale artifact from an earlier build` 并附 mtime。守卫见
`tests/unit/windows-release-from-wsl.test.mjs` 的新增条。

顺带一条自身教训：我用 `bash driver.sh | tee log` 启动，**管道的退出码取 `tee` 的值**，
所以作业上报 exit 0 而实际是 1。看结论要看驱动自己打印的"结束，退出码 N"，别信外层管道。

## 19. 修复后重新出包：实测收益与验收

同一台 Windows 机器、同一套流程，改动前后各出一次包。

### 19.1 结果

| 项 | 修复前（S1 only） | 修复后（S1+S2+L2+P0） |
|---|---|---|
| 安装包 | 195,059,271 B | **172,121,032 B** |
| SHA-256 | `951576A2…6D755005` | `C127F547…EB41B23B` |
| 阶段 | 无 bundled-python（被跳过） | bundled-python 217.5s + 其余全绿 |

**−22,938,239 B（−21.9 MiB，−11.8%）**，全程 exit 0，`verify-installer` 真启动了打包后的
应用（23.2s）。

### 19.2 三条验收（都不只看构建脚本的自述）

**① S2 摘除，独立在文件系统上核验**（不是读构建日志）：

```
magika      已摘除      onnxruntime  已摘除
flatbuffers 已摘除      coloredlogs  已摘除
```

构建期自检亦通过：`magika chain absent: OK`。补丁也真的落在产物文件里：
`dist/Lib/site-packages/markitdown/_markitdown.py` 含 `IBM_LAB_AGENT_NO_MAGIKA` 标记。

**② L2 剥离，且没有误伤公共 API**：

```
Stripped third-party test trees: 358.9 MB -> 320.7 MB     （−38.2 MB）
剥离后残留 tests/test 目录数：0
保留：numpy/testing、pandas/testing.py、scipy
```

过程中我自己的核验脚本误报过一次：用 `[ -e .../pandas/testing ]` 判断，而 pandas 3.x 的
`pandas.testing` 是**模块文件** `testing.py`，不是目录 —— 是检查写错，不是产物有问题。
`pandas/tests`（测试套件）按设计被剥离。

**③ 五种格式的真实转换**：`markitdown conversion self-check OK: 5 formats`
（pdf/docx/pptx/xlsx/html）。这条比 `import markitdown` 强得多：依赖集少一个包只会表现为
运行期 `MissingDependencyException`，只有真的转一遍才抓得住。

**④ P0 指纹在生产里生效**：紧接着再跑一次预检 ——

```
[10:18:44] Windows release preflight passed for 0.5.2-rc.1.
[10:18:44] bundled-python: reuse (fingerprint matches)
```

这正是路线书要求的验收（"第二次应跳过 bundled-python"），且**不做任何构建、几秒内**就能
看到。

### 19.3 一个必须说清楚的口径问题：原始字节 ≠ 安装包字节

S2+L2 在磁盘上共减去约 **78 MB**（S2 ~40 MB + L2 38.2 MB），但安装包只小了 **22.9 MB**
（比值约 0.29）。原因是 NSIS 用 LZMA 固实压缩，wheel 里的 `.py` 压缩率很高。

所以路线书 §11"收益汇总"里按**原始 MB** 写的数字（S2 −65 MB、L2 −40 MB 之类）**不能**直接
当成安装包收益来读：对用户可见的指标是安装包体积，而它大约只有原始值的 3 成。
本项目真正需要盯的口径是 `desktop/src-tauri/target/release/bundle/nsis/*-setup.exe` 的字节数。

另：路线书给 S2 估的是 −65 MB，本机实测 Windows 侧整链约 40 MB（magika 4 + onnxruntime 33
+ flatbuffers/coloredlogs/humanfriendly/protobuf）—— Linux 侧 onnxruntime 是 62 MB，
**两条线的这个包大小本来就不一样**，不能互相套用。

### 19.4 全流程耗时

`09:58:26 → 10:16:02`，约 **17.6 分钟**：client-bundle-check 0.2s / tests 21.2s /
regression 1.8s / preset-exports 0.1s / browser-ketcher 22.0s / lint 2.7s /
**bundled-python 217.5s** / prepare-runtime 6.0s / verify-runtime 35.5s /
**tauri-nsis 723.3s** / verify-installer 23.2s。两个大头是 pip 装依赖与 Rust 编译。
