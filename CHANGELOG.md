# Changelog

## 0.2.1-beta.12 — 2026-08-30

- Repairs legacy Playwright launchers that were permanently hard-coded to hidden mode, then reconnects only Playwright so other sessions keep running
- Detects direct browser requests, URLs, and the common `playwrite` misspelling before a task starts, enabling the visible agent-controlled Brave window automatically
- Lets an existing planning session become the Agent Board's retained source brief without copying or losing its conversation
- Adds per-agent model, role, access profile, multi-agent dependencies, live provider summary/tool activity, individual stop, edit, retry, and retained-session controls
- Makes the Supervisor a normal configurable agent that can use any connected model and wait for every required worker
- Adds guided Agent Board onboarding and makes the distinction between provider summaries and private chain-of-thought explicit
- Adds an optional VS Code companion with a Seneschal status-bar button for opening the current project, choosing a project session, or creating a new project session
- Adds a fresh privacy-safe Agent Board screenshot and packages the companion extension in the installer and release ZIP

## 0.2.1-beta.11 — 2026-08-30

- Adds a persistent Agent Board backed by real OpenCode sessions
- Adds configurable parallelism, dependency waiting, labelled handoffs, retained session links, pause/stop controls, and a Planner → Builder → Reviewer → Supervisor starter team
- Adds a local Visual Studio Code bridge for opening the current WSL project or an exact file, line, and column
- Automatically enables the visible Playwright Brave window for explicit browser prompts, including prompts typed directly into a session
- Preserves other running sessions when browser visibility changes by reconnecting only the Playwright MCP bridge
- Adds updated privacy-safe workspace and Agent Board screenshots
- Expands installer cleanup through beta 10 while preserving the single Seneschal desktop shortcut

## 0.2.1-beta.10 — 2026-08-30

- Keeps each session's selected model independent instead of changing every session
- Makes session switching explicitly preserve and report work continuing in the background
- Labels command-palette model changes as applying to the current session only
- Restarts only the Playwright MCP connection when browser visibility changes, preserving every running session
- Reads visibility from the exact Playwright launcher configured in OpenCode so the visible Brave window actually opens

## 0.2.1-beta.9 — 2026-08-29

- Adds confirmed Delete controls to normal, pinned, and archived session rows
- Adds confirmed local message deletion while accurately preserving OpenCode source transcripts
- Adds safe project removal from Seneschal without deleting project folders, files, or sessions
- Makes Browser tasks enable visible Brave before the prompt is sent instead of silently running headlessly
- Blocks a Browser task with a clear restart instruction when the visible bridge backend is stale

## 0.2.1-beta.8 — 2026-08-29

- Adds per-conversation message pinning with a compact pinned-message shelf
- Adds persistent session pinning with pinned sessions sorted to the top
- Adds a dedicated pinned-sessions sidebar section with its own count and minimize control
- Adds reversible local session archiving with an archive counter and restore action
- Adds an Archived sessions manager in Settings with one-click restore controls
- Adds reversible local message archiving with a session archive counter
- Adds independent minimize controls for Projects, Sessions, and pinned messages
- Adds a visible Brave switch for the actual Playwright MCP browser
- Restarts only Seneschal's Playwright bridge when browser visibility changes

## 0.2.1-beta.7 — 2026-08-29

- Makes every Desktop shortcut click open Seneschal directly in Brave
- Reopens the authenticated workspace when the background server is already running
- Waits for an in-progress startup instead of exiting silently
- Discards stale instance locks left behind by a previous Windows boot

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
