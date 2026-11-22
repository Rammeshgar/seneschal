# Seneschal — local Agenttrail map

## Receive workspace events {#events}
tech: Seneschal workspace event stream; authorized PC window
- [x] Observe OpenCode session and tool lifecycle metadata

## Agent board & dependencies {#board}
tech: Seneschal agent board and prerequisites
needs: [events]
- [x] Associate actual work with agent sessions

## Private metadata relay {#relay}
tech: Session pseudonyms, bounded events, local-only authenticated relay
needs: [events, board]
- [x] Send only permitted session state and tool names to the local map

## Live map {#map}
tech: Agenttrail 0.4.1, restricted local bridge mode
needs: [relay]
- [x] Display observed session runs and tool activity

## History and usage {#history}
tech: Existing independent Seneschal Activity service and Project Desk
needs: [events]
- [x] Preserve recorded token usage and local history separately

## decisions
- 2026-11-22 — This architecture map describes the actual observability integration. Live cards come from real OpenCode sessions observed by the authorized Seneschal PC window; their IDs are pseudonymous. Agenttrail does not infer which files or projects an OpenCode session touched, and does not run agents. This isolated map root is not an agent's working directory. No raw logs or user project directories are watched.
