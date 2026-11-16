#!/usr/bin/env python3
"""Cuts the submission video from the frames `scripts/emu-film.py --capture DIR` recorded.

Each shot's frames (DIR/<shot>/index.txt, one "<epoch seconds> <file>" per frame) are timed by their capture
timestamps, trimmed to the shot's START/END cues (DIR/cues.json), and the fast night inside `dawn` and `daily`
(between the NIGHT and DAWN cues) is sped up to a few seconds and labelled as such. The game view is cropped
out of the emulator's page and set beside a caption panel; the closing card says how it was recorded.
Picture only, no music. Text is rendered by scripts/film-cards.swift (this ffmpeg has no drawtext).

  python3 scripts/film-cut.py .stills-tmp/film            writes .stills-tmp/film/changeover.mp4
  python3 scripts/film-cut.py .stills-tmp/film --plan     prints the timeline only
"""
import json
import os
import subprocess
import sys

DIR = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ".stills-tmp/film")
PLAN_ONLY = "--plan" in sys.argv
OUT = os.path.join(DIR, "changeover.mp4")
WORK = os.path.join(DIR, "cut")
FPS = 30
W, H = 1920, 1080
CROP = "936:870:132:332"  # the game view inside the emulator page (no overlay), measured by cropdetect
GW, GX = 1162, 80  # the game view scaled to 1080 high, and its left edge
PX, PW = 1310, 540  # caption panel
FF_SECONDS = 5.0  # a whole night at ?speed=600 shown in this many seconds
CLOSING_SECONDS = 6.0
IN_AT = {"dawn": ("NIGHT", -1.5)}  # dawn's carries repeat night1's, so it starts as its night begins
LIMIT = 178.0  # Devpost: under 3:00

AMBER, WHITE, GREY, DIM = [0.96, 0.73, 0.25], [1, 1, 1], [0.74, 0.74, 0.77], [0.5, 0.5, 0.53]

# kicker, headline, body. Every number here is in CLAIMS.md (row 9: 12 collapses; row 11: 2,042 W > 1,500 W).
PANELS = {
    "title": ("CHANGEOVER", "2024: Nigeria's grid collapsed 12 times.",
              "One of those nights, on your table: an inverter, a generator, a family asleep. "
              "Keep the power on till dawn. Seated, hands only."),
    "night1": ("NIGHT 1", "Pinch it, carry it, plug it in.",
               "Fridge, then fan, onto the inverter. The panel adds up the load and how long the battery will last."),
    "overload": ("OVERLOAD", "Too much at once trips everything.",
                 "Add the clothes iron: 2,042 W on a 1,500 W inverter. Everything trips, and the panel shows the sum."),
    "backfeed": ("BACKFEED", "The generator won't start into the mains.",
                 "Pull the cord before isolating and it is refused: the generator would backfeed the street line "
                 "and could kill a line worker."),
    "eyes": ("THE EYES", "Look at the switch to pick it.",
             "Left hand out of tracking. Eyes on the red isolator and it lights; the right hand throws the lever. "
             "Pull the cord and the generator runs."),
    "lookaway": ("DEAD-MAN'S SWITCH", "Look away and the lever springs back.",
                 "The throw holds only while your eyes stay on the red isolator. Look away mid-throw and the power "
                 "stays off."),
    "dawn": ("DAWN", "Keep the fridge cold till 06:00.",
             "Win the night and the flat opens into the room around you: the fan turns over the sleeping child."),
    "daily": ("DAILY OUTAGE", "A new night every day.",
              "Everyone gets the same night on a date. Win it to start a streak."),
}
for _k, (_a, _b, _c) in PANELS.items():  # keep a number on the same line as its unit
    PANELS[_k] = (_a, _b, _c.replace(" W ", "\u00a0W ").replace(" W:", "\u00a0W:").replace("12 times", "12\u00a0times"))
FOOTER = "IWSDK emulator (IWER) · scripted hands and eyes"
CLOSING = [
    ("CHANGEOVER", 34, "semibold", AMBER, 330),
    ("Recorded in IWSDK's emulator (IWER) with scripted hands and eyes. No headset was used.", 46, "medium", WHITE, -34),
    ("Try it: osiyomeoh.github.io/changeover", 34, "medium", AMBER, -64),
    ("Code (MIT): github.com/Osiyomeoh/changeover", 30, "regular", GREY, -18),
]


def sh(*cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"failed: {' '.join(cmd[:6])}…\n{r.stderr[-1500:]}")
    return r.stdout


def frames(key):
    d = os.path.join(DIR, key)
    with open(os.path.join(d, "index.txt")) as f:
        rows = [ln.split() for ln in f if ln.strip()]
    return [(float(t), os.path.join(d, name)) for t, name in rows]


def plan(key, cue):
    """The kept frames and how long each is shown."""
    fr = frames(key)
    marks = cue.get("marks", {})
    t_in, t_out = cue["start"] - 0.2, cue["end"] + 0.4
    if key in IN_AT:
        t_in = marks[IN_AT[key][0]] + IN_AT[key][1]
    ff = None
    if "NIGHT" in marks and "DAWN" in marks:
        ff = (marks["NIGHT"] + 0.6, marks["DAWN"] - 0.2)
    kept = [(t, p) for t, p in fr if t_in <= t <= t_out]
    if len(kept) < 10:
        sys.exit(f"{key}: only {len(kept)} frames between its cues")
    speed = (ff[1] - ff[0]) / FF_SECONDS if ff else 1.0
    out, clock, ff_out = [], 0.0, None
    for (t, p), nxt in zip(kept, kept[1:] + [(kept[-1][0] + 1 / FPS, None)]):
        fast = ff is not None and ff[0] <= t < ff[1]
        if fast and ff_out is None:
            ff_out = [clock, clock]
        dur = (nxt[0] - t) / (speed if fast else 1.0)
        out.append((p, dur))
        clock += dur
        if fast:
            ff_out[1] = clock
    return out, clock, (ff_out, speed) if ff else None


def cards(order):
    items = []
    for key in order:
        k, head, body = PANELS[key]
        items.append({"out": os.path.join(WORK, f"panel-{key}.png"), "w": W, "h": H, "bg": [0, 0, 0, 1], "items": [
            {"text": k, "x": PX, "y": 300, "w": PW, "size": 26, "weight": "semibold", "color": AMBER},
            {"text": head, "x": PX, "y": -18, "w": PW, "size": 50, "weight": "bold", "color": WHITE},
            {"text": body, "x": PX, "y": -28, "w": PW, "size": 30, "weight": "regular", "color": GREY},
            {"text": FOOTER, "x": PX, "y": 1004, "w": PW, "size": 22, "weight": "regular", "color": DIM},
        ]})
    items.append({"out": os.path.join(WORK, "ff.png"), "w": 300, "h": 60, "bg": [0, 0, 0, 0.62], "items": [
        {"text": "Night sped up", "x": 0, "y": 12, "w": 300, "size": 28, "weight": "semibold", "color": WHITE,
         "align": "center"}]})
    items.append({"out": os.path.join(WORK, "closing.png"), "w": W, "h": H, "bg": [0, 0, 0, 1], "items": [
        {"text": t, "x": 260, "y": y, "w": 1400, "size": s, "weight": wt, "color": c, "align": "center"}
        for t, s, wt, c, y in CLOSING]})
    spec = os.path.join(WORK, "cards.json")
    with open(spec, "w") as f:
        json.dump(items, f)
    sh("swift", os.path.join(os.path.dirname(os.path.abspath(__file__)), "film-cards.swift"), spec)


def encode_shot(key, kept, dur, ff):
    lst = os.path.join(WORK, f"{key}.txt")
    with open(lst, "w") as f:
        for p, d in kept:
            f.write(f"file '{p}'\nduration {d:.5f}\n")
        f.write(f"file '{kept[-1][0]}'\n")
    seg = os.path.join(WORK, f"{key}.mp4")
    inputs = ["-f", "concat", "-safe", "0", "-i", lst,
              "-loop", "1", "-framerate", str(FPS), "-i", os.path.join(WORK, f"panel-{key}.png")]
    g = (f"[0:v]crop={CROP},scale={GW}:{H}:flags=lanczos,setsar=1,fps={FPS}[g];"
         f"[1:v][g]overlay=x={GX}:y=0:shortest=1[a]")
    last = "a"
    if ff:
        (a, b), _ = ff
        inputs += ["-loop", "1", "-framerate", str(FPS), "-i", os.path.join(WORK, "ff.png")]
        g += f";[a][2:v]overlay=x={GX + 24}:y=24:enable='between(t,{a:.3f},{b:.3f})'[b]"
        last = "b"
    g += f";[{last}]fade=t=in:st=0:d=0.3,fade=t=out:st={dur - 0.35:.3f}:d=0.35,format=yuv420p[v]"
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", g, "-map", "[v]",
       "-t", f"{dur:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18", seg)
    return seg


def main():
    with open(os.path.join(DIR, "cues.json")) as f:
        cues = json.load(f)
    order = [k for k in sorted(cues, key=lambda k: cues[k]["n"]) if k in PANELS]
    bad = [k for k in order if not cues[k]["ok"]]
    if bad:
        print(f"warning: TAKE BAD in {bad}", flush=True)
    plans, t = {}, 0.0
    timeline = []
    for key in order:
        kept, dur, ff = plan(key, cues[key])
        plans[key] = (kept, dur, ff)
        note = f"  (night {ff[0][1] - ff[0][0]:.1f} s shown, {ff[1]:.1f}× speed)" if ff else ""
        timeline.append(f"{int(t // 60)}:{t % 60:04.1f}–{int((t + dur) // 60)}:{(t + dur) % 60:04.1f}  {key:9s} "
                        f"{dur:5.1f} s  {len(kept)} frames{note}")
        t += dur
    timeline.append(f"{int(t // 60)}:{t % 60:04.1f}–{int((t + CLOSING_SECONDS) // 60)}:"
                    f"{(t + CLOSING_SECONDS) % 60:04.1f}  closing   {CLOSING_SECONDS:5.1f} s")
    t += CLOSING_SECONDS
    timeline.append(f"total {int(t // 60)}:{t % 60:04.1f}")
    print("\n".join(timeline), flush=True)
    if t > LIMIT:
        sys.exit(f"too long: {t:.1f} s > {LIMIT} s")
    if PLAN_ONLY:
        return
    os.makedirs(WORK, exist_ok=True)
    cards(order)
    segs = []
    for key in order:
        kept, dur, ff = plans[key]
        segs.append(encode_shot(key, kept, dur, ff))
        print(f"  encoded {key}", flush=True)
    closing = os.path.join(WORK, "closing.mp4")
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", str(FPS), "-t",
       f"{CLOSING_SECONDS}", "-i", os.path.join(WORK, "closing.png"), "-vf",
       f"fade=t=in:st=0:d=0.5,fade=t=out:st={CLOSING_SECONDS - 0.6}:d=0.6,format=yuv420p", "-r", str(FPS),
       "-c:v", "libx264", "-preset", "medium", "-crf", "18", closing)
    segs.append(closing)
    lst = os.path.join(WORK, "segments.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{s}'\n" for s in segs)
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy",
       "-movflags", "+faststart", OUT)
    with open(os.path.join(DIR, "timeline.txt"), "w") as f:
        f.write("\n".join(timeline) + "\n")
    probe = sh("ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height,r_frame_rate",
               "-of", "json", OUT)
    print(OUT, json.dumps(json.loads(probe)), flush=True)


if __name__ == "__main__":
    main()
