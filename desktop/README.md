# iBM Lab Agent Desktop

Windows desktop packaging for the iBM Lab Agent plugin on DeepSeek Harness (DSH) `0.1.1-rc.2`.

The desktop shell is deliberately small: it starts a bundled Node.js and DSH process on loopback, waits for an HTTP health response, and displays the local DSH interface inside its own window. It never opens the system browser.

## Build

On a Windows build machine with Rust stable, the Microsoft C++ build tools, Node 24, and Corepack:

```powershell
Set-Location <repository-root>
npm ci --omit=peer --legacy-peer-deps
Push-Location runtime\launcher
corepack pnpm install --frozen-lockfile --prod
Pop-Location
Set-Location desktop
npm ci
.\scripts\prepare-runtime.ps1 -SourceRoot .. -NodeExe (Get-Command node).Source
.\scripts\verify-package.ps1 -WebSmokeTest
npx tauri build
.\scripts\verify-package.ps1 -InstallerPath '.\src-tauri\target\release\bundle\nsis\iBM Lab Agent_0.1.8_x64-setup.exe'
```

`prepare-runtime` copies the pinned DSH payload, a Windows `node.exe`, the iBM Lab plugin, its complete production dependency tree, locked vendor data, lab preset, and Python lock into the ignored packaging-resources directory. pnpm's redundant internal store is excluded after the flattened runtime has been materialized. Pass `-RuntimeSourceRoot` only when reusing a separately prepared `runtime\launcher\node_modules` tree, and pass `-NodeExe` when the intended Node binary is not supplied by the build environment.

`verify-package -WebSmokeTest` boots the packaged `ibm-lab` profile on an ephemeral loopback port, requires an HTTP success response, rejects duplicate `labAgent`/plugin-tree errors, and terminates the test process tree. The NSIS installer uses Tauri's `downloadBootstrapper` WebView2 mode: Windows 10/11 normally already provide WebView2, while a missing runtime is downloaded by the installer.

### Note: build-script resource scan

`tauri-build` walks every file declared in `bundle.resources` and emits one
`rerun-if-changed` line per file. With the bundled DSH dependency tree
(hundreds of thousands of files under `resources\dsh\`) this makes the
build script appear frozen for 20+ minutes. Pass the config override below to
skip that walk during compilation; the Tauri bundler still packages the full
resources from `tauri.conf.json`, so the installer keeps Node/DSH/plugin:

```powershell
$env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
npx tauri build
Remove-Item Env:TAURI_CONFIG
```

If GitHub is unreachable from the build machine, the NSIS toolchain download
also stalls; a proxy or mirror must be available for
`github.com/tauri-apps/binary-releases` and `github.com/tauri-apps/nsis-tauri-utils`.

## Runtime location

Per-user operational data is kept below `%LOCALAPPDATA%\iBM-Lab-Agent`:

- `dsh\` — private DSH home and the `ibm-lab` profile
- `workspace\` — default work folder
- `config\app-config.json` — non-secret provider settings plus a DPAPI credential reference
- `config\api-key.dpapi` — API key encrypted for the current Windows user with DPAPI
- `logs\app.log`, `logs\dsh.log`, `logs\stderr.log`
- `runtime-state\dsh.pid` — recoverable child-process state

The API key is neither logged nor written to ordinary JSON. Windows DPAPI encrypts it for the current user; existing plaintext `apiKey` values are migrated on first read and removed from `app-config.json`.

## Distribution checks

See [docs/release-checklist.md](docs/release-checklist.md) for the clean-machine and regression checklist, and [docs/reference-desktop-analysis.md](docs/reference-desktop-analysis.md) for the separately reviewed reference architecture and licensing decision.
