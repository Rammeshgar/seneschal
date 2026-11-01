# Source update validation — November 1, 2026

The publication checkout passed the complete `npm test` suite: **288 tests, 288 passed, zero failed or skipped**, using the already-installed `node:22-bookworm-slim` image.

The container had no external network, ran as an unprivileged user with capabilities dropped, and mounted the checkout read-only. The suite ran from a disposable copy in a size-limited temporary filesystem with explicit CPU, memory, process and wall-clock limits. No real OpenCode data, provider credentials or live Seneschal host was supplied to it.

The separate `scripts/verify-private-access.ps1` check passed **207 synthetic tests** on the final qualified source files. A fresh installation must produce its own proof. Source-hash proofs and their backups are local runtime data; they are not shipped in this repository.

The source refresh also corrects stale test fixtures: a mocked Activity runtime now supplies Windows drive-path semantics on POSIX, the project-assignment fixture stubs the new speech handler, and smoke checks follow the current model registration and startup sequence. They do not relax the production Windows-path or permission boundaries.

Before publication, prospective Git files were checked for common credential formats and the original machine's private paths. Runtime data, model/browser runtimes, caches, backup folders, local development journals and a desktop-cleanup helper were excluded. The token-shaped speech test value is explicitly synthetic. The bundled interface illustration contains fixture content rather than personal conversations.

These checks cover source behavior and synthetic boundaries. They do not constitute a new end-to-end run on a physical phone, a live Windows/WSL engine, provider billing/quota, real speech hardware, or a signed installer. The existing runtime still requires the supported local setup and optional integrations described in the user guide.
