#!/usr/bin/env python3
"""
Stills for the submission, from the running game in the emulator (emulated Meta VR
Glasses, tracked hands, emulated eye gaze), inside the XR session:
  still-eyes-hold-isolator.png   today's Daily Outage (it always has the generator): the eyes hold
                                 the isolator (it glows), a hand mid-throw
  still-changeover-latched.png   the same throw, latched
  still-dawn-growing.png         Night 1 won with the fridge and fan on: the room growing
  still-dawn-room.png            the finished room, looking ahead from the seat
Full-resolution screenshots of the app frame in the emulator, not a headset.
Usage: python3 scripts/emu-stills.py DIR   (run from the project root)
"""
import json
import os
import shutil
import subprocess
import sys
import time

from emu_lib import CLI, cli, enter_xr, find_one, hand, navigate, settle, values, wait_for

OUT = sys.argv[1]
TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
BOARD = (0.0, 0.89, -0.52)  # src/layout.ts BOARD
ISO = (BOARD[0] - 0.08, BOARD[1], BOARD[2] + 0.05)  # ISOLATOR_X, PROXY_Z
LEVER_OFF = (BOARD[0] + 0.08, BOARD[1] - 0.05, BOARD[2] + 0.05)  # LEVER_X, LEVER_Y0, PROXY_Z
SPAN = 0.14  # LEVER_SPAN


def home(tid):
    i = TOKENS.index(tid)  # layout trayPos
    return ((i % 4 - 1.5) * 0.1, TOP_Y + 0.03, -0.21 - 0.1 * (i // 4))


def slot(i):
    return ((i - 1.5) * 0.1, TOP_Y + 0.04, -0.41)  # layout slotX, SLOT_Z


def place(tid, s):
    hand("right", home(tid)); settle(0.15)
    hand("right", home(tid), pinch=1); settle(0.3)
    hand("right", slot(s), pinch=1); settle(0.3)
    hand("right", slot(s), pinch=0); settle(0.3)


def head(pitch, yaw=0):
    cli("xr", "set-transform", {"device": "headset", "position": {"x": 0, "y": 1.25, "z": 0},
                                "orientation": {"pitch": pitch, "yaw": yaw, "roll": 0}})
    settle(0.3)


def shot(name):
    """Full-resolution PNG of the app frame (scripts/frame-shot.mjs), moved to OUT/name."""
    out = subprocess.run([CLI, "browser", "run", "scripts/frame-shot.mjs"], capture_output=True, text=True, timeout=60)
    src = json.loads(out.stdout)["data"]["result"]["out"]
    path = os.path.join(OUT, name)
    shutil.move(src, path)
    print("saved", path, flush=True)


def play():
    return values(find_one("PlayStatus"), "PlayStatus")


def interlock():
    return values(find_one("InterlockStatus"), "InterlockStatus")


def main():
    os.makedirs(OUT, exist_ok=True)

    navigate("?daily&fresh", clear=True)  # ?night=3 needs Nights 1-2 won; the Daily always has the generator
    wait_for("InterlockStatus")
    enter_xr()
    cli("xr", "set-connected", {"device": "gaze", "connected": True})
    head(-30)
    place("fridge", 0)
    place("fan", 1)
    cli("xr", "set-connected", {"device": "hand-left", "connected": False}); settle(0.3)
    cli("xr", "look-at", {"device": "gaze", "target": dict(zip("xyz", ISO))}); settle(0.6)
    x, y0, z = LEVER_OFF
    hand("right", LEVER_OFF, pinch=0); settle(0.15)
    hand("right", LEVER_OFF, pinch=1); settle(0.25)
    for i in range(1, 5):
        hand("right", (x, y0 + SPAN * 0.6 * i / 4, z)); settle(0.12)
    s = interlock()
    print(f"mid-throw: phase {s['phase']}, isolator held by {s['isolatorHolder']}", flush=True)
    shot("still-eyes-hold-isolator.png")
    for i in range(1, 5):
        hand("right", (x, y0 + SPAN * (0.6 + 0.45 * i / 4), z)); settle(0.12)
    settle(0.4)
    s = interlock()
    print(f"top: phase {s['phase']}, energised {s['energised']}", flush=True)
    shot("still-changeover-latched.png")

    navigate("?night=1&speed=600&fresh", clear=True)
    wait_for("PlayStatus")
    enter_xr()
    head(-30)
    place("fridge", 0)
    place("fan", 1)
    hand("right", (0.3, 0.8, -0.2))
    t0 = time.time()
    while play()["outcome"] == "playing" and time.time() - t0 < 120:
        time.sleep(0.5)
    if play()["outcome"] != "won":
        print("night not won; no dawn stills"); sys.exit(1)
    head(-12)
    t0 = time.time()
    while play()["reveal"] < 0.55 and time.time() - t0 < 15:
        time.sleep(0.2)
    shot("still-dawn-growing.png")
    settle(9.0)
    head(-8)
    print(f"reveal {play()['reveal']:.2f}, running at dawn: {play()['revealOn']}", flush=True)
    shot("still-dawn-room.png")


if __name__ == "__main__":
    main()
