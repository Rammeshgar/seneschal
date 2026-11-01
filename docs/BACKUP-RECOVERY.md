# Private backups and isolated recovery

Settings → Back up now runs only from the PC. The inline status remains available after closing/reopening Settings. Check backup status is read-only. Rapid clicks share one operation, and a lost response is never automatically re-posted. Weekly means one attempt at host launch when the last **verified success** is at least seven days old; it is not an independent Windows scheduler. A failed attempt does not reset that interval.

## Contents and limits

- A consistent snapshot of `~/.local/share/opencode/opencode.db`, created inside WSL using Node's SQLite online-backup API. Committed WAL records are included; no raw live-database copy is used. The standalone copy is normalized out of WAL mode and checked with `PRAGMA quick_check`.
- Seneschal's instruction Markdown, project/session assignments, current/saved agent boards, Activity startup preference, and only these host settings: `wslDistribution`, `wslLinuxHome`, `launchDirectory`, `blenderExecutable`.
- OpenCode's top-level `AGENTS.md` and `GENERAL.md`, plus model/small-model/default-agent names from ordinary JSON configuration. Raw provider/MCP config, inline provider keys, auth stores, host passwords, workspace/Prism keys, pairing codes/cookies/session stores and qualification proofs are **not copied**. JSONC configuration's model choices are omitted rather than copying raw text.
- Not included: project files, attached files outside the database, browser local-storage preferences (pins/archives/theme), custom engine agent/skill directories, installed programs/models, browser profiles, or a full WSL image. Reinstall/reconnect providers and review configuration separately during real recovery. This is not a complete machine backup.

Conversation, board and instruction text is **unredacted** and may contain secrets pasted by the user. The manifest's `credentialStoresIncluded: false` describes excluded credential stores, not a guarantee that private text contains no secrets. Backups are **not encrypted or shareable exports**. Windows folders are protected for the current owner and SYSTEM before content is written (administrators can still exercise OS privileges). Linux test fixtures use mode 0700. Keep another protected/encrypted copy on a separate device; a same-disk backup does not protect against disk loss or ransomware.

Requires the installed WSL Node runtime to support `node:sqlite` and `backup` (Node 22.16+). No downloads or installs occur. The operation fails closed if prerequisites, access protection, data validation or verification fail. History is bounded to 1 GiB, total payload to 1 GiB + 64 MiB, and file count to 512. Instruction/board-history folders permit at most 200 files each. No automatic retention deletion is performed; monitor disk use.

Windows path conversion and worker launch use `wsl.exe --exec`, not the default Linux shell. Without direct execution, the default shell consumes backslashes in a Windows path before `wslpath` sees it. This caused the first owner-run attempt to stop with an empty protected staging folder, before any history copy. Status checks now visibly show Checking and a last-checked time, and ignore stale responses. Synthetic checks cover direct argument passing and status feedback; actual path conversion was also checked read-only on Windows, including a path with spaces.

The next owner-run restart exposed a Windows PowerShell module-autoload failure before a new staging folder was made. Folder protection now uses framework ACL APIs rather than `Set-Acl`/`Get-Acl`, without changing the owner/SYSTEM-only policy. A further Windows fixture exposed path metadata reporting volume ID zero while the open handle reported the actual volume. This is accepted only on Windows after confirming file identity through a second independent handle and rechecking the path; type, link count, inode, size and known-device mismatches still fail closed. Failure messages expose bounded step names, not raw exception contents.

A later owner attempt completed its history snapshot but failed while parsing UTF-8 BOM-prefixed host settings. JSON reads now strictly decode UTF-8 (with or without its BOM), or BOM-declared UTF-16 LE/BE. Only backup copies are normalized to UTF-8 JSON; original settings/board files are never rewritten. Invalid encodings/JSON still fail closed, without returning private parser excerpts. The manager validates and captures bounded host settings, instructions and saved boards **before** creating staging folders or copying history. `preflight()` is a local, read-only metadata check; it returns only a validity flag and counts, not private values, and has no phone or HTTP route. Metadata failures have a named status rather than an unconfirmed step. The owner's actual metadata passed this read-only check after the encoding correction; that does not certify a completed history backup.

## Publication and recovery

The worker stages into `data/backups/.backup-<timestamp>-<random>.incomplete`. File sizes/SHA-256 hashes and database integrity are checked before the folder is renamed to `data/backups/backup-<timestamp>-<random>` and success is recorded in `data/backup-status.json`. Hashes detect accidental modification; the manifest is not a signature against someone who can replace the backup and manifest. Old broken backup markers are ignored. Failures retain partial files, report no confirmed success, and never replace history or sign-in files.

The PC-only utility supports:

```powershell
& ".\scripts\backup-opencode.ps1" -Operation status
& ".\scripts\backup-opencode.ps1" -Operation verify -BackupID "<ID shown in Settings>"
& ".\scripts\backup-opencode.ps1" -Operation restore-isolated -BackupID "<ID shown in Settings>"
```

`restore-isolated` accepts only a validated backup ID, verifies exact allowlisted contents/hashes/database integrity, creates a **new** protected folder under `data/backup-recovery`, copies exclusively, and verifies again. There is no destination override, live restore endpoint, execution, import, service startup or overwrite. Only an isolated drill is implemented; a real replacement of production history requires a separately reviewed, stopped-engine procedure. Do not point the live app at a drill folder.

Backup locks are exclusive across processes. A leftover lock is never silently adopted/deleted. If interrupted, finish/inspect the owning operation before moving the exact stale `.backup-lock` aside manually; do not delete other folders or resume work by restoring an old qualification proof. No phone route can create, list, download or restore backups.

## Validation scope

`tests/backups.test.js` creates dummy secrets and a real SQLite WAL database inside the network-disabled, read-only-source verification container. It checks committed/uncommitted records, isolated recovery, exclusions, failed protection/snapshots, duplicate requests, corrupt/traversal/extra/linked payloads, scheduling and route boundaries. It never mounts real history or credentials. These checks do not certify the owner's actual WSL runtime, Windows ACL application, live backup or full disaster recovery. Finish running tasks, restart Seneschal to activate the server change, and inspect Settings → Check backup status for the first real result.

Additionally, `node tests/backup-windows-smoke.cjs` is a manual Windows/WSL fixture using only a newly created `.test-temp` root with spaces/apostrophes and a dummy SQLite database. It deliberately makes PowerShell's Security module unavailable, reapplies owner/SYSTEM-only protection, uses the actual WSL process bridge, validates BOM-prefixed settings without modifying the original, creates/verifies a dummy backup, and restores/verifies it in a new isolated folder. Only the virtual fixture home is redirected by the harness; it never opens the owner's real engine database, auth stores or launcher token. This native Windows/WSL fixture passed after the platform and encoding corrections. It does not establish a successful backup of real history; that still needs the owner's first successful run.
