# Aresium — headless driver for paint_pour.py (no GUI: bake + render on a render box).
#
# paint_pour.py is written for the Scripting tab (build scene → click Bake → click Render).
# This wrapper does the same thing from the command line so it can run on a GPU machine /
# CI without anyone touching Blender's UI:
#
#   blender -b -P tools/blender/render_headless.py
#
# It (1) execs paint_pour.py to build the scene, (2) enables the Cycles GPU, (3) bakes the
# Mantaflow liquid, (4) renders the RGBA PNG sequence to tools/blender/render/, and
# (5) measures per-frame alpha coverage and prints the frame/second where the paint fully
# covers the screen — that number is VIDEO.coverAt in web/public/app/paint.js.
#
# Fast-pass overrides (env vars, all optional) so a first rough clip renders quickly:
#   ARESIUM_RES_MAX   fluid sim detail        (default from paint_pour.py: 128)
#   ARESIUM_SAMPLES   Cycles samples          (default 128)
#   ARESIUM_FRAME_END last frame              (default 120)
#   ARESIUM_RES_X / ARESIUM_RES_Y  pixel size (default 1080x1620)
#   ARESIUM_DENOISE   "1"/"0" toggle denoiser (default 1)
#
# After it finishes, package the frames (needs ffmpeg) — see tools/blender/README or the
# header of paint_pour.py:
#   ffmpeg -y -framerate 24 -i tools/blender/render/paint_%04d.png \
#     -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -an web/public/assets/paint-pour.webm

import bpy, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(HERE, "paint_pour.py")
RENDER_DIR = os.path.join(HERE, "render")
CACHE_DIR = os.path.join(HERE, "cache_fluid")


def envi(name, default):
    v = os.environ.get(name)
    return int(v) if v not in (None, "") else default


def envb(name, default):
    v = os.environ.get(name)
    return default if v in (None, "") else v not in ("0", "false", "False")


def build_scene():
    """Exec paint_pour.py to build the scene, with env-var overrides applied first."""
    code = open(SRC, "r", encoding="utf-8").read()
    # The recipe calls main() at the bottom; strip that so we can override constants first.
    marker = "\nmain()\n"
    assert marker in code, "paint_pour.py no longer ends in a bare main() call — update the wrapper."
    code = code.replace(marker, "\n")
    ns = {"__name__": "paint_pour"}
    exec(compile(code, SRC, "exec"), ns)

    ns["RES_MAX"] = envi("ARESIUM_RES_MAX", ns["RES_MAX"])
    ns["SAMPLES"] = envi("ARESIUM_SAMPLES", ns["SAMPLES"])
    ns["FRAME_END"] = envi("ARESIUM_FRAME_END", ns["FRAME_END"])
    ns["RES_X"] = envi("ARESIUM_RES_X", ns["RES_X"])
    ns["RES_Y"] = envi("ARESIUM_RES_Y", ns["RES_Y"])
    print(f"[headless] RES_MAX={ns['RES_MAX']} SAMPLES={ns['SAMPLES']} "
          f"frames={ns['FRAME_START']}..{ns['FRAME_END']} res={ns['RES_X']}x{ns['RES_Y']}")
    ns["main"]()
    return ns


def enable_gpu(scene):
    """Pick the best available Cycles GPU backend; fall back to CPU if none."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception as e:
        print("[headless] Cycles addon prefs unavailable, using CPU:", e)
        return None
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except Exception:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if not gpus:
            continue
        for d in prefs.devices:
            d.use = (d.type == backend)  # GPUs of this backend on, CPU off
        scene.cycles.device = "GPU"
        print(f"[headless] Cycles GPU backend: {backend} ({', '.join(d.name for d in gpus)})")
        return backend
    print("[headless] No GPU backend detected — rendering on CPU (slow).")
    return None


def bake_fluid():
    domain = bpy.data.objects["Domain"]
    ds = domain.modifiers["Fluid"].domain_settings
    os.makedirs(CACHE_DIR, exist_ok=True)
    ds.cache_directory = CACHE_DIR
    bpy.ops.object.select_all(action="DESELECT")
    domain.select_set(True)
    bpy.context.view_layer.objects.active = domain
    print("[headless] baking fluid (data + mesh)…  this is the slow part")
    bpy.ops.fluid.bake_all()
    print("[headless] bake complete →", CACHE_DIR)


def measure_coverage(scene, fps):
    """Per-frame opaque-pixel fraction → first fully-covered frame → coverAt seconds.

    Uses Blender's bundled numpy; loads each rendered PNG's alpha channel.
    """
    import numpy as np
    rows = []
    cover_frame = None
    for f in range(scene.frame_start, scene.frame_end + 1):
        path = os.path.join(RENDER_DIR, f"paint_{f:04d}.png")
        if not os.path.exists(path):
            continue
        img = bpy.data.images.load(path, check_existing=False)
        try:
            w, h = img.size
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            cov = float((px[..., 3] > 0.95).mean())
        finally:
            bpy.data.images.remove(img)
        rows.append({"frame": f, "coverage": round(cov, 4)})
        if cover_frame is None and cov >= 0.985:
            cover_frame = f
    report = {
        "fps": fps,
        "frames": rows,
        "fullCoverFrame": cover_frame,
        "coverAtSeconds": round(cover_frame / fps, 3) if cover_frame else None,
        "peakCoverage": max((r["coverage"] for r in rows), default=0.0),
    }
    with open(os.path.join(RENDER_DIR, "coverage.json"), "w") as fh:
        json.dump(report, fh, indent=2)
    print("[headless] coverage report → tools/blender/render/coverage.json")
    if cover_frame:
        print(f"[headless] >>> full coverage at frame {cover_frame} "
              f"= {report['coverAtSeconds']}s  → set VIDEO.coverAt in paint.js")
    else:
        print(f"[headless] >>> paint never reached full coverage "
              f"(peak {report['peakCoverage']:.2%}). Increase POUR_FRAMES / volume and rebake.")
    return report


def main():
    ns = build_scene()
    scene = bpy.context.scene
    enable_gpu(scene)

    if envb("ARESIUM_DENOISE", True):
        try:
            scene.cycles.use_denoising = True
            scene.cycles.denoiser = "OPTIX"
        except Exception:
            try:
                scene.cycles.denoiser = "OPENIMAGEDENOISE"
            except Exception as e:
                print("[headless] denoiser unavailable:", e)

    os.makedirs(RENDER_DIR, exist_ok=True)
    scene.render.filepath = os.path.join(RENDER_DIR, "paint_")
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    if envb("ARESIUM_BUILD_ONLY", False):
        print("[headless] BUILD_ONLY set — scene built OK, skipping bake/render.")
        return

    bake_fluid()

    print("[headless] rendering animation…")
    bpy.ops.render.render(animation=True)
    print("[headless] render complete →", RENDER_DIR)

    measure_coverage(scene, scene.render.fps)


main()
