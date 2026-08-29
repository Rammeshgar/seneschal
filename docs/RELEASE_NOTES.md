# Seneschal v0.2.1 beta 9

This update adds deliberate deletion controls across the workspace without risking project files.

Sessions—including pinned and archived sessions—now have a permanent Delete action backed by OpenCode's session deletion endpoint. Messages have a confirmed local Delete action that removes them from Seneschal on the current device; OpenCode does not expose safe single-message deletion, so the confirmation states clearly that its source transcript is unchanged. Projects can be removed from Seneschal's sidebar without deleting their folder, files, or OpenCode sessions, and adding the same project again restores it.

Browser tasks started from Seneschal now enable the visible agent-controlled Brave window before sending the task. If an older background backend is still active, Seneschal blocks the task and tells the user to restart once instead of silently running the browser headlessly.

The release retains pinned-session and pinned-message shelves, reversible archives, Settings-based session restoration, Plan/Build/Chat roles, approval controls, instruction and skill editing, voice input, JSON attachment normalization, and optional Blender integration.

Before installing, read the requirements and known limits in the README. Provider accounts, OpenCode, Playwright dependencies, and Blender integrations are not bundled. Existing OpenCode configuration is preserved.
