# Seneschal companion

`ares.glb` is the current Seneschal companion created for this platform, replacing the earlier EARIS demo. It contains 47 meshes and six named animations: idle, listening, thinking, speaking, greeting and playful. The browser uses this bundled asset locally; Blender and the original development project are not required at runtime. The retained `ares` filenames identify the integration and are not the displayed character name.

Three.js r160 and its GLTFLoader/BufferGeometryUtils are distributed under the accompanying MIT license. Only their import paths were adjusted to use bundled local modules. The app requires no CDN, decoder worker, WebAssembly permission, or third-party mascot hosting.

Voice services retain their existing consent and privacy behavior. The mascot consumes state labels and playback amplitude locally; it does not acquire microphone permission, send prompts, or approve actions. Mouth animation is audio-reactive or approximate, not phoneme-aligned lip sync.
