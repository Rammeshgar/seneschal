# Workspace atmospheres

Open **Settings → Workspace atmosphere**, or **Workspace tools → the atmosphere button**. The command palette also includes **Atmosphere collection**.

The collection contains four Seneschal scenes—Citylight, City Nocturne, Lunar Relay and Orbital Foundry—and all five Afterlight 1.7 worlds: Canal City, Northstar, The Last Sleeper, Pelagic Archive and Lantern Sanctuary. Orbit Drift and Still composition remain available.

**Citylight** restores the original green-and-bronze skyline composition: the striped copper moon on the left, scanning tower on the right, layered city lights and reflective avenue. It has been refined as a separate scene; it does not replace City Nocturne or any Afterlight world. Choose its “Restored original” thumbnail to apply it, or search “Citylight” in the command palette. Its controls include weather, city life, window warmth and skyline details; actions send traffic, toggle city lights, and pulse the tower signal.

Select a thumbnail to apply a world. Color story, weather/underwater ambience, activity, glow and signature details are remembered separately for each scene. Vacuum scenes do not present unsupported weather controls. “Follow day / night” changes the scene palette with the workspace theme. Reset this scene resets only its appearance.

**Explore full scene** opens the actual live renderer, not a recorded image. Try the labeled action buttons with mouse or keyboard; Afterlight scenes also support authored clickable hotspots. Escape returns to the collection. Close the collection to return to work. The workspace background itself never intercepts clicks or covers the composer.

Home visibility and conversation visibility are separate. Conversation visibility is capped at 40%, and background motion is frozen during conversations by default. Enable “Animate during conversations” if desired. The frame-rate choices are 15, 30 and 60 fps limits, not guaranteed rates on every computer. System reduced motion, background tabs and manual Pause stop animation; changing settings still redraws a single frame.

Rotation is optional and initially off. It cycles only the nine pixel worlds, in order or shuffled without immediate repetition. The interval counts active viewing time: it pauses in the collection/preview, hidden tabs, manual/system pauses and quiet conversations. Choosing Orbit or Still switches rotation off. There are no sleep catch-up jumps.

Preferences are stored locally in this browser under `seneschal-atmosphere.v1`; the existing `atelier-motion` selection remains compatible. They are not synced to another browser or the standalone Afterlight app. No microphone, playback capture, model/API calls, provider tokens, external image service or native wallpaper bridge is used by these backgrounds. Other Seneschal functions keep their existing permissions and behavior.

## Implementation and verification

- `app/wallpapers.js`: selection, preferences, lifecycle, preview and rotation.
- `app/wallpapers.css`: responsive gallery and workspace readability.
- `app/wallpapers/legacy-worlds.js`: cached, authored original pixel scenes, with no independent scheduler.
- `app/wallpapers/citylight-world.js`: the restored Citylight composition, with cached detail and the same host-owned lifecycle.
- `app/wallpapers/afterlight-*.js`: isolated local Afterlight art/runtime. See their README for regeneration.
- `tests/wallpapers-host.test.js`: dependency-free lifecycle, preferences, route and accessibility contracts.
- `tests/wallpapers-legacy.cjs` / `tests/afterlight-renderer.test.cjs`: real raster/control checks; require the existing canvas test dependency.

All script routes are explicit and same-origin. The restrictive content security policy is unchanged. Private-access qualification includes the new runtime sources and host tests. Future source changes still require the existing isolated verifier; there is no qualification bypass or automatic remote enablement.
