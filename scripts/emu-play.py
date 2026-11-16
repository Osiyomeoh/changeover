#!/usr/bin/env python3
"""
Emulator scenarios for a played night, driven with emulated tracked hands only.
Reads the live PlayStatus component. Usage: python3 scripts/emu-play.py [--runs N]
Exit 0 only if every scenario passes on every run.
"""
import sys

from emu_lib import PARK, find_one, fresh_session, hand, move, navigate, settle, values

TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
BOARD = (0.0, 0.89, -0.52)  # src/layout.ts BOARD
ISO = (BOARD[0] - 0.08, BOARD[1], BOARD[2] + 0.05)
LEVER_OFF = (BOARD[0] + 0.08, BOARD[1] - 0.05, BOARD[2] + 0.05)  # layout LEVER_Y0, PROXY_Z
CORD = (-0.30, TOP_Y + 0.07, -0.38)  # layout CORD_POS = GENERATOR_POS


def home(tid):
    # layout trayPos: two rows of four, 0.1 m apart; near row z -0.21, far row -0.31
    i = TOKENS.index(tid)
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
    hand(side, PARK[side]); settle(0.2)


def throw_changeover():
    hand("left", ISO, pinch=1); settle()
    hand("right", LEVER_OFF, pinch=1); settle()
    x, y0, z = LEVER_OFF
    for i in range(1, 7):
        hand("right", (x, y0 + 0.14 * 1.05 * i / 6, z)); settle(0.12)
    hand("right", PARK["right"], pinch=0); hand("left", PARK["left"], pinch=0); settle(0.3)


def pull_cord():
    hand("right", CORD); settle(0.15)
    hand("right", CORD, pinch=1); settle(0.4)
    hand("right", CORD, pinch=0); settle(0.2)
    hand("right", PARK["right"]); settle(0.3)


def sc_initial():
    s = status()
    return (not s["started"] and s["outcome"] == "playing" and s["on"] == "" and s["trips"] == 0), s


def sc_place_fridge():
    place("fridge", 0)
    s = status()
    return (s["started"] and s["on"] == "fridge" and s["loadW"] > 0), s


def sc_overload():
    place("fridge", 0)
    place("iron", 1)
    s = status()
    ok = s["trips"] == 1 and s["on"] == "" and "2,042 W > 1,500 W" in s["caption"]  # fridge 725/3 + iron 1800
    return ok, s


def sc_backfeed_refused():
    place("fridge", 0)
    pull_cord()
    s = status()
    ok = s["backfeedRefusals"] == 1 and s["source"] == "battery" and "backfeed" in s["caption"]
    return ok, s


def sc_generator_after_changeover():
    place("fridge", 0)
    throw_changeover()
    pull_cord()
    s = status()
    return (s["source"] == "generator" and s["backfeedRefusals"] == 0), s


def sc_tracking_loss_holding_token():
    h = home("fan")
    hand("right", h); settle(0.15)
    hand("right", h, pinch=1); settle(0.25)
    move("right", h, slot(2))
    from emu_lib import cli
    cli("xr", "set-connected", {"device": "hand-right", "connected": False}); settle(0.6)
    s = status()
    fan = values_of_token("fan")
    ok = s["on"] == "" and fan["slot"] == -1
    return ok, {"status": s, "fanToken": fan}


def sc_tracking_loss_on_cord():
    # The cord is a one-shot pull: grabbing it pulls once and is force-released at
    # once. Losing the hand mid-pinch must not pull twice, leave the cord held, or
    # move it.
    from emu_lib import cli
    place("fridge", 0)
    cord_idx = find_one("GeneratorCord")
    before = values(cord_idx, "Transform")["position"]
    hand("right", CORD); settle(0.15)
    hand("right", CORD, pinch=1); settle(0.15)
    cli("xr", "set-connected", {"device": "hand-right", "connected": False}); settle(0.6)
    cli("xr", "set-connected", {"device": "hand-right", "connected": True})
    cli("xr", "set-select-value", {"device": "hand-right", "value": 0})
    hand("right", PARK["right"]); settle(0.5)
    s = status()
    held = cli("ecs", "find", {"withComponents": ["GeneratorCord", "Grabbed"]})["entities"]
    after = values(cord_idx, "Transform")["position"]
    # The regained pinch must be the one the guard ignored (src/play-system.ts ARM_S).
    ok = (s["backfeedRefusals"] == 1 and s["regainedIgnored"] >= 1 and s["source"] == "battery"
          and s["on"] == "fridge" and not held and before == after)
    return ok, {"status": s, "cordHeld": held, "cordPos": [before, after]}


def values_of_token(tid):
    from emu_lib import cli
    r = cli("ecs", "find", {"withComponents": ["Token"]})
    for e in r["entities"]:
        v = values(e["entityIndex"], "Token")
        if v["applianceId"] == tid:
            return v
    raise RuntimeError(f"token {tid} not found")


def held_ids():
    from emu_lib import cli
    r = cli("ecs", "find", {"withComponents": ["Token", "Grabbed"]})
    return sorted(values(e["entityIndex"], "Token")["applianceId"] for e in r["entities"])


def sc_each_token_grabs_itself():
    # Pinch every token at its home with each hand; exactly that token must be held.
    # Guards GRAB_SPACING_M: IWSDK grabs from the palm, so tight spacing picked a neighbour.
    wrong = {}
    for side in ("right", "left"):
        for tid in TOKENS:
            h = home(tid)
            lift = (h[0], h[1] + 0.06, h[2])
            hand(side, h); settle(0.15)
            hand(side, h, pinch=1); settle(0.25)
            hand(side, lift); settle(0.15)
            got = held_ids()
            if got != [tid]:
                wrong[f"{side}:{tid}"] = got
            hand(side, h); settle(0.1)
            hand(side, h, pinch=0); settle(0.2)
            hand(side, PARK[side]); settle(0.15)
    return not wrong, {"wrong": wrong}


SCENARIOS = [
    ("initial state: not started, nothing on", sc_initial),
    ("pinch fridge onto circuit 1 starts the night", sc_place_fridge),
    ("iron overloads the inverter and trips", sc_overload),
    ("generator refused without changeover (backfeed)", sc_backfeed_refused),
    ("generator runs after isolate + throw", sc_generator_after_changeover),
    ("tracking lost while holding a token returns it", sc_tracking_loss_holding_token),
    ("each of 8 tokens grabs itself, both hands", sc_each_token_grabs_itself),
    ("tracking lost mid-pinch on the cord: one pull, cord not held", sc_tracking_loss_on_cord),
]


def main():
    import json
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 1
    if "--only" in sys.argv:  # substring of a scenario name, e.g. --only cord
        pick = sys.argv[sys.argv.index("--only") + 1]
        SCENARIOS[:] = [s for s in SCENARIOS if pick in s[0]]
        if not SCENARIOS:
            sys.exit(f"no scenario matches {pick!r}")
    # The Daily Outage always has the generator; ?fresh makes every reload start clean.
    navigate("?daily&fresh")
    tally = {name: 0 for name, _ in SCENARIOS}
    failures = []
    for r in range(runs):
        for name, fn in SCENARIOS:
            fresh_session("PlayStatus")
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
