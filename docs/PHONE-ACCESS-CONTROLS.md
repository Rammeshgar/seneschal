# Phone Access controls

Open **Settings → Private phone access** on the PC.

| Control | What it does |
| --- | --- |
| Start phone access | Starts the qualified gateway using the prepared local configuration. |
| Pair a browser | Generates a single-use ten-minute code. Enter it only in the browser you are pairing. |
| Refresh | Reads the gateway and paired-browser state. |
| Revoke | Removes the selected browser's access. |
| Stop phone access | Stops access and revokes every browser and unused code. PC tasks continue. |

The PC panel does not create a Tailscale mapping or start access automatically. A successful HTTP response alone is not proof that a remote browser is authorized. Qualification, owner identity, protected configuration and pairing are distinct checks.

Follow [private access setup](PRIVATE-ACCESS-SETUP.md) for prerequisites and the first connection. Source changes invalidate the local qualification proof. Run the verifier on the exact installation being used; historical screenshots and another installation's proof are not substitutes.
