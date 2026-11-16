#!/usr/bin/env python3
"""
Emulator scenarios for Nights 1–5, the end-of-night button and resume after a
reload. Emulated tracked hands only; reads the live PlayStatus component and the
page's localStorage (scripts/pw-open.mjs).
Usage: python3 scripts/emu-nights.py [--runs N]   (run from the project root)
Exit 0 only if every scenario passes on every run.
"""
import json
import sys
import time

from emu_lib import PARK, cli, enter_xr, find_one, hand, move, navigate, page_state, settle, values, wait_for

TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
NEXT = (0.30, TOP_Y + 0.04, -0.38)  # layout NEXT_POS
NIGHT2_BRIEF = "The flat will ask for things. Each one costs battery. Fridge first."  # src/model/campaign.ts


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


def wait_outcome(timeout_s):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        s = status()
        if s["outcome"] != "playing":
            return s
        time.sleep(1)
    return status()


def open_at(query):
    navigate(query, clear=True)
    wait_for("PlayStatus")
    enter_xr()


def sc_night1_dawn_then_next():
    # Night 1: 8 game hours; ?speed=600 is one game hour per 6 s.
    open_at("?night=1&speed=600&fresh")
    s0 = status()
    cord_y = cli("ecs", "query", {"entityIndex": find_one("GeneratorCord")})
    place("fridge", 0)
    end = wait_outcome(90)
    stored_after_win = page_state()
    press_next()
    s2 = status()
    url = page_state()["url"]
    ok = (s0["night"] == 1 and s0["mode"] == "night" and not s0["hasGenerator"]
          and end["outcome"] == "won" and end["nextLabel"] == "Next night"
          and "Night 1 won" in end["caption"]
          and end["progress"].split(",")[0] != "0"
          and stored_after_win["session"] in (None, "null")
          and s2["night"] == 2 and s2["outcome"] == "playing" and not s2["started"]
          and s2["nextLabel"] == "" and s2["caption"] == NIGHT2_BRIEF and s2["on"] == ""
          and "night=2" in url
          # sound: the plug and dawn cues were played; Night 2 starts with none
          and "plug" in end["recentCues"].split(",") and end["recentCues"].endswith("dawn")
          and s2["cues"] == 0)
    return ok, {"audio": end["audio"], "start": s0, "end": end, "after_next": s2, "url": url,
                "stored": {k: stored_after_win.get(k) for k in ("session", "nights")},
                "cord": str(cord_y)[:200]}


def sc_loss_then_retry():
    # Fan on, fridge never: the fridge is off from the first plug and spoils after
    # one game hour (FRIDGE_GRACE_H), about 6 s at ?speed=600.
    open_at("?night=1&speed=600&fresh")
    place("fan", 0)
    end = wait_outcome(30)
    press_next()
    s2 = status()
    ok = (end["outcome"] == "lost" and end["nextLabel"] == "Retry" and "RETRY" in end["caption"]
          and s2["night"] == 1 and s2["outcome"] == "playing" and not s2["started"]
          and s2["elapsedH"] == 0 and s2["on"] == ""
          and end["recentCues"].endswith("spoiled") and s2["cues"] == 0)
    return ok, {"end": end, "after_retry": s2}


def sc_resume_after_reload():
    # No ?fresh, so the saved night is kept. ?speed=60: one game hour per minute.
    open_at("?night=1&speed=60")
    place("fridge", 0)
    place("fan", 1)
    settle(3.0)  # past one 2 s save
    before = status()
    cli("browser", "reload", {})  # same URL; the page saves on pagehide too
    wait_for("PlayStatus")
    settle(1.0)
    a = status()
    settle(2.0)
    b = status()  # outside XR: the clock must wait
    enter_xr()
    settle(3.0)
    c = status()
    ok = (before["started"] and before["on"] == "fridge,fan"
          and a["resumed"] and a["started"] and a["on"] == "fridge,fan" and a["source"] == "battery"
          and a["elapsedH"] >= before["elapsedH"] - 1e-6 and a["remainingWh"] <= before["remainingWh"] + 1e-6
          and "Resumed at" in a["caption"]
          and b["elapsedH"] == a["elapsedH"]
          and c["elapsedH"] > b["elapsedH"] and c["on"] == "fridge,fan"
          and a["cues"] == 0)  # a restored night is not re-announced
    navigate("?night=1&fresh")  # leave nothing saved for the next scenario
    return ok, {"before": before, "after_reload": a, "outside_xr_2s_later": b, "in_xr_3s_later": c}


SCENARIOS = [
    ("Night 1 to dawn (plug + dawn cues), then NEXT starts Night 2 (no generator on 1–2)", sc_night1_dawn_then_next),
    ("fridge spoils (spoiled cue), then RETRY restarts the same night", sc_loss_then_retry),
    ("reload resumes the night on the battery; clock waits outside XR", sc_resume_after_reload),
]


def main():
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 1
    tally = {name: 0 for name, _ in SCENARIOS}
    failures = []
    for r in range(runs):
        for name, fn in SCENARIOS:
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
        print(f"\nFAIL run {r + 1}: {name}\n  {json.dumps(ev)[:1500]}")
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
