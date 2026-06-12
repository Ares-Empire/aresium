# Aresium — paint-pour render recipe (Blender 4.x–5.x / Mantaflow).
#
# Builds a scene where a "bucket" of red paint pours from the top and runs DOWN a vertical
# wall, sheeting and dripping, until it COVERS the whole frame and holds. Rendered over a
# TRANSPARENT background (no wall in the final image — the Aresium UI is the background),
# so the resulting alpha clip can be poured over the real screen.
#
# THE REVEAL (drain): a physically-simulated drain was tried and abandoned — a thin viscous
# film clings to the domain walls and won't fall out under gravity (a closed floor traps it;
# an open floor / outflow / dropping-trapdoor floor all failed to clear it; see git history).
# Instead the clip COVERS and holds, and the reveal is an ALPHA FADE-OUT baked in by ffmpeg
# (step 4) — the red simply dissolves to reveal the re-coloured UI. Simple, reliable, and the
# theme swap (paint.js VIDEO.coverAt) happens while fully opaque so it stays hidden. If you
# want a real liquid drain later, a DEEP domain (a falling 3-D body, not a thin sheet) is the
# direction — that's the open simulation-tuning item.
#
# ── How to use ────────────────────────────────────────────────────────────────────────
# Headless (no UI), bakes + renders + reports coverage in one go on a GPU box:
#       blender -b -P tools/blender/render_headless.py
# …or in the GUI:
# 1. Open Blender → Scripting tab → open this file → Run (or: `blender -P paint_pour.py`).
#    It builds the scene, the fluid sim, the paint material, camera, and render settings.
# 2. Select the "Domain" object → Physics → Fluid → Bake Data (then Bake Mesh).
#    Start at RES_MAX=128 to iterate fast; raise to 256 for the final once you like the motion.
# 3. Render → Render Animation. Frames land as RGBA PNGs in ./render/paint_####.png.
# 4. Package to a web alpha clip WITH the reveal fade (needs ffmpeg). For an 80-frame/24fps
#    clip (~3.33 s), fade alpha out over the last 0.8 s (st = 3.33 − 0.8 = 2.53):
#       ffmpeg -y -framerate 24 -i render/paint_%04d.png \
#         -vf "fade=t=out:st=2.53:d=0.8:alpha=1" \
#         -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -an \
#         web/public/assets/paint-pour.webm
# 5. render_headless.py prints the full-coverage time (also in render/coverage.json); set
#    VIDEO.coverAt (seconds) in web/public/app/paint.js to it. Done — it auto-activates.
#
# ── Tuning (the look lives here) ──────────────────────────────────────────────────────
#   RES_MAX        sim detail (128 fast / 256 crisp drips — much slower + more RAM)
#   VISCOSITY      higher = thicker, clingier paint that sheets; lower = runny/watery
#   POUR_FRAMES    how long the bucket pours (more = more volume = fuller coverage)
#   POUR_SPEED     initial downward velocity of the poured paint
#   PAINT_COLOR / roughness / transmission in build_paint_material() = the wet red look
#
# Fluid sims always need a couple of iterations — bake, watch, tweak, rebake.

import bpy
from mathutils import Vector

# ---- parameters ----
RES_X, RES_Y = 1080, 1620        # portrait reads best for a downward pour (object-fit: cover)
FPS = 24
FRAME_START, FRAME_END = 1, 80   # ~3.3 s: fast pour → full cover → hold (reveal = ffmpeg alpha fade)
RES_MAX = 128                    # raise to 256 for the final render
VISCOSITY = 0.05                 # paint-like cling so the cover holds solid; raise = thicker
POUR_FRAMES = 40                 # frames the bucket pours for (must fill the frame to full)
POUR_SPEED = 6.0                 # initial downward speed of the poured paint
PAINT_COLOR = (0.85, 0.02, 0.015) # vivid glossy red (linear; ≈ sRGB #EE2020, matches paint.png)
SAMPLES = 128                    # Cycles render samples


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for b in list(block):
            block.remove(b)


def add_fluid(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_add(type="FLUID")
    return obj.modifiers["Fluid"]


def tryset(obj, attr, value):
    """Set an attribute if this Blender version exposes it (API drifts between releases)."""
    try:
        setattr(obj, attr, value)
        return True
    except Exception as e:
        print(f"  [skip] {attr}: {e}")
        return False


def build_paint_material():
    mat = bpy.data.materials.new("Paint")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    inp = bsdf.inputs
    inp["Base Color"].default_value = (*PAINT_COLOR, 1.0)
    tryset(inp["Roughness"], "default_value", 0.12)           # glossy / wet
    for name, val in (("Transmission Weight", 0.12), ("Transmission", 0.12)):
        if name in inp: inp[name].default_value = val          # slight translucency at edges
    for name, val in (("Subsurface Weight", 0.10), ("Subsurface", 0.10)):
        if name in inp: inp[name].default_value = val
    for name in ("IOR",):
        if name in inp: inp[name].default_value = 1.45
    for name, val in (("Coat Weight", 0.4), ("Coat", 0.4), ("Clearcoat", 0.4)):
        if name in inp: inp[name].default_value = val          # wet sheen
    return mat


def main():
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = FRAME_START, FRAME_END

    # ── Domain: a wide, thin, tall box. Paint lives inside; gravity (-Z) pulls it down and it
    # accumulates from the floor up until it covers the whole frame. ──
    bpy.ops.mesh.primitive_cube_add(size=1)
    domain = bpy.context.active_object
    domain.name = "Domain"
    domain.scale = (1.6, 0.35, 2.4)     # wide, shallow depth, tall
    domain.location = (0, 0, 0)
    bpy.ops.object.transform_apply(scale=True)

    fmod = add_fluid(domain)
    fmod.fluid_type = "DOMAIN"
    ds = fmod.domain_settings
    ds.domain_type = "LIQUID"
    tryset(ds, "resolution_max", RES_MAX)
    tryset(ds, "use_mesh", True)
    tryset(ds, "use_flip_particles", True)
    tryset(ds, "use_viscosity", True)
    tryset(ds, "viscosity_value", VISCOSITY)   # if missing, set it in Physics ▸ Fluid ▸ Viscosity
    tryset(ds, "cache_frame_start", FRAME_START)
    tryset(ds, "cache_frame_end", FRAME_END)
    tryset(ds, "cache_type", "ALL")
    domain.data.materials.append(build_paint_material())
    domain.show_wire = True

    # ── Wall: a vertical plane at the back; paint sheets down its front face. Acts as a ──
    # collision effector during the sim, but is HIDDEN at render (the app is the backdrop). ──
    bpy.ops.mesh.primitive_plane_add(size=1)
    wall = bpy.context.active_object
    wall.name = "Wall"
    wall.rotation_euler = (1.5708, 0, 0)        # stand it up (face +Y, toward camera)
    wall.scale = (1.55, 2.35, 1)
    wall.location = (0, 0.18, 0)                 # just behind the paint
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    wmod = add_fluid(wall)
    wmod.fluid_type = "EFFECTOR"
    tryset(wmod.effector_settings, "effector_type", "COLLISION")
    wall.hide_render = True                      # keep as collision, but don't render it

    # ── Inflow: a wide thin bar near the top that pours paint downward for POUR_FRAMES. ──
    bpy.ops.mesh.primitive_cube_add(size=1)
    inflow = bpy.context.active_object
    inflow.name = "Pour"
    inflow.scale = (1.55, 0.25, 0.14)            # wide + chunky so it fills fast
    inflow.location = (0, 0.06, 1.0)             # near the top, in front of the wall
    bpy.ops.object.transform_apply(scale=True)
    imod = add_fluid(inflow)
    imod.fluid_type = "FLOW"
    fs = imod.flow_settings
    fs.flow_type = "LIQUID"
    tryset(fs, "flow_behavior", "INFLOW")
    tryset(fs, "use_initial_velocity", True)
    tryset(fs, "velocity_coord", (0.0, 0.0, -POUR_SPEED))
    # keyframe the pour: on for the first POUR_FRAMES, then off (the bucket empties)
    if hasattr(fs, "use_inflow"):
        fs.use_inflow = True;  fs.keyframe_insert("use_inflow", frame=FRAME_START)
        fs.use_inflow = True;  fs.keyframe_insert("use_inflow", frame=POUR_FRAMES)
        fs.use_inflow = False; fs.keyframe_insert("use_inflow", frame=POUR_FRAMES + 1)
    inflow.hide_render = True

    # ── Camera: orthographic, straight on the wall, framed tight so the paint reaches the
    # edges of the render. ortho_scale spans the frame's long (vertical) axis; the domain is
    # 2.4 tall × 1.6 wide, so 2.0 frames the paint body edge-to-edge and overfills the sides. ──
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.0
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (0, -6.0, 0)
    cam.rotation_euler = (1.5708, 0, 0)          # look +Y at the wall
    scene.collection.objects.link(cam)
    scene.camera = cam

    # ── Light: a soft key so the wet specular reads. ──
    light_data = bpy.data.lights.new("Key", type="AREA")
    light_data.energy = 800
    light_data.size = 6
    light = bpy.data.objects.new("Key", light_data)
    light.location = (-2.5, -4, 3)
    light.rotation_euler = (0.9, 0, -0.5)
    scene.collection.objects.link(light)

    # ── Render: Cycles, TRANSPARENT film (alpha), RGBA PNG sequence. ──
    scene.render.engine = "CYCLES"
    tryset(scene.cycles, "samples", SAMPLES)
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = "//render/paint_"

    print("\n[Aresium] Scene built. Next: select 'Domain' → Physics → Fluid → Bake Data,")
    print("          then Bake Mesh, then Render → Render Animation. See header for ffmpeg.\n")

    # ── BAKE (optional, may need the UI in some builds) ──
    # bpy.context.view_layer.objects.active = domain
    # try:
    #     bpy.ops.fluid.bake_all()
    # except Exception as e:
    #     print("Auto-bake failed; bake from the Physics panel instead:", e)


main()
