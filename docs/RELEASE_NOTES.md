# Seneschal v0.2.1 beta 16

Beta 16 focuses on reliability at the boundaries between sessions, projects, models, and multi-agent work.

Session renaming now opens consistently. **Move session** is an organizational operation: it places the conversation under another Seneschal project while preserving history, pins, archives, and the selected model. The engine's original tool working folder remains unchanged and is shown clearly. Assignments are stored in Seneschal's local data rather than fragile engine metadata, and existing named projects, WSL paths, and Windows paths are accepted.

Sending one selected plan response to Agent Board now saves that exact text and immediately creates a practical default implementation, checking, and supervisor team. The chosen plan can be expanded and reviewed inside the board. If Board Architect customization fails, the saved default board remains usable instead of disappearing.

Board scheduling now distinguishes a finished response from old or partial output, respects the configured parallel-worker limit when scheduling calls overlap, and stops workers even during session creation. Independent workers can still run concurrently, and the Supervisor receives every required handoff before final acceptance.

The interface uses larger conversation text, stronger secondary contrast, more distinct colors across navigation and board states, and responsive composer controls that wrap when browser zoom reduces the available width. On narrow windows the inspector becomes a drawer rather than squeezing the conversation.

The model catalog includes GPT-6 Astra when the connected OpenAI provider exposes it. A locally downloaded quantized Ternary Bonsai 27B model can run through Seneschal's PrismML-compatible local runtime; local model availability still depends on the configured weights and runtime starting successfully.

Windows launcher reporting is more accurate: PowerShell 5.1 no longer treats ordinary native stderr warnings as automatic launch failure, and a server that starts and later exits is reported as having stopped unexpectedly. An already-running older Seneschal server must be restarted before updated backend behavior takes effect.

The release includes behavior tests for durable project assignments, exact selected-plan handoffs, current-run completion detection, and parallel scheduling, alongside the existing security, installer, browser, VS Code, and UI checks.

---

## Previous beta 15 highlights

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
