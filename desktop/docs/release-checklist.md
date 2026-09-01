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
