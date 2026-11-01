# Seneschal v0.2.1 beta 20 — November 1, 2026

Beta 20 packages the work since the October 12 public update: private Phone Access, approval and question recovery, native Activity history, optional NVIDIA speech, the new Seneschal companion, local wallpaper worlds, English/Persian controls, contextual help and responsive layout improvements. It also softens the background behind the workspace and includes the current interface screenshot.

Start with the [user guide](USER-GUIDE.md), [private phone setup](PRIVATE-ACCESS-SETUP.md), [permission migration](PERMISSION-OVERRIDES.md) and [Activity startup](ACTIVITY-STARTUP.md). The [changelog](../CHANGELOG.md) retains the earlier release history.

Download `seneschal-v0.2.1-beta.20.zip` from this release, extract it, and run `install.cmd` on a supported Windows PC. The ZIP contains the existing script-based installer, source, local assets, guides and tests. It requires WSL, Node.js and an existing OpenCode installation; it is not a standalone desktop executable or a signed native installer. Node 22.16+ is recommended for the complete feature set, including SQLite backups. Optional voice and integrations require their own supported access and setup.

Older packaged installations can use **Settings → App updates** when the release is available. The update download must match GitHub's SHA-256 digest. Source checkouts update through Git. `SHA256SUMS.txt` accompanies the ZIP for independent verification.

The full source suite passed 288 tests; the separate Phone Access verifier passed 207 synthetic checks. These do not replace actual Windows/WSL, microphone and phone testing on a new installation. Phone Access requires fresh qualification on the installed copy. See [validation scope](VALIDATION.md).

Local credentials, histories, backups, browser profiles, development notes and model runtimes are excluded. Optional integrations still need their own setup and supported provider access. Finish active tasks before restarting an older host to load backend changes, then reload the browser pages.

## Historical beta 15 notes

Agent Board work is now clearly separated from ordinary conversations. Board Architect and worker sessions no longer clutter the Sessions, pinned Sessions, archive manager, project counts, or command search. They remain retained inside their board cards, where their work can still be reopened and inspected.

The left sidebar now has its own **Board history** entry and saved-board count. Selecting **Open board** loads the exact stored team, roles, models, access profiles, tasks, dependencies, state, and linked sessions. It does not resend the plan and does not ask the Board Architect to redesign the workflow.

The background-animation control remains in the sidebar and Workspace settings. It is intentionally kept out of the top navigation so primary project, session, model, and panel controls remain easier to scan.

This update makes the Agent Board plan-driven. Use **To board** on one assistant plan response and a Board Architect reads only that chosen message, then proposes the objective, team size, roles, tasks, models, access profiles, dependencies, and parallel-work limit. Up to eight independent agents can work at once.

Board agents now exchange explicit visible requests when another specialist needs to clarify or redo work. The requested agent receives the correction, runs another pass, and the requester checks it again. The Supervisor owns final acceptance and can return inadequate work; bounded iterations prevent endless loops. Every board is saved locally and can be restored from the new History view without deleting linked OpenCode sessions or project files.

Visible Playwright mode now repairs stale configured launchers during Seneschal startup and repeatedly brings the real agent-controlled Brave window to the foreground when it appears. This addresses installations where the UI flag and the launcher used by OpenCode lived in different folders.

Navigation is calmer: the whole-panel controls now live inside their left and right bars, the welcome-animation control moved out of the top bar, and each right-side context section can be minimized independently. Sidebar sections start minimized and remember what the user reopens.

This update brings Seneschal into Visual Studio Code as a real working panel. The Seneschal Activity Bar view lists the current project's sessions and every model connected through Seneschal/OpenCode. A model can be chosen per session, independently of GitHub Copilot and independently of other Seneschal sessions.

Plan mode analyzes without file-changing tools. Build mode can inspect and edit the shared project subject to Seneschal's approval policy. The current selection or entire open file can be attached explicitly, responses and tool activity stay visible in the panel, running work can be stopped, edits can be reviewed in Source Control, and the full retained conversation can be opened in Seneschal.

The companion is installed locally from Seneschal. After installation, it remains available when VS Code is opened directly. Seneschal refreshes the private local connection on every start; Seneschal itself must still be running while the panel is used.

An existing planning session can now be imported into the Agent Board as the retained project brief. The starter team builds around it without copying or deleting the original conversation. Every worker has its own model, role, system-access profile, task, and dependency list. Individual cards show provider-supplied summaries and tool activity, keep their full linked sessions, and can be stopped, edited, retried, or opened. The Supervisor is a configurable agent and can use any connected model.

The previous Agent Board, visible-browser, session-isolation, pin/archive/delete, and local bridge improvements are retained.

The release retains per-session model isolation, background session continuity, confirmed deletion controls, pinned-session and pinned-message shelves, reversible archives, Settings-based restoration, Plan/Build/Chat roles, approval controls, instruction and skill editing, voice input, JSON attachment normalization, and optional Blender integration.

Before installing, read the requirements and known limits in the README. Provider accounts, OpenCode, Playwright dependencies, and Blender integrations are not bundled. Existing OpenCode configuration is preserved.
