"""Shared helpers for emulator scenario scripts (IWER via the IWSDK CLI, emulated hands)."""
import json
import os
import subprocess
import time

CLI = "./node_modules/.bin/iwsdk"
PARK = {"left": (-0.3, 0.8, -0.2), "right": (0.3, 0.8, -0.2)}


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


def find_one(component):
    r = cli("ecs", "find", {"withComponents": [component]})
    return r["entities"][0]["entityIndex"]


def values(idx, component):
    r = cli("ecs", "query", {"entityIndex": idx})
    for c in r["components"]:
        if c["componentId"] == component:
            return c["values"]
    raise RuntimeError(f"{component} missing on entity {idx}")


def hand(side, pos, pinch=None):
    cli("xr", "set-transform", {"device": f"hand-{side}", "position": dict(zip("xyz", pos))})
    if pinch is not None:
        cli("xr", "set-select-value", {"device": f"hand-{side}", "value": pinch})


def settle(s=0.25):
    time.sleep(s)


def move(side, a, b, steps=6, dwell=0.1):
    for i in range(1, steps + 1):
        t = i / steps
        hand(side, tuple(a[k] + (b[k] - a[k]) * t for k in range(3)))
        settle(dwell)


def navigate(query, clear=False):
    """Open the app at `query` (e.g. '?daily&fresh'); later reloads keep it.
    clear=True first removes the game's saved night, campaign progress and streak."""
    env = dict(os.environ, CO_QUERY=query)
    if clear:
        env["CO_CLEAR"] = "all"
    out = subprocess.run([CLI, "browser", "run", "scripts/pw-open.mjs"], capture_output=True,
                         text=True, timeout=90, env=env)
    if out.returncode != 0:
        raise RuntimeError(f"navigate {query}: {out.stdout[-300:]} {out.stderr[-300:]}")
    return out.stdout


def page_state():
    """The app frame's URL and the game's stored keys, without navigating."""
    out = subprocess.run([CLI, "browser", "run", "scripts/pw-open.mjs"], capture_output=True, text=True,
                         timeout=90, env=dict(os.environ, CO_READ_ONLY="1"))
    d = json.loads(out.stdout)
    return d["data"]["result"] if "data" in d else d


def wait_for(component, tries=60):
    for _ in range(tries):
        try:
            return find_one(component)
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"{component} never appeared")


def enter_xr():
    cli("xr", "enter", {})
    cli("xr", "set-input-mode", {"mode": "hand"})
    for side in ("left", "right"):
        cli("xr", "set-connected", {"device": f"hand-{side}", "connected": True})
        cli("xr", "set-select-value", {"device": f"hand-{side}", "value": 0})
    cli("xr", "set-transform", {"device": "headset", "position": {"x": 0, "y": 1.25, "z": 0},
                                "orientation": {"pitch": -15, "yaw": 0, "roll": 0}})
    hand("left", PARK["left"])
    hand("right", PARK["right"])
    settle(0.5)


def fresh_session(ready_component):
    """Reload, enter XR with tracked hands, seated head."""
    cli("browser", "reload", {})
    wait_for(ready_component)
    enter_xr()
