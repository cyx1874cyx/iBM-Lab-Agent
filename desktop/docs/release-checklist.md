# Release checklist

1. Build from a clean, pinned source commit. Use `scripts/build-windows-release.ps1` as the release entrypoint.
2. Keep the generated `desktop/src-tauri/resources` snapshot untouched; source fixes belong in the repository root and are copied by `prepare-runtime`.
3. Require the release script's tests, regression, preset export check, lint, runtime preparation, Web smoke, NSIS build, exact installer verification and SHA256 report to pass.
4. On a clean Windows user profile, install the executable and start it twice. The second launch must focus the first window.
5. Confirm the startup window changes from its progress screen to DSH without opening a browser; confirm failure view offers retry and logs.
6. Inspect the effective profile: exactly one bare `dsh-lab-agent` bundle and one `labAgent` service must be present. No duplicate-service error is acceptable.
7. Verify `%LOCALAPPDATA%\iBM-Lab-Agent` contains user-owned DSH data and logs only; verify neither `app.log` nor `stderr.log` contains the configured API key.
8. Close the app and confirm the loopback port is released. Kill the process during a second test, relaunch, and confirm stale-state cleanup does not kill an unrelated process.
9. Exercise the core lab workflow in the DSH UI and run the source project's published regression suite after any integration change.

## Origin MCP release gates

All must pass before shipping a build with Origin MCP enabled:

- [ ] bundled Python can `import origin_mcp`
- [ ] origin-mcp version pinned at 0.1.4
- [ ] Desktop starts normally without Origin installed
- [ ] Desktop starts normally while the Bridge is not running
- [ ] Origin MCP `tools/list` works
- [ ] Origin Bridge status diagnostics work
- [ ] Origin E2E worksheet creation succeeds
- [ ] Origin E2E plotting succeeds
- [ ] PNG export succeeds
- [ ] OPJU save succeeds
- [ ] Origin MCP recovers after a Desktop restart
- [ ] Origin MCP recovers after a Bridge restart
- [ ] No stray `python.exe` processes left behind
- [ ] No stray `Origin.exe` processes left behind
- [ ] Chinese user paths pass
- [ ] Mnova MCP regression passes

## Release gates（以 docs/release-manifest.json 为准）

All must pass before shipping a desktop release build (see `docs/release-manifest.json`
for the pinned component versions):

### Version & components
- [ ] 根 package、desktop package、Cargo.toml、tauri.conf.json 与 release-manifest 的 iBM Lab Agent 版本完全一致
- [ ] origin-mcp = 0.1.4
- [ ] mnova-mcp = 0.3.1
- [ ] mcp SDK < 2 (1.29.0)

### Bundled Python self-containment
- [ ] bundled Python can `import origin_mcp`
- [ ] bundled Python can `import mnova_mcp`
- [ ] bundled `mnova_mcp/assets/bridge.qs` exists
- [ ] NMR Skill bundled and discovered (lab-mnova-skill-filesystem provider)
- [ ] no system Python required
- [ ] no `uv` required
- [ ] no Git required
- [ ] no mnova-mcp checkout required

### MCP connectivity
- [ ] Origin MCP handshake (initialize + tools/list)
- [ ] Mnova MCP handshake (initialize + tools/list)
- [ ] Origin tools (`origin_*`) listed
- [ ] Mnova tools (`mnova_status`, `mnova_process_1d`, `mnova_prepare_structure_1d`, `mnova_apply_assignments_1d`) listed
- [ ] NMR Skill discovery through Cordis

### Mnova on-machine E2E
- [ ] Mnova real FID E2E
- [ ] Mnova ChemDraw E2E
- [ ] Mnova assignment writeback E2E
- [ ] Mnova synthetic FID E2E
- [ ] Origin real E2E
- [ ] Origin + Mnova coexistence

### Environments
- [ ] Chinese user path
- [ ] workspace path with spaces

### Process lifecycle
- [ ] No orphan `python.exe`
- [ ] No orphan `node.exe`
- [ ] No orphan `Origin.exe`
- [ ] No orphan `MestReNova.exe`

### Regressions
- [ ] Edge PDF capture regression
- [ ] Nature Skills regression
- [ ] Office artifact regression

### Packaging
- [ ] 源码 Ketcher `index.html` 引用的全部哈希资源存在
- [ ] 工作树干净，构建报告 `publishable=true`
- [ ] 未发现并发 `prepare-runtime` / Tauri 构建
- [ ] 未使用清空 `bundle.resources` 的 TAURI_CONFIG 覆盖
- [ ] `verify-package -WebSmokeTest` passes
- [ ] NSIS installer build succeeds
- [ ] 安装包为本轮新生成且文件名版本精确匹配
- [ ] `release-report.json` 记录阶段耗时、安装包大小和 SHA256
- [ ] clean Windows 10 install
- [ ] clean Windows 11 install
- [ ] upgrade from 0.1.x
- [ ] uninstall/reinstall
