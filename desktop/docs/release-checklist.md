# Release checklist

1. Build from the pinned `iBM-Lab-Agent-release` source and run its unit, integration, and regression suites first.
2. Run `build-bundled-python.ps1`, then `npm run prepare-runtime` and `npm run verify-package` before the Tauri build.
3. Build the NSIS installer and re-run `verify-package` with its `-InstallerPath` argument.
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
- [ ] iBM Lab Agent version = docs/release-manifest.json 的 ibmLabAgent（当前 0.3.0），4 处版本文件一致
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
- [ ] `verify-package -WebSmokeTest` passes
- [ ] NSIS installer build succeeds
- [ ] clean Windows 10 install
- [ ] clean Windows 11 install
- [ ] upgrade from 0.1.x
- [ ] uninstall/reinstall
