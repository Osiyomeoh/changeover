#!/usr/bin/env python3
"""
Look-and-pinch scenarios in the emulator, on a device with a gaze source:
"metaVRGlasses" or "metaQuestPro" (iwsdk.config.json dev.emulator.device). The
page runs the IWER 2.5.0 bundled in @iwsdk/vite-plugin-dev 1.0.1, whose Meta VR
Glasses profile adds "gaze-tracking" and "eye-tracking" to the Quest 3 profile.
That says what the emulator offers, not what the real glasses do.

Both hand rays are pointed up and away, so only gaze can reach the table; each
selection must also report pointer source 'gaze' (PlayStatus.lastLookSource).
Usage: python3 scripts/emu-look.py [--runs N]   (run from the project root)

--ray: the fallback on a device without eye tracking ("metaQuest3", the one
profile here with hands and no gaze): the right hand's ray does the looking,
held above the target and aimed at it; selections must report source 'ray'.
Exit 0 only if every scenario passes on every run.
"""
import json
import sys

from emu_lib import cli, find_one, fresh_session, navigate, settle, values

TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
CORD = (-0.30, TOP_Y + 0.07, -0.38)  # layout CORD_POS


def home(tid):
    i = TOKENS.index(tid)  # layout trayPos
    return ((i % 4 - 1.5) * 0.1, TOP_Y + 0.03, -0.21 - 0.1 * (i // 4))


def plugged(i):
    return ((i - 1.5) * 0.1, TOP_Y + 0.036, -0.41)  # layout slotX, SLOT_Z


def status():
    return values(find_one("PlayStatus"), "PlayStatus")


def seated_eyes_only():
    """Design head pose; both hand rays aimed at the ceiling."""
    cli("xr", "set-transform", {"device": "headset", "position": {"x": 0, "y": 1.25, "z": 0},
                                "orientation": {"pitch": -35, "yaw": 0, "roll": 0}})
    for side in ("left", "right"):
        cli("xr", "set-transform", {"device": f"hand-{side}", "orientation": {"pitch": 70, "yaw": 0, "roll": 0}})
    settle(0.4)


def look(p, dwell=0.5):
    cli("xr", "look-at", {"device": "gaze", "target": dict(zip("xyz", p))})
    settle(dwell)  # > IWSDK dwellWindowSeconds default 0.15 plus the 1€ filter


def pinch(side="right"):
    cli("xr", "set-select-value", {"device": f"hand-{side}", "value": 1}); settle(0.3)
    cli("xr", "set-select-value", {"device": f"hand-{side}", "value": 0}); settle(0.4)


def hovered():
    r = cli("ecs", "find", {"withComponents": ["GazeTarget", "Hovered"]})
    out = []
    for e in r["entities"]:
        v = values(e["entityIndex"], "GazeTarget")
        out.append("cord" if v["kind"] == "cord" else TOKENS[v["index"]])
    return sorted(out)


def grabbed():
    return cli("ecs", "find", {"withComponents": ["Grabbed"]})["entities"]


def sc_each_target_hovers_itself():
    wrong = {}
    for tid in TOKENS:
        look(home(tid))
        got = hovered()
        if got != [tid]:
            wrong[tid] = got
    look(CORD)
    if hovered() != ["cord"]:
        wrong["cord"] = hovered()
    return not wrong, {"wrong": wrong}


def sc_look_pinch_plugs_fridge():
    look(home("fridge")); pinch()
    s = status()
    ok = (s["started"] and s["on"] == "fridge" and s["lookSelects"] == 1
          and s["lastLookSource"] == "gaze" and not grabbed())
    return ok, s


def sc_left_hand_commits_too():
    look(home("fan")); pinch("left")
    s = status()
    return (s["on"] == "fan" and s["lastLookSource"] == "gaze"), s


def sc_look_pinch_unplugs():
    look(home("fridge")); pinch()
    look(plugged(0)); pinch()  # the fridge now sits on circuit 1
    s = status()
    return (s["on"] == "" and s["lookSelects"] == 2 and s["caption"] == "Fridge off."), s


def sc_look_away_does_nothing():
    look((0.0, 2.2, -1.5)); pinch()  # above the board, nothing there
    s = status()
    return (s["lookSelects"] == 0 and s["on"] == "" and not s["started"]), s


def sc_cord_refused_without_changeover():
    look(home("fridge")); pinch()
    look(CORD); pinch()
    s = status()
    return (s["backfeedRefusals"] == 1 and s["source"] == "battery" and "backfeed" in s["caption"]), s


def sc_full_board_says_so():
    for tid in ("fridge", "fan", "tv", "laptop"):  # 242 + 65 + 120 + 50 W average, under the limit
        look(home(tid)); pinch()
    look(home("pump")); pinch()
    s = status()
    ok = (s["on"] == "fridge,fan,tv,laptop" and s["trips"] == 0
          and s["caption"].startswith("All 4 circuits are in use"))
    return ok, s


def sc_iron_overload_by_look():
    look(home("fridge")); pinch()
    look(home("iron")); pinch()
    s = status()
    return (s["trips"] == 1 and s["on"] == "" and "2,042 W > 1,500 W" in s["caption"]), s


def aim(p, dwell=0.4):
    """Right hand 25 cm above the target, slightly toward the player, ray aimed at it."""
    cli("xr", "set-transform", {"device": "hand-right", "position": {"x": p[0], "y": p[1] + 0.25, "z": p[2] + 0.1}})
    cli("xr", "look-at", {"device": "hand-right", "target": dict(zip("xyz", p))})
    settle(dwell)


def park_right():
    cli("xr", "set-transform", {"device": "hand-right", "position": {"x": 0.3, "y": 0.8, "z": -0.2},
                                "orientation": {"pitch": 70, "yaw": 0, "roll": 0}})
    settle(0.3)


def sc_ray_each_target_hovers_itself():
    wrong = {}
    for tid in TOKENS:
        aim(home(tid))
        got = hovered()
        if got != [tid]:
            wrong[tid] = got
    aim(CORD)
    if hovered() != ["cord"]:
        wrong["cord"] = hovered()
    return not wrong, {"wrong": wrong}


def sc_ray_pinch_plugs_and_unplugs():
    aim(home("fridge")); pinch(); park_right()
    s1 = status()
    aim(plugged(0)); pinch(); park_right()
    s2 = status()
    ok = (s1["on"] == "fridge" and s1["lastLookSource"] == "ray" and not grabbed()
          and s2["on"] == "" and s2["lookSelects"] == 2)
    return ok, {"after_plug": s1, "after_unplug": s2}


def sc_ray_release_off_target_then_three_in_a_row():
    """A pinch released with the ray already off its target, then three more ray pinches.

    Every ray select moves its target out from under the ray. IWSDK 1.0.1 drops a release
    that lands on nothing, which used to swallow the next pinch (0/20 on Nov 15 before the
    fix). Here the first release is made with the hand already parked, aimed at the ceiling.
    """
    on = lambda s: set(filter(None, s["on"].split(",")))  # noqa: E731
    aim(home("fan"))
    cli("xr", "set-select-value", {"device": "hand-right", "value": 1}); settle(0.3)
    park_right()  # still pinching, ray now off the table
    cli("xr", "set-select-value", {"device": "hand-right", "value": 0}); settle(0.4)
    s1 = status()
    aim(home("fridge")); pinch(); park_right()
    s2 = status()
    aim(plugged(0)); pinch(); park_right()  # the fan, in the first free circuit
    s3 = status()
    aim(plugged(1)); pinch(); park_right()  # the fridge
    s4 = status()
    ok = (on(s1) == {"fan"} and s1["lookSelects"] == 1
          and on(s2) == {"fan", "fridge"} and s2["lookSelects"] == 2
          and on(s3) == {"fridge"} and s3["lookSelects"] == 3
          and on(s4) == set() and s4["lookSelects"] == 4
          and s4["lastLookSource"] == "ray" and not grabbed())
    return ok, {"s1": s1, "s2": s2, "s3": s3, "s4": s4}


RAY_SCENARIOS = [
    ("hand ray: each of 8 tokens and the cord hovers only itself", sc_ray_each_target_hovers_itself),
    ("hand ray + pinch plugs then unplugs the fridge (source ray)", sc_ray_pinch_plugs_and_unplugs),
    ("hand ray: a release off target, then 3 pinches in a row, all 4 count", sc_ray_release_off_target_then_three_in_a_row),
]

SCENARIOS = [
    ("each of 8 tokens and the cord: gaze hovers only itself", sc_each_target_hovers_itself),
    ("look + pinch plugs the fridge (source gaze, nothing grabbed)", sc_look_pinch_plugs_fridge),
    ("left-hand pinch commits a gaze selection too", sc_left_hand_commits_too),
    ("look + pinch on a plugged token unplugs it", sc_look_pinch_unplugs),
    ("pinch while looking at nothing does nothing", sc_look_away_does_nothing),
    ("look + pinch on the cord: refused, backfeed", sc_cord_refused_without_changeover),
    ("fifth appliance with all 4 circuits full is refused with a reason", sc_full_board_says_so),
    ("look + pinch iron after fridge overloads and trips", sc_iron_overload_by_look),
]


def main():
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 1
    ray = "--ray" in sys.argv
    dev = cli("xr", "get-device-state", {})
    has_gaze = dev.get("gaze", {}).get("connected", False)
    if not ray and not has_gaze:
        sys.exit("No gaze source: set dev.emulator.device to metaVRGlasses or metaQuestPro in iwsdk.config.json.")
    if ray and has_gaze:
        sys.exit("--ray tests the no-eye-tracking fallback: set dev.emulator.device to metaQuest3 (no gaze).")
    scenarios = RAY_SCENARIOS if ray else SCENARIOS
    # The Daily Outage always has the generator; ?fresh makes every reload start clean.
    navigate("?daily&fresh")
    tally = {name: 0 for name, _ in scenarios}
    failures = []
    for r in range(runs):
        for name, fn in scenarios:
            fresh_session("PlayStatus")
            seated_eyes_only()
            try:
                ok, ev = fn()
            except Exception as e:  # noqa: BLE001
                ok, ev = False, {"error": str(e)}
            tally[name] += ok
            if not ok:
                failures.append((r, name, ev))
            print(f"run {r + 1}/{runs}  {'PASS' if ok else 'FAIL'}  {name}", flush=True)
    print("\nSUMMARY")
    for name, n in tally.items():
        print(f"  {n}/{runs}  {name}")
    for r, name, ev in failures[:6]:
        print(f"\nFAIL run {r + 1}: {name}\n  {json.dumps(ev)[:900]}")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
