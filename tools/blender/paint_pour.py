# Aresium — paint-pour render recipe (Blender 4.x / Mantaflow).
#
# Builds a scene where a "bucket" of red paint pours from the top and runs DOWN a vertical
# wall, sheeting and dripping, covering the frame, then draining. Rendered over a
# TRANSPARENT background (no wall in the final image — the Aresium UI is the background),
# so the resulting alpha clip can be poured over the real screen.
#
# ── How to use ────────────────────────────────────────────────────────────────────────
# 1. Open Blender 4.x → Scripting tab → open this file → Run (or: `blender -P paint_pour.py`).
#    It builds the scene, the fluid sim, the paint material, camera, and render settings.
# 2. Select the "Domain" object → Physics → Fluid → Bake Data (then Bake Mesh).
#    (Baking can also be attempted from this script — see BAKE at the bottom — but the UI
#    button is the reliable path. Start at RES_MAX=128 to iterate fast; raise to 256 for the
#    final once you like the motion.)
# 3. Render → Render Animation. Frames land as RGBA PNGs in ./render/paint_####.png.
# 4. Package to a web alpha clip (needs ffmpeg):
#       ffmpeg -y -framerate 24 -i render/paint_%04d.png \
#         -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 -an \
#         web/public/assets/paint-pour.webm
# 5. Watch the clip, find the frame where paint FULLY covers the screen, divide by FPS, and
#    set VIDEO.coverAt (seconds) in web/public/app/paint.js. Done — it auto-activates.
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
FRAME_START, FRAME_END = 1, 120  # ~5 s: pour → cover → drain
RES_MAX = 128                    # raise to 256 for the final render
VISCOSITY = 0.08                 # paint-like; try 0.04 (runnier) .. 0.2 (thicker)
POUR_FRAMES = 26                 # frames the bucket pours for
POUR_SPEED = 3.0                 # initial downward speed of the poured paint
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

    # ── Domain: a tall, thin box. Paint lives inside; gravity (-Z) pulls it down. ──
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
    inflow.scale = (1.25, 0.18, 0.10)
    inflow.location = (0, 0.06, 1.05)            # top, in front of the wall
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

    # ── Camera: orthographic, straight on the wall, framed to the render aspect. ──
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 5.0                   # zoom: smaller = tighter on the paint
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
