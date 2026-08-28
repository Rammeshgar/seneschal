# Changelog

## 0.2.1-beta.6 — 2026-08-29

- Reworked Workspace Pulse into fixed six-second buckets with stable magnitude scaling
- Separated genuine model/tool work from ambient connection and status events
- Added clear Work and Ambient legends, rolling counts, and per-bucket explanations
- Added privacy-safe README, GitHub social-preview, and LinkedIn launch artwork
- Expanded the public README with an accurate interface overview
- Added a practical LinkedIn launch kit with post copy, project copy, alt text, and asset guidance

## 0.2.1-beta.5 — 2026-08-28

- Replaced the original decorative Workspace Pulse bars with a rolling one-minute OpenCode event chart
- Separated last-minute activity, session event total, connection status, and engine version
- Added safe migration of local instructions and settings from the legacy OpenCode Atelier installation
- Added automatic backup and migration of the legacy Digital Servant agent identity to Seneschal
- Fixed the installer crash when WSL is paused or returns no output
- Restored compatibility with the Windows PowerShell 5.1 JSON parser
- Detects OpenCode through the same interactive Bash environment used by the working launcher
- Migrates legacy Playwright and Blender launchers before removing OpenCode Atelier
- Updates live OpenCode MCP paths and agent labels to Seneschal with a configuration backup
- Removes obsolete Digital Servant shortcuts and superseded beta installers only after migration verification
- Shows a clear launcher error and saves `data/launcher.log` instead of failing invisibly

## 0.2.0-beta.1 — 2026-08-28

- Renamed the product from Digital Servant to Seneschal
- Updated the agent identity, installer, desktop shortcut, interface copy, and public documentation
- Added organized locations for brand assets, README screenshots, and runtime imagery
- Added safe serving for local interface images under `/workspace/assets/`
- Kept legacy local preference keys and environment variables readable during migration

## 0.1.0-beta.1 — 2026-08-28

- First public beta
- Localhost-only secure proxy for OpenCode
- Plan, Build, and Chat roles
- Approval profiles and visible tool state
- Model, thinking, session, message, and composer controls
- Instruction and reusable skill editor
- Attachment and JSON normalization support
- Voice input and spoken-response controls
- Optional browser and Blender status surfaces
- Matte day/night themes and switchable motion backgrounds
- Windows installer with WSL detection and desktop shortcut
