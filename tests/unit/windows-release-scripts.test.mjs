import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("Windows release entrypoint is observable, bounded and exact-versioned", async () => {
	const source = await read("desktop/scripts/build-windows-release.ps1");
	assert.match(source, /windows-release\.lock/);
	assert.match(source, /HEARTBEAT/);
	assert.match(source, /TimeoutMinutes/);
	assert.match(source, /process\.Kill\(\$true\)/);
	assert.match(source, /publishable\s*=\s*-not/);
	assert.match(source, /Name -eq "iBM Lab Agent_\$\{version\}_x64-setup\.exe"/);
	assert.doesNotMatch(source, /TAURI_CONFIG/);
});

test("prepare-runtime validates Ketcher before selective component refresh", async () => {
	const source = await read("desktop/scripts/prepare-runtime.ps1");
	assert.match(source, /prepare-runtime\.lock/);
	assert.match(source, /Get-PluginFingerprint/);
	assert.match(source, /nodeFingerprint/);
	assert.match(source, /dshFingerprint/);
	assert.match(source, /pluginFingerprint/);
	assert.match(source, /Test-KetcherAssetReferences/);
	assert.ok(source.indexOf("Source Ketcher index.html references missing assets") < source.indexOf("Staging refresh under temporary directory"), "Ketcher 校验必须先于任何 staged/正式快照动作");
	// rc.4 §9：git ls-files 稳定清单、流式哈希、临时目录原子切换与失败清理
	assert.match(source, /git ls-files/);
	assert.match(source, /CryptoStream/);
	assert.match(source, /IsNullOrWhiteSpace\(\$_\)/, "空 dependencies 对象不得递归出空依赖名");
	assert.match(source, /Staging refresh under temporary directory/);
	assert.match(source, /Moving staged/);
	assert.match(source, /Cleaning staged temporary directory/);
	assert.match(source, /\[System\.IO\.FileShare\]::None/, "独占句柄锁判断");
});

test("desktop documentation points Agents at the unified Windows release command", async () => {
	const readme = await read("desktop/README.md");
	assert.match(readme, /build-windows-release\.ps1/);
	assert.match(readme, /正式发布禁止设置 `TAURI_CONFIG/);
});

test("rc.4 review §6: release preflight fail-closes on git failures; dirty requires AllowDirty and stays non-publishable", async () => {
	const source = await read("desktop/scripts/build-windows-release.ps1");
	// 发布预检函数：git 存在/非 bare/HEAD 可解析/status RC/diff --check/fsck 全链失败关闭
	assert.match(source, /function Assert-GitReleaseReady/);
	assert.match(source, /status --porcelain failed \(exit /, "status 非零必须终止，不得把空 stdout 当干净");
	assert.match(source, /HEAD cannot be resolved to a commit/, "HEAD 坏对象 → 预检失败");
	assert.match(source, /cat-file -e 'HEAD\^\{commit\}'/, "HEAD 必须可读为 commit 对象");
	assert.match(source, /refusing to release from a broken repository/, "对象缺失 → 失败关闭");
	assert.match(source, /git diff --check reported/, "diff --check 非零 → 失败");
	assert.match(source, /fsck --connectivity-only reported/, "fsck 连通性失败 → 失败");
	assert.match(source, /empty output must NOT be treated as a clean tree/, "空 stdout 不得解释为干净");
	// dirty 语义：无 AllowDirty → throw；AllowDirty → 仅诊断且产物不可发布
	assert.match(source, /Working tree is dirty\. Commit\/stash the release inputs/);
	assert.match(source, /-AllowDirty only for a non-publishable diagnostic build/);
	assert.match(source, /DIAGNOSTIC-NOT-PUBLISHABLE\.txt/, "诊断构建在输出目录留下不可发布标记");
	assert.match(source, /publishable\s*=\s*-not \[bool\]\$AllowDirty/, "AllowDirty 构建 publishable=false");
});

test("rc.4 review §9: prepare-runtime swap is transactional — rollback, non-nested backup targets, late state write, retention", async () => {
	const source = await read("desktop/scripts/prepare-runtime.ps1");
	// 事务切换：记录已完成动作 + 相反顺序回滚
	assert.match(source, /transactional swap with rollback/, "切换声明为事务化");
	assert.match(source, /\$movedActions = \[System\.Collections\.Generic\.List\[object\]\]::new\(\)/, "记录每个已完成的移动动作");
	assert.match(source, /function Undo-StagedSwap/, "存在回滚函数");
	assert.match(source, /Rolled back component/, "回滚日志");
	// 备份父目录可预建，但组件最终备份目标 Move 前必须不存在（防嵌套）
	assert.match(source, /New-Item -ItemType Directory -Force -Path \$backupRoot/, "仅预建备份父目录");
	assert.match(source, /最终备份目标必须不存在/, "防 Windows 嵌套注释");
	assert.match(source, /if \(Test-Path -LiteralPath \$backupPath\) \{ Remove-TreeFast \$backupPath \}/, "移动前确保备份目标不存在");
	// 新目录移回 staged → 旧目录从备份恢复（顺序语义）
	assert.match(source, /1\) 已安装的新目录移回 staged/, "回滚第 1 步：新目录移回 staged");
	assert.match(source, /2\) 旧目录从备份恢复到原位置/, "回滚第 2 步：旧目录恢复");
	// state 只在全部组件切换并验证成功后更新
	assert.match(source, /Formal snapshot validation failed after swap; triggering rollback/, "切换后验证失败 → 回滚");
	assert.match(source, /Rolling back completed component swaps/, "失败时回滚已完成组件");
	assert.match(source, /备份保留策略：只保留最近 2 个 backup 快照/, "backup 保留策略");
	assert.match(source, /Sort-Object Name -Descending \|/, "按新旧排序保留最近备份");
	// state 写入在回滚保护与验证之后
	assert.ok(source.indexOf('Formal snapshot validation failed') < source.indexOf('$state = [ordered]@{'), "state 只能在全部切换验证成功后更新");
});

test("rc.4 review §7: real-browser Ketcher acceptance is wired into the unified release script", async () => {
	const source = await read("desktop/scripts/build-windows-release.ps1");
	assert.match(source, /browser-ketcher/, "发布脚本含浏览器验收阶段");
	assert.match(source, /--test', 'tests\/browser/, "浏览器测试以 node --test 目录方式执行");
	assert.match(source, /真实浏览器 \+ 离线 Ketcher 验收必须进入统一发布脚本/, "§7.2 语义注释");
	assert.match(source, /失败阻止 Tauri 打包/, "浏览器失败阻止打包");
	assert.match(source, /TimeoutMinutes 15/, "浏览器阶段超时设置");
	const pkg = await read("package.json");
	assert.match(pkg, /"test:browser": "node --test \\"tests\/browser\/\*\.test\.mjs\\""/, "根 scripts 提供 test:browser");
});
