# Getting the most from Seneschal

## Start with one project and a small task

Open Seneschal from its desktop shortcut, connect a provider through OpenCode and select a project folder. Choose a model in the top bar. Start a new conversation when changing the folder in which tools should work; moving a conversation between sidebar groups does not change the engine's original working folder.

Use **Plan** to understand a task before changing files, **Build** to carry it out with your configured permissions, or **Chat** for a conversation without active tools. A useful first request is: “Read this project's instructions and explain its structure. Do not change anything.”

## Understand decisions before approving them

Open **Permissions → Manage** to choose the policy. Tool availability and tool approval are separate: making an integration available does not grant permission to use it. Review the requested action on each approval card. **Allow once** applies to that request; **Always** remembers a choice for the session; **Reject** denies it.

An older conversation may have saved blanket tool overrides. Seneschal asks before migrating them and stops if the migration cannot be confirmed. Cancel preserves the draft and sends nothing. That migration dialog is different from the approval for the next tool action. See [permission correction](PERMISSION-OVERRIDES.md).

Questions are separate again: an agent can pause to ask for information without requesting a tool permission. Answer or dismiss the specific question card. See [question controls](QUESTION-CONTROLS.md).

## Keep the conversation comfortable

Upload is next to the prompt. Open **Options** for Skills, Thinking and Agent settings. Voice, Mascot and Send/Stop stay easy to reach. Stop remains available while the agent is working.

Completed Bash and other tool results start compact. Expand the result when you need its details; running tools and errors remain visible. The message Actions menu contains message controls such as copy, pin, edit and retry.

Collapse a sidebar to keep its shortcut icons without losing the main conversation. The collapse controls stay at their established edges. Hover a control for a short explanation; on touch screens, hold it to read the explanation without activating it. Choose English or فارسی in Settings. Persian mode changes interface copy and reading direction while preserving chat content, file paths and drafts.

## Voice and the mascot

Click the main Voice button to start or stop the current mode. Use its dropdown arrow to change voice options.

- **Browser voice** uses the speech capabilities provided by the browser and operating system. Availability and audio processing vary by browser.
- **NVIDIA cloud voice** is optional and requires supported NVIDIA access plus explicit cloud-audio consent. Audio and reply text are processed by NVIDIA for speech. Developer access may be limited; it is not a promise of unlimited free use. The server keeps the API key out of the frontend. The current integration uses its configured speaker; it does not offer a general speaker catalogue selector.

Use the laptop microphone or open the private phone page and allow that device's microphone. Speech output and the chat model are separate choices. Mic mute and speaker mute are separate controls; muting one does not stop the entire conversation. If access fails, inspect the displayed error instead of assuming another service was selected.

Turn on **Mascot** to show the Seneschal companion. It follows listening, thinking and speaking state. Use its header to move a floating card, Layout to adjust placement/size/camera, and Minimize/Maximize/Restore to change the view. Escape returns from the full-screen companion. The canvas can rotate around the character. Voice controls remain available in the companion; animation is approximate/audio-reactive rather than phoneme-perfect lip synchronization. Reduced-motion preferences are respected.

## Activity and wallpapers

**Activity** provides Overview, Sessions, Usage and Service views. Prepare the optional local history service on the PC to inspect recorded history. Live progress captured in the current window and persistent indexed history are different sources. Usage estimates can be incomplete and are not provider invoices. See [Activity integration](ACTIVITY-INTEGRATION.md) and [startup](ACTIVITY-STARTUP.md).

Open **Wallpapers** from the sidebar or Settings. The collection includes original Seneschal scenes, five Afterlight worlds and still/geometry options. Gallery images are still previews; choose **Explore full scene** for animation and interactions. Visibility, scene activity, lights and frame-rate controls are local preferences. You can pause motion or keep conversations still. No speech permission or model call is needed for a wallpaper. See [atmospheres](ATMOSPHERES.md).

## Work from your phone

Keep Seneschal running on the PC. Pair your own phone browser through the private Tailscale gateway; this does not move the engine into the cloud. See [private phone setup](PRIVATE-ACCESS-SETUP.md). Only the selected cloud providers process the requests sent to them; a private address does not change a provider's retention policy.

If the PC Activity service is unavailable, prepare it there and optionally enable **Start Activity with Seneschal** for future host launches. The phone reads the available index and cannot administer the service.

## Larger tasks and integrations

For a task with independent parts, create a plan first and use **To board** on that specific response. Review the proposed roles, models, access and dependencies before running it. Downstream workers receive completed outputs from their dependencies. Use a supervisor for the results you actually want reviewed; more workers are not automatically better.

Browser automation, Blender and the VS Code companion need their own installed integrations. Making an integration visible does not approve its actions. A missing bridge should produce a status or setup error, not a promise that it is working.

## Update and recover

Source checkouts update through Git. Packaged installations use **Settings → App updates** for published ZIP releases; a new source commit is not automatically a packaged release. Finish active tasks before a host restart. Refresh each browser page after interface changes.

Seneschal attempts to reconnect and catch up after a lost connection without resending your prompt or approving work. An uncertain response is not an invitation to repeatedly click Send or Allow. Inspect the current state first. See [connection recovery](CONNECTION-RECOVERY.md), [backups](BACKUP-RECOVERY.md) and [security](../SECURITY.md).
