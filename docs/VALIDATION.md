# Beta 20 validation — November 1, 2026

The beta 20 source and the extracted release ZIP passed the complete `npm test` suite: **288 tests, 288 passed, zero failed or skipped**, using the already-installed `node:22-bookworm-slim` image.

The container had no external network, ran as an unprivileged user with capabilities dropped, and mounted the checkout read-only. The suite ran from a disposable copy in a size-limited temporary filesystem with explicit CPU, memory, process and wall-clock limits. No real OpenCode data, provider credentials or live Seneschal host was supplied to it.

The separate `scripts/verify-private-access.ps1` check passed **207 synthetic tests** on the final qualified source files in the extracted package. A fresh installation must produce its own proof. Source-hash proofs and their backups are local runtime data; they are not shipped in the ZIP or repository.

The source refresh also corrects stale test fixtures: a mocked Activity runtime now supplies Windows drive-path semantics on POSIX, the project-assignment fixture stubs the new speech handler, and smoke checks follow the current model registration and startup sequence. They do not relax the production Windows-path or permission boundaries.

Before publication, prospective Git files were checked for common credential formats and the original machine's private paths. Runtime data, model/browser runtimes, caches, backup folders, local development journals and a desktop-cleanup helper were excluded. The token-shaped speech test value is explicitly synthetic. The bundled interface illustration contains fixture content rather than personal conversations.

The ZIP was checked for one installable root, matching package/version metadata, the current screenshot, required runtime assets, safe archive paths and absence of runtime data or credentials. Its extracted files were compared with the committed source, and the updater's beta-19-to-beta-20 selection was exercised with synthetic metadata. PowerShell installer syntax was parsed without running it against the real PC. The published ZIP's GitHub digest and a downloaded copy must match the local checksum.

These checks cover source behavior, packaging and synthetic boundaries. They do not constitute a new end-to-end installation on a physical Windows/WSL PC, actual phone or microphone testing, provider billing/quota testing, or a signed installer. The runtime still requires the supported local setup and optional integrations described in the user guide.
