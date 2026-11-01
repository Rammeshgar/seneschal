# Afterlight worlds in Seneschal

The separate `citylight-world.js` restores Seneschal's original jade-and-copper skyline as **Citylight**. It is not an Afterlight import and does not replace City Nocturne or the other worlds. Like the other original renderers, it delegates all scheduling, pause and persistence to the atmosphere host.

These five original, code-native pixel-art worlds are imported from Sadeq Rezai's Afterlight 1.7: Canal City, Northstar, The Last Sleeper, Pelagic Archive and Lantern Sanctuary. Original artwork and renderer attribution are retained in the generated files.

`afterlight-worlds.js` contains the catalog and artwork. `afterlight-engine.js` exposes the isolated factory `window.SeneschalAfterlight.create(canvas)`. It starts paused at 960 × 540 pixels; Seneschal owns controls and persistence. Disposing it cancels its animation and removes lifecycle listeners.

The integration is entirely local: no audio, network, AI/provider calls, telemetry, native desktop controls or Afterlight-host controls. It captures no app input, accesses no Afterlight preference records, and needs no iframe, dynamic evaluation or content-security-policy weakening.

`app/assets/wallpapers/afterlight-*.png` are actual 480 × 270 previews from this renderer at 19 seconds, with the Nocturne palette and each world's default weather.

## Refreshing from the original local source

From the Seneschal App folder, run:

```powershell
node scripts/sync-afterlight-wallpapers.cjs "C:/path/to/Afterlight/web"
```

The argument points to the folder containing `scene.js` and `worlds.js`. Alternatively, set `SENESCHAL_AFTERLIGHT_SOURCE`. A source folder is required; no developer-specific path is assumed. Sync is mechanical and offline, never modifies Afterlight, and records source-file SHA-256 hashes. Changed source structure stops the sync for review.

`tests/afterlight-renderer.test.cjs` verifies 15 exact raster comparisons plus scheduling, pause handling, isolation and disposal using `@napi-rs/canvas`.
