# Digital Servant

A local-first desktop workspace for OpenCode on Windows and WSL.

Digital Servant gives OpenCode a focused, personal interface: model switching, Plan/Build/Chat roles, approval controls, instruction and skill editing, session navigation, attachments, voice input, optional browser and Blender status, and a matte day/night visual system.

This is a public beta. It is useful today, but it is not a replacement for understanding which model provider you are using or what an approved tool action can change.

## What it is

- A custom browser interface served only on `127.0.0.1`
- A secure local proxy in front of OpenCode's server
- A Windows launcher for an OpenCode installation inside WSL
- A visual editor for persona, general instructions, project instructions, roles, and reusable skills
- A permission-oriented workspace where Plan is read-only and Build asks before changes by default

It is not an AI model, a provider subscription, or a way around provider usage limits.

## Requirements

- Windows 11
- WSL with an installed Linux distribution (Ubuntu is the default)
- Node.js 20 or newer on Windows
- OpenCode installed and working inside that WSL distribution
- At least one model provider connected through OpenCode

Brave is preferred when installed. Otherwise, Digital Servant opens in the Windows default browser. Blender and browser automation are optional and require their own local integrations.

## Install

1. Download the latest beta ZIP from [Releases](https://github.com/Rammeshgar/digital-servant/releases).
2. Extract it to a normal folder.
3. Double-click `install.cmd`.
4. Open **Digital Servant** from the desktop shortcut.

The installer copies the app to `%LOCALAPPDATA%\DigitalServant`, detects the WSL home folder, creates a local desktop shortcut, and preserves any existing OpenCode configuration. If your distribution is not named Ubuntu, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -WslDistribution "YourDistroName"
```

## Providers and cost

Provider accounts and API keys stay in OpenCode; this interface does not put credentials in its frontend. ChatGPT subscriptions and provider APIs are separate products. A model labelled free can still be temporary, rate-limited, or unavailable upstream.

The `$10` display is a soft local target. Set a real hard limit with the provider whenever the provider supports one.

## Security and privacy

- The workspace binds to localhost, not the local network.
- A random local session secret and a separate OpenCode server password are generated at first launch.
- Runtime secrets, sessions, backups, and settings live in `data/`, which is excluded from Git.
- Share links are disabled in the starter OpenCode configuration.
- Existing OpenCode configuration files are not overwritten by the installer.
- Any cloud model you select still receives the prompt and context required for the request.

Read [SECURITY.md](SECURITY.md) before exposing or modifying the local server.

## Optional integrations

The interface can show and use browser or Blender tools only when those tools are configured in OpenCode and their local bridge is running. The public beta does not silently install browser extensions, MCP servers, Blender add-ons, or paid services.

## Settings

Machine-specific values are stored locally in `%LOCALAPPDATA%\DigitalServant\data\settings.json`:

```json
{
  "wslDistribution": "Ubuntu",
  "wslLinuxHome": "/home/yourname",
  "launchDirectory": "/home/yourname/projects",
  "blenderExecutable": "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe"
}
```

The Blender entry is optional; common installed versions are detected automatically.

## Known limits

- Windows/WSL only in this beta
- Tested against OpenCode 1.18.x; upstream API changes can break parts of the interface
- Provider model lists and capabilities are controlled by OpenCode and the provider
- Full private model reasoning is not exposed; the UI can show provider-supplied summaries and live tool activity
- Browser and Blender bridges must be installed and started separately
- The local cost figure is informational, not a guaranteed cap

## Development

```powershell
npm test
npm start
```

The server intentionally has no npm runtime dependencies.

## License

Digital Servant is MIT licensed. OpenCode's license is included separately in `docs/OPENCODE-LICENSE.txt`.
