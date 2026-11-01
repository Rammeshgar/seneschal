# Private phone access

Phone Access lets your own paired browser use the Seneschal host on your PC through Tailscale. The PC must remain awake, connected and running Seneschal. This is remote access to that PC, not cloud hosting or an internet-exit VPN.

## Before connecting

- Install and sign in to Tailscale on both devices with the same personal account.
- This first implementation accepts an untagged personal PC and refuses a visible tailnet containing another identity or tagged device. Review access before proceeding.
- Keep Seneschal on its normal loopback address. The phone gateway uses a separate loopback port, 4200, and accepts the narrowly configured private Serve route only.
- Public Funnel and unrelated existing Serve mappings are refused. Do not reset someone else's Serve mapping to get around this check.

## Qualify this source installation

From the Seneschal folder, with Docker Desktop running and the official `node:22-bookworm-slim` image already installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-private-access.ps1
```

The verifier runs synthetic checks without a network, mounts only allowlisted files read-only and writes a local source-hash proof after success. It never downloads an image or starts Docker Desktop for you. Install the required image separately if it is missing. Changes to qualified files require another verification; never copy an old proof to bypass it. A passing fixture run does not establish that your actual phone, microphone or engine approvals work.

## First connection

1. Open Seneschal on the PC. Complete any active tasks before restarting an older host to load changed backend files.
2. In a terminal opened in this installation folder, run `node scripts/private-access.cjs prepare`. This creates protected local settings, not a public mapping. It refuses to overwrite an existing preparation folder.
3. In Seneschal on the PC, open **Settings → Private phone access** and choose **Start phone access**.
4. Configure a private Tailscale Serve HTTPS route to `http://127.0.0.1:4200`. For a clean Serve configuration, the CLI form is `tailscale serve --bg --https=443 http://127.0.0.1:4200`. Do not enable Funnel. The app deliberately does not create or overwrite this mapping.
5. Choose **Pair a browser** on the PC. Open the displayed private HTTPS address on your phone with Tailscale connected and enter the one-time code there.
6. Test the model list, a normal chat and a harmless tool request. Check that the tool approval appears before execution; reject the test if you do not want it to run.

Keep pairing codes on your own devices. Codes expire after ten minutes and are single-use. A paired browser can return for twelve hours unless disconnected, revoked or its cookie is cleared. Up to four browsers may be paired.

## What stays on the PC

Gateway preparation, pairing management, provider credentials, service management and other PC-only operations remain restricted. The gateway filters upstream responses rather than exposing the complete local control plane. Cloud models still receive the requests sent to them; Tailscale does not hide speech audio from a selected cloud speech provider.

The phone's Activity dashboard reads the PC's available history index. To make it available after future host launches, enable **Activity → Service → Start Activity with Seneschal** on the PC and save the preference. See [Activity startup](ACTIVITY-STARTUP.md).

## Disconnect and recovery

**Stop phone access** revokes all paired browsers and unused codes. It does not cancel PC tasks, delete history or remove the private Serve mapping. Revoke one browser from the PC list when only that browser should lose access.

If the phone is stale, reload the browser page. A changed backend requires a host restart after active tasks finish; restarting only the gateway cannot load new code into an older host process. See [connection recovery](CONNECTION-RECOVERY.md) and [permission migration](PERMISSION-OVERRIDES.md).

If preparation or qualification fails, read the exact local error. Preserve existing settings and logs for inspection. Do not share credentials, pairing codes or the contents of the protected private-access folder in an issue.
