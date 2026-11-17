#!/usr/bin/env python3
"""
Play one whole night to dawn with emulated hands and report the outcome and
streak. Does NOT reload: open the app first with a fast clock, e.g.
  CO_QUERY='?daily&speed=600&fresh' iwsdk browser run scripts/pw-open.mjs
(the dev server must run with --allow-browser-automation).
"""
import importlib.util
import json
import os
import time

from emu_lib import PARK, cli, find_one, hand, settle

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ep", os.path.join(here, "emu-play.py"))
ep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ep)


def main():
    for _ in range(60):
        try:
            find_one("PlayStatus")
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    cli("xr", "enter", {})
    cli("xr", "set-input-mode", {"mode": "hand"})
    for side in ("left", "right"):
        cli("xr", "set-connected", {"device": f"hand-{side}", "connected": True})
        cli("xr", "set-select-value", {"device": f"hand-{side}", "value": 0})
        hand(side, PARK[side])
    settle(0.5)
    before = ep.status()
    ep.place("fridge", 0)
    t0 = time.time()
    s = ep.status()
    while s["outcome"] == "playing" and time.time() - t0 < 240:
        time.sleep(2)
        s = ep.status()
    print(json.dumps({"streakBefore": before["streak"], "realSeconds": round(time.time() - t0), **s}))


if __name__ == "__main__":
    main()
