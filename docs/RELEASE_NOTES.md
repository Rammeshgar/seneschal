# Seneschal v0.2.1 beta 15

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
