# 手工下载文献自动捕获（Manual Browser Capture）

文献精读条目中「未获取」的灰色 PDF/SI 按钮支持**手工下载自动捕获**：
点击按钮 → 同步打开 DOI 出版社页面 → 服务端创建一次性捕获任务 →
你在出版社页面手工下载 PDF/SI → Chrome/Edge 扩展（经本地桥接）捕获这一份下载并
上传 → 服务端校验后登记到原 bundle → 页面刷新，按钮点亮。此后点击直接下载
已归档文件。

## 工作流程

```
用户点击灰色 PDF/SI 按钮
   │ ① window.open(https://doi.org/<doi>)         （同步打开，避免弹窗被拦截）
   │ ② manual_capture_create → { task, token }     （一次性令牌，仅存哈希）
   │ ③ window.postMessage(ARM_CAPTURE) → 扩展 content script → Service Worker
   ▼
用户在新打开的出版社页面下载 PDF / SI
   │ chrome.downloads.onChanged 匹配类型（PDF→.pdf；SI→pdf/zip/docx/xlsx/csv/txt/cif/sdf）
   │ 扩展只捕获布防之后的下一份**匹配**下载；其余下载一律忽略
   ▼
Service Worker → Native Messaging（桌面内置 Node Host；开发回退为 host.py）
   │ 桥接读取该下载文件（绝对路径必须位于批准的下载目录内）并 PUT 上传
   ▼
PUT /api/lab-capture-upload?token=...   （一次性令牌 + native-bridge 来源；100 MB 上限）
   │ %PDF- 头 / %%EOF / 大小 / SHA-256 校验（PDF）；扩展名白名单（SI）
   │ 临时文件 + 原子重命名保存到 课题工作区/captured-literature/<bundleId>/
   ▼
LabTasksService.registerCapturedFile（复用原 bundleId/reportId，不新建文献）
   │ PDF → pdfPath/pdfSha256/acquisitionStatus=ready；SI → siPath/siSha256
   │ 记录 provenance source = manual-browser-capture
   ▼
桌面页面轮询服务端任务状态 → 重新拉取 workspace → 按钮点亮
```

## 安全边界

- 只有收到本机桌面 handoff 页面明确的 `ARM_CAPTURE` 消息后才开始监听下载；一次只允许一个
  待捕获任务；只捕获布防之后出现的下一份匹配下载。
- 令牌为 32 字节随机一次性值，**数据库只存 SHA-256**，明文只在创建响应中出现一次；
  完成 / 失败 / 过期后令牌立即失效，重放返回 409。
- 令牌绑定 projectId / bundleId / PDF 或 SI 类型 / 到期时间（默认 20 分钟）。
- 上传端点只允许合法 `chrome-extension://` Origin（或同源 / 本地桥接）；
  不读取 Cookie，不监控其他下载，不按文件名匹配历史文件。
- 文件名清洗路径字符、禁止目录穿越；保存目录由服务端从课题工作区构造
  （`captured-literature/<bundleId>/`），不接受客户端提供的保存路径。
- 微信来源仅使用 DOI 出版社页面；**无 DOI 时拒绝启动捕获，绝不回退到公众号链接**。
- 捕获只登记原始文件，不自动冒充已完成全文精读（不生成报告、不改变报告状态）。

## 捕获后的精读顺序

1. 生成报告前调用 `lab_tasks_get_reading_inputs`，盘点该文献当前已登记的正文
   PDF、SI 与 source-map；逐个读取所有 `available=true` 的资源，不能只依据元数据
   或公众号导读。
2. PDF/Office 先通过 `lab_convert_document` 转为 Markdown，再读取正文；正文与 SI
   的证据在报告中分别标注来源。
3. 查询并读取课题的阅读笔记模板，报告严格沿用模板章节、风格和证据要求。
   Nature Skills 可用于全文解析和证据提取，但只要存在阅读笔记模板，就不能用
   `nature-paper-card` 的 01–16 卡片结构覆盖模板；仅无模板时才回退该结构。
4. 用 `lab_tasks_register_report` 登记生成的 Markdown，并传入实际采用的
   `noteTemplateId` / `noteTemplateVersion` 固化模板快照。

## 为什么需要本地桥接（P1 验证结论）

Chrome 扩展 **Service Worker 不支持稳定读取下载后的本地文件**；`chrome.downloads`
返回绝对本地路径。因此采用 **Chrome Native Messaging 本地桥接**：

- 扩展只向桥接程序发送：一次性上传地址（含 token）、任务编号、Chrome 返回的下载路径；
- 桌面版内置的 Node Native Host（独立开发时可用 `native-bridge/host.py`）解析
  Chrome/Edge 配置与系统 Downloads 目录，只允许读取这些目录内的**指定文件**并 PUT 上传；
- 桥接不读取 Cookie、浏览历史或任何其他文件。

扩展只向桌面应用生成的本机 `127.0.0.1/localhost` `/lab/capture/?taskId=...` handoff 页面
静态注入布防桥，不提供站点信任功能，也不注入普通 iBM、出版社或机构页面。后台
同时校验 handoff 任务编号、端口同源和一次性上传地址，其他网页无法布防。

## 安装

### 1. Ubuntu 服务端升级

在运行 iBM Lab Agent 的 Ubuntu 服务器上更新代码（确保已安装 Node.js ≥ 20）：

```bash
cd <iBM-Lab-Agent 仓库目录>
git pull
npm install --no-audit --no-fund          # 拉取新依赖（无新增依赖也可跳过）
node scripts/install.mjs --strict --force-preset --force-vendor   # 部署/更新插件
```

重启 Web 服务后验证：

```bash
curl -sS -i -X OPTIONS http://127.0.0.1:3080/api/lab-capture-upload | head -5
# 期望：HTTP/1.1 204 No Content。若设置了 IBM_LAB_AGENT_PORT，请替换 3080。
```

### 2. Chrome / Edge 扩展

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启右上角
   **开发者模式**；
2. 点击 **加载已解压的扩展程序**，选择
   `browser-extension/ibm-literature-capture/` 目录；
3. 记下扩展卡片上显示的 **32 位字母 id**（形如 `abcdefghijklmnop…`，全部是
   a–p 字母）；
4. 启动 iBM Lab Agent 桌面应用，桌面版会自动注册内置 Node 桥接。仅在不运行桌面版的
   独立开发环境中，才需用 Python 手动安装：

   ```cmd
   cd browser-extension\ibm-literature-capture\native-bridge
   python install-bridge.py <上一步的扩展 id>
   ```

5. 回到 `chrome://extensions`，点击扩展卡片的 **刷新** 按钮重新加载；
6. 进入桌面应用的文献精读，点击灰色 PDF/SI 按钮验证；无需授权或信任网页。

> 若扩展 id 因重新打包而变化，需要重新运行 `install-bridge.py <新 id>`。

### 3. 取消安装

```cmd
cd browser-extension\ibm-literature-capture\native-bridge
python install-bridge.py --uninstall
```

然后在 `chrome://extensions` 中移除扩展。

## 失败排查

| 现象 | 原因与处理 |
|---|---|
| popup 显示「本地桥接未注册 / Specified native messaging host not found」 | 桌面端未启动、版本低于 0.1.11，或开发 Host 未注册。正式桌面版请升级并重启；只用源码开发 Host 时运行 `python install-bridge.py jgmbofdnfjolmoipffalikkhmofnibaf`，再用 `--verify` 校验 |
| 页面提示「未收到文献捕获扩展确认」 | 扩展未安装、未重新加载到 0.5.2，或旧版动态脚本仍残留。打开 `edge://extensions` 重新加载；仍失败时移除旧版后重新加载扩展目录 |
| 下载后提示 `Access to the specified native messaging host is forbidden` | 扩展 ID 与桌面桥授权不一致。升级桌面端到 0.1.11、扩展到 0.5.2，重新加载扩展并重启桌面端；0.5.2 起开发模式 ID 由清单公钥固定 |
| 点击按钮提示「无法启动捕获：未登记 DOI」 | 该文献（尤其是公众号来源）没有 DOI。请先在对话中让 Agent 解析 DOI，或改用全文下载队列 |
| 点击按钮提示「已有一个进行中的捕获任务」 | 同一篇文献的同一类型已有未过期的布防；等待 20 分钟过期或取消后重试 |
| 上传后按钮仍灰色 | 上传失败，扩展 popup 会显示错误；常见：文件类型不匹配（PDF 任务只收 `.pdf`；SI 只收 pdf/zip/docx/xlsx/csv/txt/cif/sdf）、PDF 损坏（无 `%PDF-` 头或 `%%EOF`） |
| 下载完成后提示「file not found in any download directory」 | 下载目录不在默认位置。桥接会自动读取 Chrome/Edge 设置里的下载目录（含桌面等自定义目录）并逐目录查找；仍找不到时确认文件已下载完成、文件名未改，必要时把 Chrome 下载位置改回默认 Downloads 后重试 |
| popup 显示「无法连接本地桥接程序」 | 未运行 `install-bridge.py`，或扩展 id 与注册时不符；重新安装并刷新扩展 |
| 下载完成后没有上传 | 下载的不是**布防之后**的下一份**匹配类型**文件（例如布防了 SI 却下载了 PDF，或下载被浏览器拦截）；重新点击按钮布防 |
| 上传提示 403 | 上传来源不是扩展/本地桥接（例如直接用 curl 带自定义 Origin）；扩展页面刷新后重试 |
| 上传提示 409 | 同一令牌被重复使用（重放）；重新点击按钮创建新任务 |
| 上传提示 413 | 文件超过 100 MB 上限 |
| 出版社页面打不开 | 检查服务器网络；DOI 页面由浏览器直接打开，与服务器无关 |

## 测试

```bash
node --test "tests/unit/*.test.mjs" "tests/integration/*.test.mjs"
```

覆盖点：任务创建 / 微信仅 DOI / 无 DOI 拒绝 / 令牌只存哈希 / 非法令牌 404 /
重放 409 / 过期拒绝 / 100 MB 上限 / 非 PDF 拒绝 / PDF 头与 EOF 错误 /
SI 格式白名单 / 路径穿越清理 / 复用原 bundle / 下载接口读取 / Remote 调用 /
重启后状态保持 / 前端按钮状态与公众号链接静态断言。
