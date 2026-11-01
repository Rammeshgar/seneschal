# Start Activity with Seneschal

On the PC, open **Activity → Service**, check **Start Activity with Seneschal**, and choose **Save startup preference**. The setting is off by default. It is saved separately in `data/activity-preferences.json`; provider settings, sign-in files, original conversations and private network mappings are unchanged.

The setting applies to future Seneschal **host** launches. It is not Windows startup, a scheduled task or a background Windows service. Closing Seneschal's browser window does not stop its host. The PC must remain awake, connected and running the Seneschal host for the phone dashboard to be available.

Automatic startup uses only an already-installed history runtime. It never runs the package installer. Open Activity once on the PC to prepare its runtime if needed. Startup failure does not stop the chat engine, does not adopt another service or kill its processes, and can be inspected in Activity → Service. Disabling the preference does not stop an already-running history service; use its separate Stop service action if desired.

The phone remains read-only for service management. While history is stopped it shows **Waiting for PC history** and a **Check PC status** button instead of an unusable Start button. It automatically loads the available index when the host service reaches ready/indexing/degraded state. Startup preferences are neither readable nor writable through the private phone gateway.

This update changes the PC host, so finish any PC/phone tasks and restart Seneschal once using its existing guarded restart script before using the new setting. No full PC reboot or new Tailscale mapping is needed. Then reload the browser pages, enable the setting once on the PC and save it. Future host launches can prepare history without first opening Activity on the desktop.
