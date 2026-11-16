#!/usr/bin/env python3
"""
Emulator scenarios for the dawn reveal (src/dawn.ts): a won night grows the flat
into the room around the player; what was on at dawn is what runs in it; NEXT
still works while the room grows; a lost night shows no room. Emulated tracked
hands; reads the live PlayStatus component.
Usage: python3 scripts/emu-dawn.py [--runs N] [--shots DIR] [--only TEXT]   (run from the project root)
--shots saves a runtime screenshot mid-growth and at the end of the first run.
Exit 0 only if every scenario passes on every run.
"""
import json
import subprocess
import sys
import time

from emu_lib import CLI, cli, enter_xr, find_one, hand, move, navigate, settle, values, wait_for, PARK

TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
NEXT = (0.30, TOP_Y + 0.04, -0.38)  # layout NEXT_POS
REVEAL_TOTAL_S = 1.2 + 6 / 2 + 7  # src/dawn.ts REVEAL_TOTAL_S
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None


def home(tid):
    i = TOKENS.index(tid)  # layout trayPos
    return ((i % 4 - 1.5) * 0.1, TOP_Y + 0.03, -0.21 - 0.1 * (i // 4))


def slot(i):
    return ((i - 1.5) * 0.1, TOP_Y + 0.04, -0.41)  # layout slotX, SLOT_Z


def status():
    return values(find_one("PlayStatus"), "PlayStatus")


def place(tid, s, side="right"):
    h = home(tid)
    hand(side, h); settle(0.15)
    hand(side, h, pinch=1); settle(0.25)
    move(side, h, slot(s))
    hand(side, slot(s), pinch=0); settle(0.4)
    hand(side, PARK[side]); settle(0.3)


def press_next():
    hand("right", NEXT); settle(0.15)
    hand("right", NEXT, pinch=1); settle(0.4)
    hand("right", NEXT, pinch=0); settle(0.2)
    hand("right", PARK["right"]); settle(0.4)


def open_at(query):
    navigate(query, clear=True)
    wait_for("PlayStatus")
    enter_xr()


def wait_outcome(timeout_s):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        s = status()
        if s["outcome"] != "playing":
            return s
        time.sleep(0.5)
    return status()


def shot(name):
    if not SHOTS:
        return None
    path = f"{SHOTS}/{name}.png"
    subprocess.run([CLI, "browser", "screenshot", "--input-json", "{}", "--output-file", path],
                   capture_output=True, text=True, timeout=60)
    return path


def watch_reveal(until, timeout_s, shots=False):
    """Sample `reveal` every ~0.4 s until `until(status)` or timeout; returns (samples, last status)."""
    seen, t0, mid_done = [], time.time(), not shots
    s = status()
    while time.time() - t0 < timeout_s:
        s = status()
        seen.append(round(s["reveal"], 3))
        if not mid_done and 0.45 <= s["reveal"] <= 0.75:
            shot("dawn-reveal-mid"); mid_done = True
        if until(s):
            break
        time.sleep(0.4)
    return seen, s


def monotonic(xs):
    return all(b >= a - 1e-6 for a, b in zip(xs, xs[1:]))


def sc_dawn_fridge_and_fan(first_run):
    # Night 1 at ?speed=600 (one game hour per 6 s), fridge and fan on all night.
    open_at("?night=1&speed=600&fresh")
    place("fridge", 0)
    place("fan", 1)
    end = wait_outcome(90)
    t_dawn = time.time()
    seen, grown = watch_reveal(lambda s: s["reveal"] >= 1, 15, shots=first_run)
    # Let the sunrise finish, then look at the room.
    settle(max(0.0, REVEAL_TOTAL_S + 0.5 - (time.time() - t_dawn)))
    final = status()
    if first_run:
        shot("dawn-reveal-end")
    press_next()
    s2 = status()
    ok = (end["outcome"] == "won" and end["on"] == "fridge,fan"
          # Gradual, not instant: at least two samples caught mid-growth. (A first-sample <= 0.25 check
          # was dropped on Nov 15: it measured how fast the CLI read status, not the game.)
          and sum(0 < x < 1 for x in seen) >= 2 and monotonic(seen) and grown["reveal"] == 1
          and final["reveal"] == 1 and final["revealOn"] == "fridge,fan"
          and final["nextLabel"] == "Next night" and "Night 1 won" in final["caption"]
          and s2["night"] == 2 and s2["reveal"] == -1 and s2["revealOn"] == "" and s2["outcome"] == "playing")
    return ok, {"samples": seen, "end": {k: end[k] for k in ("outcome", "on", "caption")},
                "final": {k: final[k] for k in ("reveal", "revealOn", "nextLabel")},
                "after_next": {k: s2[k] for k in ("night", "reveal", "revealOn", "outcome")}}


def sc_dawn_fan_off(_):
    # Only the fridge on: the room's fridge runs, its fan stays still.
    open_at("?night=1&speed=600&fresh")
    place("fridge", 0)
    end = wait_outcome(90)
    seen, final = watch_reveal(lambda s: s["reveal"] >= 1, 15)
    press_next()
    s2 = status()
    ok = (end["outcome"] == "won" and end["on"] == "fridge" and monotonic(seen)
          and final["reveal"] == 1 and final["revealOn"] == "fridge"
          and s2["night"] == 2 and s2["reveal"] == -1)
    return ok, {"samples": seen, "final": {k: final[k] for k in ("reveal", "revealOn")}, "after_next": s2["night"]}


def sc_next_mid_growth(_):
    # NEXT pinched while the room is still growing round the table: the room goes, Night 2 starts.
    open_at("?night=1&speed=600&fresh")
    place("fridge", 0)
    end = wait_outcome(90)
    seen, mid = watch_reveal(lambda s: 0.05 <= s["reveal"] <= 0.8, 10)
    press_next()
    s2 = status()
    settle(1.0)
    s3 = status()
    ok = (end["outcome"] == "won" and 0.05 <= mid["reveal"] <= 0.8
          and s2["night"] == 2 and s2["reveal"] == -1 and s2["outcome"] == "playing" and not s2["started"]
          and s3["reveal"] == -1)
    return ok, {"mid": mid["reveal"], "samples": seen, "end": {k: end[k] for k in ("outcome", "on")},
                "after_next": {k: s2[k] for k in ("night", "reveal", "outcome", "started")}}


def sc_loss_no_room(_):
    # Fan on, fridge never: the fridge spoils (about 6 s); no room grows, and RETRY restarts.
    open_at("?night=1&speed=600&fresh")
    place("fan", 0)
    end = wait_outcome(30)
    settle(3.0)
    later = status()
    press_next()
    s2 = status()
    ok = (end["outcome"] == "lost" and end["reveal"] == -1 and later["reveal"] == -1
          and later["revealOn"] == "" and s2["night"] == 1 and s2["reveal"] == -1)
    return ok, {"end": {k: end[k] for k in ("outcome", "reveal")}, "later": later["reveal"], "after_retry": s2["reveal"]}


SCENARIOS = [
    ("dawn grows the room (steadily, to full size); fridge and fan on at dawn run in it; NEXT then starts Night 2", sc_dawn_fridge_and_fan),
    ("fan off at dawn: the room shows the fridge running, not the fan", sc_dawn_fan_off),
    ("NEXT pinched while the room is still growing: the room goes, Night 2 starts", sc_next_mid_growth),
    ("a lost night grows no room; RETRY restarts it", sc_loss_no_room),
]


def main():
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 1
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else ""
    scenarios = [(n, f) for n, f in SCENARIOS if only in n]
    tally = {name: 0 for name, _ in scenarios}
    failures = []
    for r in range(runs):
        for name, fn in scenarios:
            try:
                ok, ev = fn(r == 0)
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
        print(f"\nFAIL run {r + 1}: {name}\n  {json.dumps(ev)[:1500]}")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
