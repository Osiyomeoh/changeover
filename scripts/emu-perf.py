#!/usr/bin/env python3
"""
Render budget in the emulator: draw calls and triangles from the runtime renderer
at the heaviest moments of a night and of the dawn reveal. Emulated Meta VR Glasses,
emulated tracked hands, inside the XR session. Reads `scene render-stats`
(the runtime renderer's own counters: calls, triangles, programs) at each moment.
This measures what is drawn, not frame rate: no headset was used.

Eyes: the emulator's desktop WebGL has no multiview, so in XR three.js draws every
object once per eye and the counters cover both passes. IWSDK asks for multiview
stereo, which on a headset that supports it draws both eyes in one pass. The budget
is therefore checked per eye pass (the counter / 2 when the browser lacks multiview);
both numbers are printed.
Usage: python3 scripts/emu-perf.py [--shots DIR]   (run from the project root)
Exit 0 only if every moment is within budget per eye pass (<= 100 draw calls, <= 150,000 triangles).
"""
import json
import os
import subprocess
import sys
import time

from emu_lib import CLI, enter_xr, find_one, hand, navigate, settle, values, wait_for

MAX_CALLS, MAX_TRIS = 100, 150_000
TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None


def home(tid):
    i = TOKENS.index(tid)  # layout trayPos
    return ((i % 4 - 1.5) * 0.1, TOP_Y + 0.03, -0.21 - 0.1 * (i // 4))


def slot(i):
    return ((i - 1.5) * 0.1, TOP_Y + 0.04, -0.41)  # layout slotX, SLOT_Z


def status():
    return values(find_one("PlayStatus"), "PlayStatus")


def place(tid, s):
    hand("right", home(tid)); settle(0.15)
    hand("right", home(tid), pinch=1); settle(0.3)
    hand("right", slot(s), pinch=1); settle(0.3)
    hand("right", slot(s), pinch=0); settle(0.3)


def measure(name):
    """The runtime renderer's counters for the current frame (and a screenshot with --shots)."""
    if SHOTS:
        subprocess.run([CLI, "browser", "screenshot", "--input-json", "{}", "--output-file",
                        os.path.join(SHOTS, f"perf-{name}.png")], capture_output=True, text=True, timeout=60)
    out = subprocess.run([CLI, "scene", "render-stats", "--input-json", "{}"],
                         capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout)["data"]["result"]


def browser_has_multiview():
    out = subprocess.run([CLI, "browser", "run", "scripts/webgl-multiview.mjs"], capture_output=True, text=True, timeout=60)
    return bool(json.loads(out.stdout)["data"]["result"]["multiview"])


def pick(rs, *keys):
    for k in keys:
        if k in rs:
            return rs[k]
    for v in rs.values():  # nested, e.g. {"render": {"calls": ..}}
        if isinstance(v, dict):
            got = pick(v, *keys)
            if got is not None:
                return got
    return None


def main():
    rows = []
    passes = 1 if browser_has_multiview() else 2
    print(f"info  browser WebGL multiview: {'yes' if passes == 1 else 'no'} -> {passes} eye pass(es) per XR frame", flush=True)

    def row(name, note):
        rs = measure(name)
        calls = pick(rs, "drawCalls", "calls")
        tris = pick(rs, "triangles")
        eye_calls = calls / passes if calls is not None else None
        eye_tris = tris / passes if tris is not None else None
        ok = calls is not None and tris is not None and eye_calls <= MAX_CALLS and eye_tris <= MAX_TRIS
        rows.append((name, eye_calls, eye_tris, ok, note))
        print(f"{'PASS' if ok else 'FAIL'}  {name:<12} per eye pass: {eye_calls:>5.0f} draw calls {eye_tris:>7.0f} triangles"
              f"  | XR frame as counted: {calls!s:>4} calls {tris!s:>6} tris  programs {rs.get('programs')!s:>3}  {note}", flush=True)
        if calls is None or tris is None:
            print("  renderStats:", json.dumps(rs)[:600])

    navigate("?night=1&speed=600&fresh", clear=True)
    wait_for("PlayStatus")
    settle(1.0)
    rs = measure("outside-xr")
    print(f"info  outside XR (one view)     draw calls {rs.get('calls')!s:>4}  triangles {rs.get('triangles')!s:>7}", flush=True)
    enter_xr()
    settle(1.0)
    row("night-start", "tray full, panel, flat diorama, street")
    for i, tid in enumerate(["fridge", "fan", "tv", "laptop"]):
        place(tid, i)
    settle(0.5)
    s = status()
    row("four-on", f"4 appliances on circuits ({s['on']})")
    t0 = time.time()
    while status()["outcome"] == "playing" and time.time() - t0 < 120:
        time.sleep(0.5)
    s = status()
    if s["outcome"] != "won":
        print(f"FAIL  night ended {s['outcome']!r}, not won; cannot measure the reveal"); sys.exit(1)
    t0 = time.time()
    while status()["reveal"] < 0.5 and time.time() - t0 < 15:
        time.sleep(0.2)
    row("reveal-mid", f"room growing (reveal {status()['reveal']:.2f}); flat and room both drawn")
    settle(9.0)
    row("reveal-end", f"room full, sun up (reveal {status()['reveal']:.2f})")

    print(f"\nbudget per eye pass: <= {MAX_CALLS} draw calls, <= {MAX_TRIS:,} triangles")
    print(f"max per eye pass: {max(r[1] or 0 for r in rows):.0f} draw calls, {max(r[2] or 0 for r in rows):,.0f} triangles")
    sys.exit(0 if all(r[3] for r in rows) else 1)


if __name__ == "__main__":
    main()
