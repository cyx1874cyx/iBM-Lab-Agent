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
.\scripts\verify-package.ps1 -InstallerPath '.\src-tauri\target\release\bundle\nsis\iBM Lab Agent_0.1.0_x64-setup.exe'
```

`prepare-runtime` copies the pinned DSH payload, a Windows `node.exe`, the iBM Lab plugin, its complete production dependency tree, locked vendor data, lab preset, and Python lock into the ignored packaging-resources directory. pnpm's redundant internal store is excluded after the flattened runtime has been materialized. Pass `-RuntimeSourceRoot` only when reusing a separately prepared `runtime\launcher\node_modules` tree, and pass `-NodeExe` when the intended Node binary is not supplied by the build environment.

`verify-package -WebSmokeTest` boots the packaged `ibm-lab` profile on an ephemeral loopback port, requires an HTTP success response, rejects duplicate `labAgent`/plugin-tree errors, and terminates the test process tree. The NSIS installer uses Tauri's `downloadBootstrapper` WebView2 mode: Windows 10/11 normally already provide WebView2, while a missing runtime is downloaded by the installer.

## Runtime location

Per-user operational data is kept below `%LOCALAPPDATA%\iBM-Lab-Agent`:

- `dsh\` — private DSH home and the `ibm-lab` profile
- `workspace\` — default work folder
- `config\app-config.json` — optional local OpenAI-compatible provider settings
- `logs\app.log`, `logs\dsh.log`, `logs\stderr.log`
- `runtime-state\dsh.pid` — recoverable child-process state

The API key is neither logged nor placed in the packaged application. It is stored only in the current user's local configuration file; future builds can substitute Windows Credential Manager without changing the UI contract.

## Distribution checks

See [docs/release-checklist.md](docs/release-checklist.md) for the clean-machine and regression checklist, and [docs/reference-desktop-analysis.md](docs/reference-desktop-analysis.md) for the separately reviewed reference architecture and licensing decision.
