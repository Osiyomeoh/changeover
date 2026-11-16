#!/usr/bin/env python3
"""
Plays the video shot list in the headed emulator so it can be screen-recorded: emulated
Meta VR Glasses, emulated hands and eyes, inside the XR session. Every input is scripted,
so the video must say so, e.g. the closing card "Recorded in IWSDK's emulator (IWER) with
scripted hands and eyes. No headset was used."

Hands and head glide through scripts/film-move.mjs, which moves IWER's device on every
frame. The positions are the ones the emulator tests use (scripts/emu-play.py,
scripts/emu-look-hold.py). After each shot the game's own status is checked and the script
prints TAKE OK or TAKE BAD, so a bad take is known before editing.

Usage (from the project root, dev server running with the browser headed):
  python3 scripts/emu-film.py --list
  python3 scripts/emu-film.py                  every shot; each is set up, then waits for Enter
  python3 scripts/emu-film.py --shot dawn      one shot, e.g. for a retake
  python3 scripts/emu-film.py --auto           no Enter prompts (a 3 s gap before each shot)
  python3 scripts/emu-film.py --capture .stills-tmp/film   also record each shot's frames into DIR/<shot>/
                                               (scripts/film-capture.mjs) for scripts/film-cut.py; implies --auto
  python3 scripts/emu-film.py --overlay        keep the emulator's toolbar, hand panels and axis gizmos
                                               in frame (hidden by default; shown again at the end)
The cue log (seconds since the script started, per shot) goes to .stills-tmp/film-cues.txt, so
one long recording can be cut afterwards. Exit 0 only if every take played was OK.
"""
import json
import os
import shutil
import subprocess
import sys
import time

from emu_lib import CLI, PARK, cli, enter_xr, find_one, navigate, values, wait_for

TOP_Y = 0.72
TOKENS = ["fridge", "fan", "tv", "laptop", "pump", "microwave", "kettle", "iron"]
BOARD = (0.0, 0.89, -0.52)  # src/layout.ts BOARD
ISO = (BOARD[0] - 0.08, BOARD[1], BOARD[2] + 0.05)  # ISOLATOR_X, PROXY_Z
LEVER_OFF = (BOARD[0] + 0.08, BOARD[1] - 0.05, BOARD[2] + 0.05)  # LEVER_X, LEVER_Y0, PROXY_Z
SPAN = 0.14  # LEVER_SPAN
CORD = (-0.30, TOP_Y + 0.07, -0.38)  # layout CORD_POS = GENERATOR_POS
SEATED = -35  # the seated design pose: src/fov.test.ts keeps everything critical in view here
SAFE_GAZE = (0.0, TOP_Y, -0.08)  # the table's near edge: no look target, so a pinch is only the hand's
CAPTURE = sys.argv[sys.argv.index("--capture") + 1] if "--capture" in sys.argv else None
AUTO = "--auto" in sys.argv or CAPTURE is not None
OVERLAY = "--overlay" in sys.argv
_cap = None  # (process, dir) while a capture runs; the browser then queues `browser run`, so moves use `xr`
CUES_JSON = {}
if CAPTURE and os.path.exists(os.path.join(CAPTURE, "cues.json")):  # re-recording one shot keeps the others
    with open(os.path.join(CAPTURE, "cues.json")) as _f:
        CUES_JSON = json.load(_f)
_shot = {}
CUES = os.path.join(".stills-tmp", "film-cues.txt")
T0 = time.time()


# ---------- moves ----------

def run_moves(*moves):
    if _cap is not None:
        return xr_moves(moves)
    env = dict(os.environ, CO_MOVES=json.dumps(list(moves)))
    out = subprocess.run([CLI, "browser", "run", "scripts/film-move.mjs"], capture_output=True, text=True,
                         timeout=180, env=env)
    try:
        d = json.loads(out.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"film-move: {out.stdout[-300:]} {out.stderr[-300:]}")
    if not d.get("ok", True) or "data" not in d:
        raise RuntimeError(f"film-move failed: {json.dumps(d)[:400]}")
    return d["data"]["result"]


def _animate(device, ms, position=None, orientation=None):
    payload = {"device": device, "duration": max(0.05, ms / 1000)}
    if position is not None:
        payload["position"] = dict(zip("xyz", position))
    if orientation is not None:
        payload["orientation"] = orientation
    cli("xr", "animate-to", payload)


def xr_moves(moves):
    """The same moves through `xr animate-to` (IWER animates them per frame in the page), for capture mode."""
    for m in moves:
        if "wait" in m:
            time.sleep(m["wait"] / 1000)
        elif "hand" in m:
            dev, to, ms, lift = f"hand-{m['hand']}", m["to"], m.get("ms", 700), m.get("lift", 0)
            if lift:
                a = cli("xr", "get-transform", {"device": dev})["position"]
                mid = ((a["x"] + to[0]) / 2, (a["y"] + to[1]) / 2 + lift, (a["z"] + to[2]) / 2)
                _animate(dev, ms / 2, position=mid)
                _animate(dev, ms / 2, position=to)
            else:
                _animate(dev, ms, position=to)
        elif "pinch" in m:
            cli("xr", "set-select-value", {"device": f"hand-{m['pinch']}", "value": m["value"]})
        elif "head" in m:
            p, y = m["head"]
            _animate("headset", m.get("ms", 1500), orientation={"pitch": p, "yaw": y, "roll": 0})
        elif "overlay" in m:
            pass  # set before the capture starts
    return None


def capture_start(key):
    global _cap
    d = os.path.join(CAPTURE, key)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    env = dict(os.environ, CO_CAPTURE_DIR=d, CO_CAPTURE_NTH="2", CO_CAPTURE_MAX_S="104")
    # `browser run` stops a script after 60 s by default and retires the browser; 110 s is the most it allows,
    # so a shot (dawn and daily run longest, ~90 s) must fit inside that; the capture stops itself at 104 s.
    proc = subprocess.Popen([CLI, "browser", "run", "scripts/film-capture.mjs", "--timeout", "110000"],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=env)
    _cap = (proc, d)
    for _ in range(100):
        if os.path.exists(os.path.join(d, "f000000.jpg")):
            break
        time.sleep(0.1)
    time.sleep(0.5)


def capture_stop():
    global _cap
    proc, d = _cap
    _cap = None
    open(os.path.join(d, "STOP"), "w").close()
    out, err = proc.communicate(timeout=120)
    try:
        return json.loads(out)["data"]["result"]
    except Exception:  # noqa: BLE001
        return {"error": (out + err)[-300:]}


def mark(name, text):
    _shot.setdefault("marks", {})[name] = time.time()
    cue(f"  {name}: {text}")


def glide(side, to, ms=700, lift=0.0):
    return {"hand": side, "to": list(to), "ms": ms, "lift": lift}


def pinch(side, value, ms=150):
    return {"pinch": side, "value": value, "ms": ms}


def turn(pitch, yaw=0, ms=1500):
    return {"head": [pitch, yaw], "ms": ms}


def wait(ms):
    return {"wait": ms}


def home(tid):
    i = TOKENS.index(tid)  # layout trayPos
    return ((i % 4 - 1.5) * 0.1, TOP_Y + 0.03, -0.21 - 0.1 * (i // 4))


def slot(i):
    return ((i - 1.5) * 0.1, TOP_Y + 0.04, -0.41)  # layout slotX, SLOT_Z


def carry(tid, s, side="right"):
    """Reach the appliance, pinch it, carry it over the table onto circuit s, let go, rest."""
    return [glide(side, home(tid), 800), wait(150), pinch(side, 1), wait(250),
            glide(side, slot(s), 900, lift=0.05), wait(150), pinch(side, 0), wait(300),
            glide(side, PARK[side], 700)]


def tug_cord(side="right"):
    """Reach the generator's pull cord, pinch, pull it 6 cm towards you, let go, rest."""
    x, y, z = CORD
    return [glide(side, CORD, 900), wait(150), pinch(side, 1), wait(150),
            glide(side, (x + 0.02, y + 0.02, z + 0.06), 300), pinch(side, 0), wait(250),
            glide(side, PARK[side], 800)]


def look(p):
    cli("xr", "look-at", {"device": "gaze", "target": dict(zip("xyz", p))})


def head_now(pitch, yaw=0):
    cli("xr", "set-transform", {"device": "headset", "position": {"x": 0, "y": 1.25, "z": 0},
                                "orientation": {"pitch": pitch, "yaw": yaw, "roll": 0}})


def play():
    return values(find_one("PlayStatus"), "PlayStatus")


def interlock():
    return values(find_one("InterlockStatus"), "InterlockStatus")


def wait_until(pred, timeout, every=0.5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = play()
        if pred(s):
            return s
        time.sleep(every)
    return play()


# ---------- set-up and cues ----------

def setup(query, pitch=SEATED):
    """Open the app clean at `query`, enter XR with tracked hands, seat the head, eyes on the table edge."""
    navigate(query, clear=True)
    wait_for("PlayStatus")
    wait_for("InterlockStatus")
    enter_xr()
    cli("xr", "set-connected", {"device": "gaze", "connected": True})
    head_now(pitch)
    look(SAFE_GAZE)
    run_moves({"overlay": OVERLAY}, wait(800))


def cue(text):
    line = f"{time.time() - T0:8.1f} s  @{time.time():.3f}  {text}"
    print(line, flush=True)
    with open(CUES, "a") as f:
        f.write(line + "\n")


def ready(n, key, title):
    print(f"\nShot {n} '{key}' is set up: {title}", flush=True)
    if CAPTURE:
        return
    if AUTO:
        time.sleep(3)
    else:
        input("  start recording if you are filming shot by shot, then press Enter ")
    for i in (3, 2, 1):
        print(f"  {i}", flush=True)
        time.sleep(1)


# ---------- shots (the DEVPOST draft's shot list) ----------

def shot_title():
    """0:00-0:12. The dark flat on the table; the head tilts slowly down onto it. Add the text card in the edit."""
    yield "?night=1&fresh", -12
    run_moves(wait(1500), turn(SEATED, 0, 8000), wait(2500))
    s = play()
    yield (s["outcome"] == "playing" and not s["started"]), {"outcome": s["outcome"], "started": s["started"]}


def shot_night1():
    """0:12-0:40. Night 1: pinch the fridge, then the fan, onto circuits; the panel's hours drop."""
    yield "?night=1&fresh", SEATED
    run_moves(wait(1500), *carry("fridge", 0), wait(2500), *carry("fan", 1), wait(4000))
    s = play()
    yield (s["started"] and "fridge" in s["on"] and "fan" in s["on"]), {"on": s["on"], "loadW": s["loadW"], "caption": s["caption"]}


def shot_overload():
    """0:40-0:55. The fridge, then the clothes iron: 2,042 W > 1,500 W and everything trips."""
    yield "?night=1&fresh", SEATED
    run_moves(wait(1000), *carry("fridge", 0), wait(1500), *carry("iron", 1), wait(5000))
    s = play()
    yield (s["trips"] == 1 and s["on"] == "" and "2,042 W > 1,500 W" in s["caption"]), {"trips": s["trips"], "caption": s["caption"]}


def shot_backfeed():
    """0:55-1:15. Today's Daily Outage (it always has the generator): pull the cord without the changeover. Refused."""
    yield "?daily&fresh", SEATED
    run_moves(wait(1000), *carry("fridge", 0), wait(1500), *tug_cord(), wait(6000))
    s = play()
    yield (s["backfeedRefusals"] == 1 and s["source"] == "battery" and "backfeed" in s["caption"]), {
        "backfeedRefusals": s["backfeedRefusals"], "source": s["source"], "caption": s["caption"]}


def shot_eyes():
    """1:15-1:45. Eyes on the isolator (it glows), one hand throws the lever, then the cord: the generator runs."""
    yield "?daily&fresh", SEATED
    run_moves(wait(800), *carry("fridge", 0), wait(600), *carry("fan", 1), wait(800))
    cli("xr", "set-connected", {"device": "hand-left", "connected": False})
    run_moves(wait(600))
    look(ISO)
    x, y0, z = LEVER_OFF
    run_moves(wait(1800), glide("right", LEVER_OFF, 900), wait(150), pinch("right", 1), wait(300),
              glide("right", (x, y0 + SPAN * 1.05, z), 1800), wait(500))
    top = interlock()
    run_moves(pinch("right", 0), wait(200), glide("right", PARK["right"], 800), wait(2000), *tug_cord(), wait(4000))
    s = play()
    yield (top["phase"] == "latched" and top["energised"] and not top["leftTracked"] and s["source"] == "generator"), {
        "latch": {k: top[k] for k in ("phase", "energised", "isolatorHolder", "leftTracked")},
        "source": s["source"], "caption": s["caption"]}


def shot_lookaway():
    """1:45-2:00. Eyes holding the isolator, look away mid-throw: the lever springs back and the panel says why."""
    yield "?daily&fresh", SEATED
    cli("xr", "set-connected", {"device": "hand-left", "connected": False})
    run_moves(wait(800))
    look(ISO)
    x, y0, z = LEVER_OFF
    run_moves(wait(1800), glide("right", LEVER_OFF, 900), wait(150), pinch("right", 1), wait(300),
              glide("right", (x, y0 + SPAN * 0.6, z), 1300), wait(400))
    mid = interlock()
    look(LEVER_OFF)  # the look-away
    run_moves(wait(700), pinch("right", 0), glide("right", PARK["right"], 900), wait(4500))
    after, cap = interlock(), play()["caption"]
    yield (mid["phase"] == "throwing" and mid["isolatorHolder"] == "eyes" and not after["energised"]
           and after["travel"] == 0 and after["lastReset"] == "looked-away" and cap.startswith("You looked away")), {
        "mid": {k: mid[k] for k in ("phase", "isolatorHolder")}, "lastReset": after["lastReset"], "caption": cap}


def shot_dawn():
    """2:00-2:30. Night 1 won with the fridge and fan on: the flat opens into the room, the fan turns over the child.
    ?speed=600 runs the night in about 48 s; cut from the DAWN cue."""
    yield "?night=1&speed=600&fresh", SEATED
    run_moves(wait(500), *carry("fridge", 0), wait(300), *carry("fan", 1))
    mark("NIGHT", "both on; the night runs at ?speed=600")
    s = wait_until(lambda s: s["outcome"] != "playing", 120, every=0.25)
    if s["outcome"] != "won":
        yield False, {"outcome": s["outcome"]}
        return
    mark("DAWN", "the night is won, the room starts to grow")
    # window and fan, then the child on the mattress (right), the fridge (left), back to the window
    run_moves(wait(600), turn(-8, 0, 4500), wait(1500), turn(-16, -22, 3000), wait(3000),
              turn(-6, 26, 3800), wait(2000), turn(-8, 0, 2500), wait(3000))
    s = play()
    yield (s["reveal"] >= 0.99 and "fan" in s["revealOn"] and "fridge" in s["revealOn"]), {
        "reveal": round(s["reveal"], 2), "revealOn": s["revealOn"]}


def shot_daily():
    """2:30-2:45. Today's Daily Outage won: the panel shows "Streak 1 · best 1". ?speed=600; cut from the DAWN cue."""
    yield "?daily&speed=600&fresh", SEATED
    run_moves(wait(500), *carry("fridge", 0))
    mark("NIGHT", "fridge on; the night runs at ?speed=600")
    s = wait_until(lambda s: s["outcome"] != "playing", 150, every=0.25)
    if s["outcome"] != "won":
        yield False, {"outcome": s["outcome"]}
        return
    mark("DAWN", "the Daily is won; the panel shows the streak")
    run_moves(wait(6000), turn(-12, 0, 3000), wait(3000))
    s = play()
    yield (s["streak"] == 1 and s["streakBest"] >= 1), {"streak": s["streak"], "streakBest": s["streakBest"]}


SHOTS = [
    ("title", "the dark flat on the table", shot_title),
    ("night1", "Night 1: fridge, then fan, onto circuits", shot_night1),
    ("overload", "fridge + iron: 2,042 W > 1,500 W, everything trips", shot_overload),
    ("backfeed", "the cord pulled without the changeover is refused", shot_backfeed),
    ("eyes", "eyes hold the isolator, one hand throws the lever, the generator runs", shot_eyes),
    ("lookaway", "look away mid-throw: the lever springs back", shot_lookaway),
    ("dawn", "dawn: the room grows, the fan turns over the child", shot_dawn),
    ("daily", "a Daily Outage won: Streak 1 · best 1", shot_daily),
]


def main():
    if "--list" in sys.argv:
        for n, (key, title, fn) in enumerate(SHOTS, 1):
            print(f"{n}. {key:<9} {title}\n   {fn.__doc__.strip().splitlines()[0]}")
        return
    pick = sys.argv[sys.argv.index("--shot") + 1] if "--shot" in sys.argv else None
    shots = [(n, *s) for n, s in enumerate(SHOTS, 1) if pick in (None, s[0])]
    if not shots:
        sys.exit(f"no shot {pick!r}; try --list")
    dev = cli("xr", "get-device-state", {})
    if "gaze" not in (dev or {}):
        sys.exit("No gaze source: set dev.emulator.device to metaVRGlasses in iwsdk.config.json.")
    os.makedirs(os.path.dirname(CUES), exist_ok=True)
    with open(CUES, "a") as f:
        f.write(f"\n# emu-film {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(sys.argv[1:])}\n")
    results = []
    for n, key, title, fn in shots:
        steps = fn()
        query, pitch = next(steps)
        setup(query, pitch)
        ready(n, key, title)
        _shot.clear()
        if CAPTURE:
            capture_start(key)
        _shot["start"] = time.time()
        cue(f"shot {n} {key} START")
        try:
            ok, ev = next(steps)
        except Exception as e:  # noqa: BLE001
            ok, ev = False, {"error": str(e)}
        _shot["end"] = time.time()
        cue(f"shot {n} {key} END  {'TAKE OK' if ok else 'TAKE BAD'}")
        if CAPTURE:
            _shot["capture"] = capture_stop() if _cap else {"error": "capture already stopped"}
            CUES_JSON[key] = dict(_shot, ok=ok, n=n)
            with open(os.path.join(CAPTURE, "cues.json"), "w") as f:
                json.dump(CUES_JSON, f, indent=1)
            print(f"  capture {json.dumps(_shot['capture'])}", flush=True)
        print(f"  {'TAKE OK' if ok else 'TAKE BAD'}  {json.dumps(ev)}", flush=True)
        results.append((key, ok))
    try:
        run_moves({"overlay": True})
    except Exception:  # noqa: BLE001
        pass
    print("\n" + "  ".join(f"{k}:{'ok' if ok else 'BAD'}" for k, ok in results))
    print("Closing card: \"Recorded in IWSDK's emulator (IWER) with scripted hands and eyes. No headset was used.\"")
    print(f"Cue log: {CUES}")
    sys.exit(0 if all(ok for _, ok in results) else 1)


if __name__ == "__main__":
    main()
