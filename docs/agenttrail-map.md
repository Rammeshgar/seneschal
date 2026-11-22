# Optional live Agenttrail Map

Seneschal's existing Activity history and token usage are not changed by this feature. Agenttrail Map 0.4.1 is a separate read-only, local dashboard for real observed OpenCode session and tool lifecycle events. The local Seneschal window must be open and authenticated for live updates. It does not read global Codex or Claude logs, watch actual project files, or execute tasks. The map's five component nodes illustrate the observability architecture, not a fabricated work plan for your agents.

## Enable on the PC

The source integration is disabled by default. From the installed Seneschal App folder, create the `data/agenttrail-map.enabled` marker with exactly `enabled`, then restart Seneschal after finishing ongoing agent work. The host starts the bundled loopback service at `http://127.0.0.1:5550/` and generates a local relay key in `data/agenttrail-map.secret`. No separate download or provider API call is required. If port 5550 is already occupied, the service fails closed rather than relocating or forwarding events to another service.

Open Activity and choose **Live Agenttrail Map**, or open the local URL directly. The map appears only on the PC. To disable, remove the specific `data/agenttrail-map.enabled` marker and restart Seneschal; the host no longer starts the map. History and token monitoring continue separately.

## Data boundaries

The PC-local authorized route accepts bounded session lifecycle and tool-name metadata. The host replaces session and tool-call IDs with keyed pseudonyms, transmits only to the verified isolated map on 127.0.0.1, and never sends prompts, command arguments, tool outputs, file paths, account credentials or model history. The map scope and its derived state are under ignored `local-runtime/agenttrail-map-scope/`. The authentication key stays in ignored `data/`; do not commit or share it. Optional map state remains local. Public or phone access is not enabled. Do not share a recording without reviewing the local session labels and tool activity.

The upstream project does not fully support Windows; Seneschal's restricted session lifecycle integration has been tested on Windows separately. The original dependency-based agent board and local usage service remain authoritative for task status and recorded tokens.
