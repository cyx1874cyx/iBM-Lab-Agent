# Vendored PDF.js 5.4.624

Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz
Upstream: https://github.com/mozilla/pdf.js

Unmodified `legacy/build/pdf.mjs`, `legacy/build/pdf.worker.mjs`, `cmaps/`,
`standard_fonts/`, `legacy/web/pdf_viewer.mjs`, `web/pdf_viewer.css`, and
`web/images/` from the pinned npm distribution. Registry integrity metadata
is retained in `upstream.json`; the Apache-2.0 license is in `LICENSE` and font
license files remain alongside the font resources.

The client bundles the display module lazily and loads the worker through a
local Blob module worker. No runtime CDN or public translation service is used.

The reading panes use the official `PDFViewer`/`EventBus` components, following
https://github.com/mozilla/pdf.js/blob/v5.4.624/examples/components/simpleviewer.mjs.
`web/upstream-sha256.json` records each viewer asset from the integrity-verified
distribution. The build scopes upstream styles to `.ib-reader` and embeds icons;
the source assets remain unmodified.
