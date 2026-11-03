# DSH-RAG retrieval core

Vendored from the user's `cyx1874cyx/DSH-RAG`, version 0.2.1, commit
`a5378cec80d32624491a65f7be83a77686272ade`. MIT license in LICENSE.
Only the retrieval core and shared types are used. Host UI, credentials and cloud
providers are not installed; iBM Lab supplies its own project adapter and tools.

Pinned parser dependencies are included for reproducible offline deployment:
PDF.js 6.2.108 (Apache-2.0), fflate 0.8.3 (MIT). Their licenses accompany the files.
Run `node scripts/build-rag.mjs` to generate `lib/rag/`. No library documents,
credentials or machine-specific paths are included in this snapshot.

Local adaptation: PDF parsing lazily imports a text-only runtime. DOMMatrix is
the unmodified pure-JS geometry implementation shipped in @napi-rs/canvas 1.0.7
(MIT, dependencies/geometry/LICENSE). No native canvas binary is required for
text extraction. PDF rendering remains the desktop viewer's responsibility.
