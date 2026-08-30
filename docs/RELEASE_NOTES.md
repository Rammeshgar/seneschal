# Seneschal v0.2.1 beta 10

This update isolates model selection by session. Choosing a model in one conversation no longer changes the model shown or used by every other conversation.

Switching away from a busy session does not abort it. Seneschal keeps its status active in the sidebar and now states clearly that the work continues in the background. Model choices made through the command palette are also labelled as current-session changes.

The release retains confirmed deletion controls, visible agent-controlled Brave mode, pinned-session and pinned-message shelves, reversible archives, Settings-based session restoration, Plan/Build/Chat roles, approval controls, instruction and skill editing, voice input, JSON attachment normalization, and optional Blender integration.

Before installing, read the requirements and known limits in the README. Provider accounts, OpenCode, Playwright dependencies, and Blender integrations are not bundled. Existing OpenCode configuration is preserved.
