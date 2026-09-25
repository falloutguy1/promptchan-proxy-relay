"""Afterfall: the Ursina front end."""
import argparse
import math
import sys
import time as _time   # Ursina adds time.dt


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Spectate an AI survivor in a post-apocalyptic world.")
    p.add_argument("--seed", type=int, default=None, help="world seed (random if omitted)")
    p.add_argument("--quality", choices=("low", "medium", "high"), default="high")
    p.add_argument("--speed", type=float, default=2.0, help="starting time speed (1-16)")
    p.add_argument("--zombies", type=int, default=28)
    p.add_argument("--size", default="1600x900", help="window size, e.g. 1920x1080")
    p.add_argument("--fullscreen", action="store_true")
    p.add_argument("--skip", type=float, default=0.0, help="fast-forward this many game hours before showing")
    p.add_argument("--screenshot", default=None, help=argparse.SUPPRESS)
    p.add_argument("--frames", type=int, default=90, help=argparse.SUPPRESS)
    p.add_argument("--camera", default="cine", help=argparse.SUPPRESS)
    p.add_argument("--offscreen", action="store_true", help=argparse.SUPPRESS)
    return p.parse_args(argv)


QUALITY = {"low": {"shadow": 1024, "msaa": 0}, "medium": {"shadow": 2048, "msaa": 2}, "high": {"shadow": 4096, "msaa": 4}}


def main(argv=None):
    args = parse_args(argv)
    q = QUALITY[args.quality]
    from panda3d.core import loadPrcFileData
    w, h = (int(v) for v in args.size.lower().split("x"))
    prc = f"framebuffer-multisample {1 if q['msaa'] else 0}\nmultisamples {q['msaa']}\nsync-video true\n"
    if args.offscreen:
        prc += "load-display p3headlessgl\naudio-library-name null\n"
    loadPrcFileData("", prc)

    from ursina import Entity, Ursina, application, camera, held_keys, mouse, scene, window
    from panda3d.core import AntialiasAttrib, Filename, Vec3, Vec4

    app = Ursina(title="Afterfall", development_mode=False, size=(w, h), borderless=False, fullscreen=args.fullscreen,
                 window_type="offscreen" if args.offscreen else "onscreen")
    window.color = (0, 0, 0, 1)
    if args.offscreen:
        # the headless test renderer can't run Panda's generated shaders; draw the interface fixed-function
        camera.ui_render.set_shader_off(100)
        # offscreen windows never send the resize event that sizes Ursina's UI lens
        camera.ui_lens.set_film_size(camera.ui_size * .5 * w / h, camera.ui_size * .5)
    if hasattr(window, "fps_counter"):
        window.fps_counter.enabled = not args.offscreen
    if hasattr(window, "exit_button"):
        window.exit_button.visible = False

    from .sim import Simulation
    from .render.audio import SoundBoard
    from .render.body import Body, heading_deg, survivor_look, zombie_look
    from .render.camera import Director
    from .render.environment import Environment
    from .render.hud import Hud
    from .render.shaders import world_shader
    from .render.world_view import WorldView

    print("Generating the world...", flush=True)
    sim = Simulation(seed=args.seed, zombies=args.zombies)
    for _ in range(int(args.skip * 60 / .1)):
        sim.step(.1)
    print(f"Seed {sim.seed}", flush=True)

    scene.set_shader(world_shader())
    for k, v in dict(u_light0=Vec4(0), u_light0_col=Vec3(0), u_light1=Vec4(0), u_light1_col=Vec3(0), u_gloss=0.0, u_emissive=0.0,
                     u_shadow_on=1.0, u_shadow_texel=1.0 / q["shadow"]).items():
        scene.set_shader_input(k, v)
    if q["msaa"]:
        scene.set_antialias(AntialiasAttrib.M_multisample)
    camera.clip_plane_near = .15
    camera.clip_plane_far = 2400
    view = WorldView(sim, scene)
    env = Environment(sim, scene, camera, q["shadow"])
    env.update(0, Vec3(sim.survivor.x, 0, sim.survivor.y))
    director = Director(camera, sim.world)
    if args.camera != "cine":
        director.set_mode(args.camera)
    hud = Hud(sim)
    sound = SoundBoard(app) if not args.offscreen else None

    state = {"speed": max(.5, min(16.0, args.speed)), "paused": False, "frames": 0, "last_speed": args.speed,
             "survivor": None, "body": None, "floaters_seen": len(sim.floaters), "sounds_seen": len(sim.sounds)}
    zombie_bodies = {}
    agents_root = scene.attach_new_node("agents")

    def survivor_body():
        s = sim.survivor
        if state["survivor"] is not s:
            if state["body"] is not None:
                state["body"].root.remove_node()
            b = Body(agents_root, {**survivor_look(s.name), "pack": survivor_look(s.name)["pack"]})
            b.add_items()
            state["body"], state["survivor"] = b, s
        return state["body"]

    for z in sim.zombies:
        zombie_bodies[z.id] = Body(agents_root, zombie_look(z.look))

    def on_hit(kind, x, y):
        if sound:
            sound.play(kind, (camera.world_position - Vec3(x, sim.world.ground_z(x, y), y)).length())

    def tick():
        dt = min(.1, getattr(_time, "dt", 0) or 1 / 60)
        sim_dt = 0.0 if state["paused"] else dt * state["speed"]
        steps = max(1, math.ceil(sim_dt / .1))
        for _ in range(steps if sim_dt > 0 else 0):
            sim.step(sim_dt / steps)
        s = sim.survivor
        pose_dt = min(sim_dt, .1)
        # survivor
        b = survivor_body()
        b.root.set_pos(s.x, sim.world.ground_z(s.x, s.y), s.y)
        heading = s.heading
        if s.anim == "sleep":
            heading = .7 if "roof" not in sim.home.built else 0.0
        b.root.set_h(heading_deg(heading))
        b.show_items(s.anim, s.inv["axe"] > 0, s.inv["rifle"] > 0)
        sound_hit = (lambda: on_hit("chop" if s.anim == "chop" else "hammer", s.x, s.y)) if s.anim in ("chop", "build") else None
        b.apply(b.pose(s.anim, pose_dt, s.speed, roll=.2, on_hit=sound_hit), pose_dt if pose_dt > 0 else 0, 5 if s.anim == "dead" else 12)
        # the infected
        cam = camera.world_position
        for z in sim.zombies:
            zb = zombie_bodies[z.id]
            dx, dz = z.x - cam.x, z.y - cam.z
            far = dx * dx + dz * dz > 230 ** 2
            if far or (not z.alive and z.dead_t > 60):
                zb.root.hide()
                continue
            zb.root.show()
            zb.root.set_pos(z.x, sim.world.ground_z(z.x, z.y) - (max(0, z.dead_t - 50) * .06 if not z.alive else 0), z.y)
            zb.root.set_h(heading_deg(z.heading))
            if dx * dx + dz * dz < 130 ** 2 or pose_dt == 0:
                zb.apply(zb.pose(z.anim if z.alive else "dead", pose_dt, z.speed, roll=z.roll), pose_dt, 5 if not z.alive else 10)
        focus = Vec3(director.target)
        values = env.update(dt if sim_dt == 0 else max(dt, sim_dt * .3), focus)
        night = values["night"]
        view.update(env.t, dt, night)
        l0, c0 = view.fire_light(env.t, night)
        l1, c1 = view.flood_light(night)
        scene.set_shader_input("u_light0", Vec4(*l0))
        scene.set_shader_input("u_light0_col", Vec3(*c0))
        scene.set_shader_input("u_light1", Vec4(*l1))
        scene.set_shader_input("u_light1_col", Vec3(*c1))
        for road in view.road_nodes:
            road.set_shader_input("u_gloss", sim.rain * .55)
        director.update(dt, s, sim.home)
        # floating text and sounds from the simulation
        for fx, fy, text, kind, _delay in sim.floaters[state["floaters_seen"]:]:
            hud.float_text(Vec3(fx, sim.world.ground_z(fx, fy) + 2.1, fy), text, kind)
        state["floaters_seen"] = len(sim.floaters)
        if len(sim.floaters) > 300:
            sim.floaters = sim.floaters[-50:]
            state["floaters_seen"] = len(sim.floaters)
        if sound:
            for kind, x, y in sim.sounds[state["sounds_seen"]:]:
                if state["speed"] <= 4 or kind == "shot":
                    on_hit(kind, x, y)
            fd = (camera.world_position - view.fire_pos).length()
            sound.ambient(.12 + .1 * sim.cloud + .15 * sim.rain, sim.rain * .3,
                          max(0.0, 1 - fd / 40) * .35 if ("fire" in sim.home.built and sim.home.fire_fuel > 0) else 0)
        state["sounds_seen"] = len(sim.sounds)
        hud.update(dt, director, state["speed"], state["paused"], Vec3(s.x, sim.world.ground_z(s.x, s.y) + 2.25, s.y))
        state["frames"] += 1
        if args.screenshot and state["frames"] == args.frames:
            # the window still holds the previous, fully composed frame (3D view plus interface)
            app.win.save_screenshot(Filename(args.screenshot))
            application.quit() if hasattr(application, "quit") else sys.exit(0)

    def input_handler(key):
        speeds = [.5, 1, 2, 4, 8, 16]
        if key in ("1", "2", "3", "4"):
            director.set_mode({"1": "cine", "2": "chase", "3": "orbit", "4": "map"}[key])
        elif key == "space":
            state["paused"] = not state["paused"]
        elif key in ("]", "+", "=", "page up"):
            state["speed"] = next((v for v in speeds if v > state["speed"]), 16)
        elif key in ("[", "-", "page down"):
            state["speed"] = next((v for v in reversed(speeds) if v < state["speed"]), .5)
        elif key == "h":
            hud.toggle()
        elif key == "scroll up":
            director.zoom(-.12)
        elif key == "scroll down":
            director.zoom(.12)
        elif key == "escape":
            application.quit() if hasattr(application, "quit") else sys.exit(0)

    class Driver(Entity):
        def update(self):
            if mouse.left or mouse.right:
                v = mouse.velocity
                if abs(v[0]) + abs(v[1]) > 1e-4:
                    director.drag(v[0], v[1])
            tick()

        def input(self, key):
            input_handler(key)

    Driver()
    app.run()


if __name__ == "__main__":
    main()
