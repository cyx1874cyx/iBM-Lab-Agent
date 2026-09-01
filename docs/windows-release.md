# Windows desktop release

The tagged Windows workflow is the release gate for the desktop installer. It runs JavaScript and Rust tests, prepares the bundled runtime, exercises the local DSH Web smoke test, builds the NSIS installer, requires Authenticode signing, verifies the signature, and uploads both the installer and the Edge Add-ons submission ZIP.

## Required release configuration

- GitHub Actions secret `WINDOWS_CERTIFICATE_BASE64`: Base64-encoded code-signing PFX.
- GitHub Actions secret `WINDOWS_CERTIFICATE_PASSWORD`: PFX password.
- GitHub Actions variable `IBM_LAB_EXTENSION_ID`: the fixed 32-character Edge Add-ons catalog ID after Microsoft approves the first submission.

Tagged releases fail when the signing certificate is absent. Manual workflow runs may remain unsigned for diagnostics.

## Edge Add-ons first publication

Run `browser-extension/ibm-literature-capture/package-store.ps1` and submit the resulting ZIP in Microsoft Partner Center. The store review and catalog ID are external release operations and cannot be produced by the source build itself. After Microsoft assigns the catalog ID, set `IBM_LAB_EXTENSION_ID`, rebuild the installer, and verify that Runtime Doctor reports matching `allowed_origins` for `com.ibm.lab.capture`.

## Version compatibility

| Desktop | Extension | Native host | Notes |
|---|---|---|---|
| 0.1.8 | 0.5.0 | `com.ibm.lab.capture` | Loopback-only download capture bridge; native save router; DPAPI; Job Object |

## Clean-machine checklist

Use a Windows 10/11 VM without Node, Python, or LibreOffice. Install the signed NSIS package; confirm DSH startup, Runtime Doctor states, Edge handoff, Native Messaging registration, DOCX/PPTX native save/open/reveal, DPAPI-backed settings, runtime shutdown with no residual Node process, and uninstall cleanup. Missing optional Python/LibreOffice components must be reported without preventing core startup.
