# Runtime imagery

Images in this folder can be loaded by the running app at `/workspace/assets/<filename>`.

Use optimized WebP or AVIF for backgrounds. Keep large marketing originals in the top-level `assets/` folder, not here.

Example CSS:

```css
.welcome-stage {
  background-image: linear-gradient(rgba(5, 7, 11, .55), rgba(5, 7, 11, .8)), url('/workspace/assets/seneschal-atmosphere.webp');
}
```
