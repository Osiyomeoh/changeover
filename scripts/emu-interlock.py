#!/usr/bin/env python3
"""
Emulator kill test for the two-hand changeover interlock.

Drives IWER (IWSDK's browser XR emulator) with *emulated tracked hands* through
the IWSDK CLI, and reads the live InterlockStatus component from the running
app. No controllers are used at any point.

Usage (dev server must be up: `npx @iwsdk/cli dev up --ai-mode agent --headless`):
    python3 scripts/emu-interlock.py [--runs N]
Exit code 0 only if every scenario passes on every run.
"""
import json
import subprocess
import sys
import time

CLI = "./node_modules/.bin/iwsdk"
BOARD = (0.0, 0.89, -0.52)  # src/layout.ts BOARD
ISO = (BOARD[0] - 0.08, BOARD[1], BOARD[2] + 0.05)
LEVER_OFF = (BOARD[0] + 0.08, BOARD[1] - 0.05, BOARD[2] + 0.05)  # layout LEVER_Y0, PROXY_Z
SPAN = 0.14


def cli(domain, action, payload=None):
    out = subprocess.run(
        [CLI, domain, action, "--input-json", json.dumps(payload or {})],
        capture_output=True, text=True, timeout=60,
    )
    try:
        d = json.loads(out.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"{domain} {action}: non-JSON output: {out.stdout[:300]} {out.stderr[:300]}")
    if not d.get("ok"):
        raise RuntimeError(f"{domain} {action} failed: {json.dumps(d)[:500]}")
    return d["data"].get("result")


def find_lever():
    r = cli("ecs", "find", {"withComponents": ["InterlockStatus"]})
    return r["entities"][0]["entityIndex"]


def status(idx):
    r = cli("ecs", "query", {"entityIndex": idx})
    for c in r["components"]:
        if c["componentId"] == "InterlockStatus":
            return c["values"]
    raise RuntimeError("InterlockStatus missing")


def hand(side, pos, pinch=None):
    cli("xr", "set-transform", {"device": f"hand-{side}", "position": dict(zip("xyz", pos))})
    if pinch is not None:
        cli("xr", "set-select-value", {"device": f"hand-{side}", "value": pinch})


def settle(s=0.25):
    time.sleep(s)


def fresh_session():
    """Reload the app (resets the model) and enter XR with hands, seated."""
    cli("browser", "reload", {})
    for _ in range(60):
        try:
            find_lever()
            break
        except Exception:
            time.sleep(0.5)
    cli("xr", "enter", {})
    cli("xr", "set-input-mode", {"mode": "hand"})
    for side in ("left", "right"):
        cli("xr", "set-connected", {"device": f"hand-{side}", "connected": True})
        cli("xr", "set-select-value", {"device": f"hand-{side}", "value": 0})
    cli("xr", "set-transform", {"device": "headset", "position": {"x": 0, "y": 1.25, "z": 0},
                                "orientation": {"pitch": -15, "yaw": 0, "roll": 0}})
    # Park hands away from the board.
    hand("left", (-0.3, 0.8, -0.2))
    hand("right", (0.3, 0.8, -0.2))
    settle(0.5)
    return find_lever()


def drag_lever(side, to_travel, steps=6):
    x, y0, z = LEVER_OFF
    for i in range(1, steps + 1):
        hand(side, (x, y0 + SPAN * to_travel * i / steps, z))
        settle(0.12)


def scenario_happy(idx):
    hand("left", ISO, pinch=1); settle()
    hand("right", LEVER_OFF, pinch=1); settle()
    drag_lever("right", 1.05)
    s = status(idx)
    hand("right", (0.3, 0.8, -0.2), pinch=0); hand("left", (-0.3, 0.8, -0.2), pinch=0); settle()
    after = status(idx)
    ok = s["energised"] and s["phase"] == "latched" and after["energised"]
    return ok, {"atTop": s, "afterRelease": after}


def scenario_tracking_loss(idx):
    hand("left", ISO, pinch=1); settle()
    hand("right", LEVER_OFF, pinch=1); settle()
    drag_lever("right", 0.6)
    mid = status(idx)
    cli("xr", "set-connected", {"device": "hand-right", "connected": False}); settle(0.5)
    s = status(idx)
    ok = mid["phase"] == "throwing" and not s["energised"] and s["travel"] == 0 and s["lastReset"] == "tracking-lost"
    return ok, {"midThrow": mid, "afterLoss": s}


def scenario_not_isolated(idx):
    hand("right", LEVER_OFF, pinch=1); settle()
    drag_lever("right", 1.05)
    s = status(idx)
    ok = not s["energised"] and s["travel"] <= 0.1001 and s["lastReset"] == "not-isolated"
    return ok, {"final": s}


def scenario_isolator_released(idx):
    hand("left", ISO, pinch=1); settle()
    hand("right", LEVER_OFF, pinch=1); settle()
    drag_lever("right", 0.6)
    mid = status(idx)
    hand("left", ISO, pinch=0); settle(0.4)
    s = status(idx)
    ok = mid["phase"] == "throwing" and not s["energised"] and s["travel"] == 0 and s["lastReset"] == "isolator-released"
    return ok, {"midThrow": mid, "afterRelease": s}


SCENARIOS = [
    ("happy: isolate + throw latches ON", scenario_happy),
    ("tracking lost mid-throw springs back", scenario_tracking_loss),
    ("throw without isolating is refused", scenario_not_isolated),
    ("isolator released mid-throw springs back", scenario_isolator_released),
]


def main():
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 1
    tally = {name: 0 for name, _ in SCENARIOS}
    failures = []
    for r in range(runs):
        for name, fn in SCENARIOS:
            idx = fresh_session()
            try:
                ok, ev = fn(idx)
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
