# Seneschal v0.2.1 beta 12

This update fixes the visible browser at its real failure point. Earlier installations could retain a Playwright launcher that always added hidden mode. Seneschal now detects and safely backs up that legacy launcher, replaces it with the visibility-aware version, and reconnects only Playwright. Direct browser requests, URLs, and the common `playwrite` misspelling also enable the visible agent-controlled Brave window before the task starts.

An existing planning session can now be imported into the Agent Board as the retained project brief. The starter team builds around it without copying or deleting the original conversation. Every worker has its own model, role, system-access profile, task, and dependency list. Individual cards show provider-supplied summaries and tool activity, keep their full linked sessions, and can be stopped, edited, retried, or opened. The Supervisor is a configurable agent and can use any connected model.

Visual Studio Code now has an optional local companion. After installing it from Seneschal and reloading VS Code once, the Seneschal status-bar button can open the current project, choose one of that project's existing sessions, or create a new project session. The companion links projects and sessions; it does not pretend to be an inline Copilot replacement.

The release retains per-session model isolation, background session continuity, confirmed deletion controls, pinned-session and pinned-message shelves, reversible archives, Settings-based restoration, Plan/Build/Chat roles, approval controls, instruction and skill editing, voice input, JSON attachment normalization, and optional Blender integration.

Before installing, read the requirements and known limits in the README. Provider accounts, OpenCode, Playwright dependencies, and Blender integrations are not bundled. Existing OpenCode configuration is preserved.
