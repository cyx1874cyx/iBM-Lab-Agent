# Vendored PDF.js 5.4.624

Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz
Upstream: https://github.com/mozilla/pdf.js

Unmodified `legacy/build/pdf.mjs`, `legacy/build/pdf.worker.mjs`, `cmaps/`, and
`standard_fonts/` from the pinned npm distribution. Registry integrity metadata
is retained in `upstream.json`; the Apache-2.0 license is in `LICENSE` and font
license files remain alongside the font resources.

The client bundles the display module lazily and loads the worker through a
local Blob module worker. No runtime CDN or public translation service is used.
