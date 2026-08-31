# Reference desktop analysis

Reviewed source: `github.com/myYangyunfan/dsh_desktop`, cloned for review at commit `fa1226e`.

Its license is MIT (Copyright 2026 DSH Desktop contributors). The reference implements a broad Tauri 2 desktop distribution: a bundled Node/DSH payload, single-instance behavior, dynamic port selection, health checks, process-tree cleanup, NSIS packaging, logging, updates, WSL integration, plugin management, and extension workflows.

This project reimplements only the generally useful architecture patterns—single-instance activation, loopback port selection, health checking, explicit child ownership, stale-PID verification, and NSIS resources. It does not copy the reference application's UI, Rust sources, update flow, WSL integration, plugin marketplace, or branding. That preserves a small reviewable surface and avoids importing a second product's unrelated behavior.

The bundled iBM Lab Agent and DeepSeek Harness components are also MIT-licensed. Their licenses and notices remain inside their package payloads; release engineering must retain those notices when generating a distributable installer.
