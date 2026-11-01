# Native Activity workspace

Seneschal owns the interface; Agent Trail 0.1.7 remains the local parser, history store, and usage engine. No iframe or fork of Agent Trail's Next.js interface is needed for the native views.

## Views and entry points

- Sidebar Activity and Settings → Agent activity open Overview.
- Live activity's Inspect history and Agent Board's Activity shortcut map an OpenCode session ID to its canonical indexed session.
- Overview: period totals, daily token trend, recent sessions, window-scoped live progress, pause, and JSON export.
- Sessions: metadata search, recorded-status filter, conversation-text search (up to 50 matches), project drill-down from Usage, pagination, and worker sessions.
- Replay: safe Markdown, independently expandable tool arguments/results, partial-record notices, parent/child navigation, incremental turn loading, and Open chat. Historical inspection never runs tools or replays actions.
- Usage: explicit token categories, unknown versus measured-zero values, pricing coverage, and model/project rankings. Rankings attribute entire sessions started within a period to their latest recorded model; the trend and total consumption use recorded daily usage. Dates follow the Windows host's local time zone, passed to WSL.
- Service: status/readiness, last indexing time, paths, pinned package version, owned start/restart/stop, recoverable rebuild, and original-dashboard fallback.

## Runtime and data boundaries

The authenticated Seneschal proxy exposes only fixed `/workspace/activity/*` routes. Browser input cannot select another host, source, package version, shell command, or index path. Requests force `source=opencode`; a direct replay request validates the session's source before fetching its messages/turns. IDs and pagination are validated, pages are capped at 100, and search input is capped at 240 characters.

The WSL supervisor starts only the tested package, with an installation hash and process-specific ownership nonce. It refuses an already-active index and never kills unknown listeners. Both ingest (8078) and fallback dashboard (3030) are loopback-only. The package's internal `/health` version is 0.1.1 even in package 0.1.7; Seneschal reports the package version verified by its supervisor, not that internal constant.

The source is `<WSL home>/.local/share/opencode/opencode.db`. The derived index is `<WSL home>/.local/share/seneschal-agent-trail/indexes/<installation hash>/ingest.db`. Existing `~/.agent-trail/ingest.db` is not migrated or modified. Rebuild stops the owned service, moves only this index's SQLite files into a timestamped backup, and reimports the original source. Live captures remain in browser memory and disappear on reload; exports should be reviewed before sharing.

Status distinguishes preparation, startup, indexing, ready, degraded, failed, stopping, and stopped. A completed limited startup pass is not represented as full coverage while the background scheduler is active or queued. Parser/sync failures remain visible as incomplete history. Refresh is explicit, also reconciled after idle events and at most once every 30 seconds while Activity is open. Automatic refresh does not replace focused or expanded historical content.

## API compatibility

The adapter targets the API shipped with `@camtrik/agent-trail@0.1.7`: health, OpenCode sources/sync, sessions, source-key lookup, conversation search, session detail/turns/messages, aggregates, daily tokens, top models, and top projects. Optional summary failures produce partial-feature notices. Missing required endpoints and malformed responses fail visibly rather than inventing values.

## Verification

Run `npm test` for the adapter, source boundaries, ID mapping, partial summaries, measured-zero preservation, scheduler status, concurrent start/sync, port conflicts, lifecycle controls, rebuild backups, and existing regression tests. On restricted Windows environments, set TEMP and TMP to an approved writable test directory before running tests.

Run `node tests/ui-fixture-server.js` and open `http://127.0.0.1:4206` for privacy-safe visual checks. All fixture records are synthetic. Check both themes, 1440×900, 390×844, and 320×700; search, replay, tool disclosure, service stop/start, keyboard tabs/Escape/focus return, and the separate app/engine update dialog.

Live acceptance additionally requires the installed app and functioning WSL: open Activity, allow initial indexing, verify a real chat and worker's source ID, compare totals with the original local dashboard using the same date/source scope, finish a fresh turn and refresh, restart the owned runtime, and rebuild/reimport after confirming a backup. Do not claim these live checks from synthetic fixtures. This implementation session could read the installed package but WSL execution returned access denied, so real-history/runtime acceptance remains to be performed on the user's normal launch.
