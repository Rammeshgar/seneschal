# Seneschal v0.2.1 beta 8

Seneschal is the renamed public beta of the custom OpenCode workspace for Windows and WSL.

It includes Plan, Build, and Chat roles; approval controls; model and thinking selectors; instruction and skill editing; attachments; voice input; session navigation; and optional browser and Blender status surfaces.

This update adds persistent session pinning, reversible local session archiving, per-conversation message pinning, reversible local message archiving, and independent compact controls for the Projects, Sessions, and pinned-message lists. It also adds a visible-window switch for Seneschal's actual Playwright Brave bridge, so browser automation can be watched when needed. Changing visibility restarts only that bridge and applies on the next browser action.

The Desktop shortcut continues to open its authenticated workspace directly in Brave, including when the background server is already running or still starting.

Workspace Pulse continues to use fixed six-second columns that separate genuine model/tool work from ambient connection and status events. The release also includes privacy-safe public visuals and a clearer README.

The installer continues to migrate compatible local instructions and legacy agent identity files safely.

Before installing, read the requirements and known limits in the README. Provider accounts, OpenCode, browser automation, and Blender integrations are not bundled. Existing OpenCode configuration is preserved.
