# Runtime architecture

```
iBM Lab Agent.exe (Tauri, single instance)
  └─ bundled node.exe
       └─ DSH 0.1.1-rc.2, profile `ibm-lab`, 127.0.0.1:3080–3111
            └─ exactly one dsh-lab-agent package mounted from the profile
```

The Tauri shell allocates an available loopback port, starts Node with explicit `--host 127.0.0.1 --port`, and waits up to 90 seconds for a local HTTP response. The WebView remains on the packaged application page while an iframe presents the ready local DSH UI; that leaves error handling, log access, retry, and settings reachable rather than replacing the window with an opaque remote navigation.

Each user receives an isolated DSH home. At first start, the runtime copies a frozen `dsh-lab-agent` bundle into `profiles/ibm-lab/node_modules/dsh-lab-agent`, then writes a profile manifest whose bundle list contains `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and a single `dsh-lab-agent` entry. No main plugin row is put in `cordis.patch.yml`, preventing the historic duplicate `labAgent` service collision.

Shutdown terminates the child process tree. For a stale PID file from an abnormal exit, the shell queries the command line and only terminates it when both the bundled DSH entrypoint and this application's DSH home appear; a reused PID is discarded rather than killed.
