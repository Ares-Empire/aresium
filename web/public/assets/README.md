# Paint-pour video asset

Drop the rendered clip here as **`paint-pour.webm`** and the transition upgrades from the
real-time GPU sim to the photoreal video automatically (no code change). Until then,
`paint.js` falls back to the sim, so a missing file is harmless.

## Contract (what `paint.js` expects)

- **`paint-pour.webm`** — VP9 with an **alpha channel** (`yuva420p`). The clip shows red
  paint pouring over **transparency** (no wall/background baked in — the app *is* the
  background). Where the frame is transparent, the dashboard shows through.
- The paint must reach **full coverage** (opaque over the whole frame) at some moment, then
  drain away to fully transparent by the end. Set `VIDEO.coverAt` in `paint.js` to the
  time (seconds) of full coverage — the theme is swapped underneath at that instant.
- Aspect doesn't matter: it's drawn `object-fit: cover`, so it fills any screen. A tall
  (portrait) render reads best for a downward pour.
- Optional **`paint-pour.mov`** — HEVC + alpha (`hvc1`) for Safari/iOS. Set `VIDEO.mov`
  in `paint.js` if you add it.

## How to produce it

See `tools/blender/paint_pour.py` for the Blender (Mantaflow) sim + render recipe, then
package the rendered PNG sequence with ffmpeg:

```bash
ffmpeg -y -framerate 24 -i render/paint_%04d.png \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -an \
  web/public/assets/paint-pour.webm
```
