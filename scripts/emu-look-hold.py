#!/usr/bin/env python3
"""
Look-to-hold in the emulator: the eyes hold the isolator, a hand throws the lever.

Needs a device with a gaze source: "metaVRGlasses" or "metaQuestPro"
(iwsdk.config.json dev.emulator.device). The page runs the IWER 2.5.0 bundled in
@iwsdk/vite-plugin-dev 1.0.1; `xr look-at --device gaze` aims the emulated eyes.
That shows what the emulator does, not what real eye tracking does.

Reads the live InterlockStatus and PlayStatus components from the running app.
Usage (dev server up: `npx @iwsdk/cli dev up --ai-mode agent --headless`):
    python3 scripts/emu-look-hold.py [--runs N]      (run from the project root)
Exit code 0 only if every scenario passes on every run.
"""
import json
import sys

from emu_lib import PARK, cli, find_one, fresh_session, hand, navigate, settle, values

BOARD = (0.0, 0.89, -0.52)  # src/layout.ts BOARD
ISO = (BOARD[0] - 0.08, BOARD[1], BOARD[2] + 0.05)  # ISOLATOR_X, PROXY_Z
LEVER_OFF = (BOARD[0] + 0.08, BOARD[1] - 0.05, BOARD[2] + 0.05)  # LEVER_X, LEVER_Y0, PROXY_Z
SPAN = 0.14  # LEVER_SPAN
TRAY = (0.0, 0.75, -0.25)


def status():
    return values(find_one("InterlockStatus"), "InterlockStatus")


def caption():
    return values(find_one("PlayStatus"), "PlayStatus")["caption"]


def lever_grabbed():
    r = cli("ecs", "find", {"withComponents": ["InterlockStatus", "Grabbed"]})
    return len(r["entities"]) > 0


def look(p, dwell=0.6):
    cli("xr", "look-at", {"device": "gaze", "target": dict(zip("xyz", p))})
    settle(dwell)  # > LookHold acquireS 0.25 s plus a CLI round trip


def seated():
    cli("xr", "set-transform", {"device": "headset", "position": {"x": 0, "y": 1.25, "z": 0},
                                "orientation": {"pitch": -35, "yaw": 0, "roll": 0}})
    cli("xr", "set-connected", {"device": "gaze", "connected": True})
    settle(0.3)


def grab_lever(side="right"):
    hand(side, LEVER_OFF, pinch=0); settle(0.15)
    hand(side, LEVER_OFF, pinch=1); settle(0.25)


def drag_lever(to_travel, side="right", steps=6):
    x, y0, z = LEVER_OFF
    for i in range(1, steps + 1):
        hand(side, (x, y0 + SPAN * to_travel * i / steps, z))
        settle(0.12)


def let_go(side="right"):
    hand(side, PARK[side], pinch=0); settle(0.3)


def sc_one_hand_latches():
    cli("xr", "set-connected", {"device": "hand-left", "connected": False}); settle(0.3)
    look(ISO)
    armed = status()
    grab_lever()
    drag_lever(0.6)
    mid = status()
    drag_lever(1.05)
    s = status()
    settle(0.3)
    cap = caption()
    ok = (armed["phase"] == "arming" and armed["eyesHolding"] and armed["isolatorHolder"] == "eyes"
          and mid["phase"] == "throwing" and mid["isolatorHolder"] == "eyes" and not mid["leftTracked"]
          and s["energised"] and s["phase"] == "latched" and not s["leftTracked"]
          and cap.startswith("Changeover latched"))
    return ok, {"armed": armed, "mid": mid, "top": s, "caption": cap}


def throw_then_look_away():
    look(ISO)
    grab_lever()
    drag_lever(0.6)
    mid = status()
    look(LEVER_OFF, dwell=0.5)
    return mid, status()


def sc_look_away_springs_back():
    mid, s = throw_then_look_away()
    settle(0.2)
    cap = caption()
    ok = (mid["phase"] == "throwing" and mid["isolatorHolder"] == "eyes"
          and not s["energised"] and s["travel"] == 0 and s["lastReset"] == "looked-away"
          and not lever_grabbed() and cap.startswith("You looked away"))
    return ok, {"mid": mid, "after": s, "caption": cap}


def sc_two_look_aways_two_resets():
    before = status()["resets"]
    _, first = throw_then_look_away()
    let_go()
    mid2, second = throw_then_look_away()
    settle(0.2)
    cap = caption()
    ok = (first["lastReset"] == "looked-away" and second["lastReset"] == "looked-away"
          and mid2["phase"] == "throwing"
          and second["resets"] - before == 2 and second["travel"] == 0 and not second["energised"]
          and not lever_grabbed() and cap.startswith("You looked away"))
    return ok, {"before": before, "first": first, "second": second, "caption": cap}


def sc_eye_tracking_lost():
    look(ISO)
    grab_lever()
    drag_lever(0.6)
    mid = status()
    cli("xr", "set-connected", {"device": "gaze", "connected": False}); settle(0.4)
    s = status()
    cli("xr", "set-connected", {"device": "gaze", "connected": True})
    ok = (mid["phase"] == "throwing" and mid["isolatorHolder"] == "eyes"
          and not s["eyesTracked"] and not s["energised"] and s["travel"] == 0
          and s["lastReset"] == "tracking-lost")
    return ok, {"mid": mid, "after": s}


def sc_gaze_never_acts_alone():
    look(ISO, dwell=1.5)
    hand("right", PARK["right"], pinch=1); settle(0.5)  # a pinch in the air, nowhere near the lever
    s = status()
    hand("right", PARK["right"], pinch=0)
    ok = s["eyesHolding"] and s["phase"] == "arming" and not s["energised"] and s["travel"] == 0
    return ok, {"final": s}


def sc_two_hands_still_work():
    look(TRAY)
    hand("left", ISO, pinch=1); settle()
    grab_lever()
    drag_lever(1.05)
    s = status()
    ok = s["energised"] and s["phase"] == "latched" and s["isolatorHolder"] == "left" and not s["eyesHolding"]
    return ok, {"top": s}


def sc_hand_wins_glance_is_free():
    look(ISO)
    hand("left", ISO, pinch=1); settle()
    grab_lever()
    drag_lever(0.6)
    mid = status()
    look(LEVER_OFF, dwell=0.5)  # the eyes leave the isolator; the left hand still holds it
    mid2 = status()
    drag_lever(1.05)
    s = status()
    ok = (mid["phase"] == "throwing" and mid["isolatorHolder"] == "left"
          and mid2["phase"] == "throwing" and not mid2["eyesHolding"] and mid2["resets"] == mid["resets"]
          and s["energised"] and s["phase"] == "latched")
    return ok, {"mid": mid, "eyesAway": mid2, "top": s}


SCENARIOS = [
    ("one hand: eyes hold the isolator, the right hand throws, latches", sc_one_hand_latches),
    ("look away mid-throw: lever springs back, looked-away, explained", sc_look_away_springs_back),
    ("two look-aways in a row: two resets, both explained", sc_two_look_aways_two_resets),
    ("eye tracking lost mid-throw: springs back, tracking-lost", sc_eye_tracking_lost),
    ("gaze never acts alone: eyes on the isolator, no hand on the lever", sc_gaze_never_acts_alone),
    ("two hands still work with the eyes elsewhere", sc_two_hands_still_work),
    ("a hand on the isolator wins: a glance away mid-throw is free", sc_hand_wins_glance_is_free),
]


def main():
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 1
    dev = cli("xr", "get-device-state", {})
    if not dev.get("gaze", {}).get("connected", False):
        sys.exit("No gaze source: set dev.emulator.device to metaVRGlasses or metaQuestPro in iwsdk.config.json.")
    # The Daily Outage always has the generator; ?fresh makes every reload start clean.
    navigate("?daily&fresh")
    fresh_session("InterlockStatus")
    st = cli("xr", "status", {}) or {}
    print(f"page: ?daily&fresh  device: {st.get('deviceName')}  features: {st.get('enabledFeatures')}", flush=True)
    tally = {name: 0 for name, _ in SCENARIOS}
    failures = []
    for r in range(runs):
        for name, fn in SCENARIOS:
            fresh_session("InterlockStatus")
            seated()
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
        print(f"\nFAIL run {r + 1}: {name}\n  {json.dumps(ev)[:1200]}")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
