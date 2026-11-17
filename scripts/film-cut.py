#!/usr/bin/env python3
"""Cuts the submission video from the frames `scripts/emu-film.py --capture DIR` recorded.

Each shot's frames (DIR/<shot>/index.txt, one "<epoch seconds> <file>" per frame) are timed by their capture
timestamps, trimmed to the shot's START/END cues (DIR/cues.json), and the fast night inside `dawn` and `daily`
(between the NIGHT and DAWN cues) is sped up to a few seconds and labelled as such. The game view is cropped
out of the emulator's page and set beside a caption panel; the closing card says how it was recorded.
Sound: the game's own, recorded with each shot (DIR/<shot>/audio.wav, scripts/film-audio-tap.mjs) and cut on
the same lines as the picture; the fast night's sound is sped up with it (pitch kept). One gain for the whole
film brings its peak to PEAK_DB; nothing else is added, no music. Text is rendered by scripts/film-cards.swift
(this ffmpeg has no drawtext).

  python3 scripts/film-cut.py .stills-tmp/film            writes .stills-tmp/film/changeover.mp4
  python3 scripts/film-cut.py .stills-tmp/film --plan     prints the timeline only
  python3 scripts/film-cut.py .stills-tmp/film --voice scripts/film-voice.json
      the same cut with a narration on top (DIR/changeover-voice.mp4): each line is spoken by a synthetic
      voice (Amazon Polly, via the aws CLI; clips cached in .stills-tmp/voice), placed `at` seconds into its
      shot, with the game's sound turned down DUCK_DB under it. The closing card says the voice is synthetic.
"""
import hashlib
import json
import math
import os
import subprocess
import sys
import wave
from array import array

DIR = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ".stills-tmp/film")
PLAN_ONLY = "--plan" in sys.argv
VOICE = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else None
OUT = os.path.join(DIR, "changeover-voice.mp4" if VOICE else "changeover.mp4")
WORK = os.path.join(DIR, "cut-voice" if VOICE else "cut")
VOICE_LUFS = -16.0  # the narration's loudness; the game's sound keeps its one gain and sits under it
DUCK_DB = -9.0  # the game's sound while the voice speaks
FPS = 30
W, H = 1920, 1080
CROP = "936:870:132:332"  # the game view inside the emulator page (no overlay), measured by cropdetect
GW, GX = 1162, 80  # the game view scaled to 1080 high, and its left edge
PX, PW = 1310, 540  # caption panel
FF_SECONDS = 5.0  # a whole night at ?speed=600 shown in this many seconds
CLOSING_SECONDS = 6.0
IN_AT = {"dawn": ("NIGHT", -1.5)}  # dawn's carries repeat night1's, so it starts as its night begins
LIMIT = 178.0  # Devpost: under 3:00
RATE = 48000
PEAK_DB = -1.0  # the film's loudest moment after the one gain

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
    ("Recorded in IWSDK's emulator (IWER) with scripted hands and eyes, and the game's own sound. "
     "No headset was used.", 46, "medium", WHITE, -34),
    ("Try it: osiyomeoh.github.io/changeover", 34, "medium", AMBER, -64),
    ("Code (MIT): github.com/Osiyomeoh/changeover", 30, "regular", GREY, -18),
]
if VOICE:
    CLOSING[1] = ("Recorded in IWSDK's emulator (IWER) with scripted hands and eyes, and the game's own sound. "
                  "The narration is a synthetic voice. No\u00a0headset was used.", *CLOSING[1][1:])


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
    runs, run_at, run_fast = [], kept[0][0], False  # the sound's pieces: source span, and whether it is sped up
    for (t, p), nxt in zip(kept, kept[1:] + [(kept[-1][0] + 1 / FPS, None)]):
        fast = ff is not None and ff[0] <= t < ff[1]
        if fast != run_fast:
            runs.append((run_at, t, run_fast))
            run_at, run_fast = t, fast
        if fast and ff_out is None:
            ff_out = [clock, clock]
        dur = (nxt[0] - t) / (speed if fast else 1.0)
        out.append((p, dur))
        clock += dur
        if fast:
            ff_out[1] = clock
    runs.append((run_at, kept[-1][0] + 1 / FPS, run_fast))
    pieces = [(a, b, speed if f else 1.0) for a, b, f in runs if b > a]
    return out, clock, (ff_out, speed) if ff else None, pieces


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


def seconds(path):
    """A video segment's real length (whole frames), so its sound is cut to match and nothing drifts."""
    n = sh("ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
           "stream=nb_read_frames", "-of", "csv=p=0", path).strip()
    return int(n) / FPS


def encode_sound(key, pieces, length):
    """The shot's own sound on the same cut: each piece of source time, sped up where the picture is."""
    wav = os.path.join(DIR, key, "audio.wav")
    out = os.path.join(WORK, f"{key}.wav")
    if not os.path.exists(wav):
        print(f"  {key}: no audio.wav, silent", flush=True)
        return silence(out, length)
    with open(os.path.join(DIR, key, "audio.json")) as f:
        t0 = json.load(f)["startEpoch"]
    g = f"[0:a]asplit={len(pieces)}" + "".join(f"[s{i}]" for i in range(len(pieces)))
    for i, (a, b, speed) in enumerate(pieces):
        ra, rb, pre = a - t0, b - t0, 0.0
        if ra < 0:  # the shot began before the sound did
            pre, ra = -ra, 0.0
        chain = f"[s{i}]atrim=start={ra:.5f}:end={max(ra, rb):.5f},asetpts=PTS-STARTPTS"
        if speed != 1.0:
            chain += f",atempo={speed:.5f}"
        if pre:
            chain += f",adelay={pre * 1000:.0f}:all=1"
        g += f";{chain},apad,atrim=end={(b - a) / speed:.5f}[p{i}]"
    g += (";" + "".join(f"[p{i}]" for i in range(len(pieces))) + f"concat=n={len(pieces)}:v=0:a=1,"
          f"aresample={RATE},afade=t=in:st=0:d=0.3,afade=t=out:st={length - 0.35:.3f}:d=0.35,"
          f"apad,atrim=end_sample={round(length * RATE)}[au]")
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-filter_complex", g, "-map", "[au]",
       "-ac", "1", "-c:a", "pcm_s16le", out)
    return out


def silence(out, length):
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono",
       "-t", f"{length:.5f}", "-c:a", "pcm_s16le", out)
    return out


def levels(path, af=""):
    """Peak and mean (dBFS) of a sound file, or of a concat list."""
    src = ["-f", "concat", "-safe", "0", "-i", path] if path.endswith(".txt") else ["-i", path]
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *src, "-af", (af + "," if af else "") + "volumedetect",
                        "-f", "null", "-"], capture_output=True, text=True)
    get = lambda k: float(r.stderr.split(k + ":")[1].split()[0])  # noqa: E731
    return get("max_volume"), get("mean_volume")


def pcm(src):
    """A sound file, or a concat list, as 16-bit mono samples at RATE."""
    inp = ["-f", "concat", "-safe", "0", "-i", src] if src.endswith(".txt") else ["-i", src]
    r = subprocess.run(["ffmpeg", "-v", "error", *inp, "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
                       capture_output=True)
    if r.returncode:
        sys.exit(f"failed to decode {src}: {r.stderr[-500:]}")
    a = array("h")
    a.frombytes(r.stdout)
    return a


def write_wav(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def lufs(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True)
    return float(r.stderr.rsplit("I:", 1)[1].split()[0])


def speak(text, voice, engine):
    """One line from the synthetic voice, trimmed to where the speech starts and ends."""
    cache = os.path.join(os.path.dirname(DIR), "voice")
    os.makedirs(cache, exist_ok=True)
    mp3 = os.path.join(cache, hashlib.sha1(f"{voice}|{engine}|{text}".encode()).hexdigest()[:16] + ".mp3")
    if not os.path.exists(mp3):
        sh("aws", "polly", "synthesize-speech", "--region", "us-east-1", "--engine", engine, "--voice-id", voice,
           "--output-format", "mp3", "--sample-rate", "24000", "--text", text, mp3)
    a = pcm(mp3)
    loud = [i for i in range(0, len(a), 240) if max(abs(x) for x in a[i:i + 240]) > 300]  # above -40 dBFS
    if not loud:
        sys.exit(f"silent clip for: {text}")
    return a[max(0, loud[0] - 240):min(len(a), loud[-1] + 720)]


def narrate(alst, starts, lengths):
    """The game's sound with the narration on top: (wav path, report lines)."""
    with open(VOICE) as f:
        spec = json.load(f)
    game = pcm(alst)
    n = len(game)
    voice = array("i", bytes(4 * n))
    spans, report, problems = [], [], []
    for ln in spec["lines"]:
        clip = speak(ln["text"], spec["voice"], spec["engine"])
        t = starts[ln["shot"]] + ln["at"]
        end = t + len(clip) / RATE
        i0 = round(t * RATE)
        for j, x in enumerate(clip[: max(0, n - i0)]):
            voice[i0 + j] += x
        if spans and t < spans[-1][1] + 0.15:
            problems.append(f"overlaps the line before: {ln['text']}")
        if end > starts[ln["shot"]] + lengths[ln["shot"]] + 0.25:
            problems.append(f"runs past its shot ({end - starts[ln['shot']] - lengths[ln['shot']]:+.2f} s): {ln['text']}")
        spans.append((t, end))
        report.append(f"{int(t // 60)}:{t % 60:04.1f}–{int(end // 60)}:{end % 60:04.1f}  {ln['shot']:9s} {ln['text']}")
    for p in problems:
        print("  voice: " + p, flush=True)
    raw = os.path.join(WORK, "voice-raw.wav")
    write_wav(raw, array("h", (max(-32768, min(32767, x)) for x in voice)))
    # The voice alone is brought to VOICE_LUFS, its consonant peaks held under -2 dB by a limiter (voice only).
    vpath = os.path.join(WORK, "voice.wav")
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-af",
       f"aformat=sample_fmts=flt,volume={VOICE_LUFS - lufs(raw):.2f}dB,"
       f"alimiter=limit={10 ** (-2 / 20):.4f}:attack=5:release=60:level=0", "-c:a", "pcm_s16le", vpath)
    voice, gv = pcm(vpath), 1.0
    # The game's sound keeps the one gain that brings its own peak to PEAK_DB, and dips DUCK_DB under each line.
    peak = max(max(game), -min(game)) or 1
    gg = 10 ** (PEAK_DB / 20) * 32767 / peak
    duck, ramp = 10 ** (DUCK_DB / 20), round(0.25 * RATE)
    env = array("f", [1.0]) * n
    merged = []
    for a, b in spans:  # one dip across lines less than a second apart
        if merged and a - merged[-1][1] < 1.0:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    for a, b in merged:
        i, j = max(0, round((a - 0.15) * RATE)), min(n, round((b + 0.3) * RATE))
        for k in range(max(0, i - ramp), j + ramp):
            if k >= n:
                break
            if k < i:
                v = 1 - (1 - duck) * (k - (i - ramp)) / ramp
            elif k < j:
                v = duck
            else:
                v = 1 - (1 - duck) * (1 - (k - j) / ramp)
            env[k] = min(env[k], v)
    mix = [g * gg * e + v * gv for g, e, v in zip(game, env, voice)]
    top = max(max(mix), -min(mix))
    fit = min(1.0, 10 ** (PEAK_DB / 20) * 32767 / top)  # one gain down if the voice pushes the peak over
    out = os.path.join(WORK, "mix.wav")
    write_wav(out, array("h", (max(-32768, min(32767, round(x * fit))) for x in mix)))
    report.append(f"voice: {spec['voice']} ({spec['engine']}), synthetic; {len(spec['lines'])} lines, "
                  f"{lufs(vpath):.1f} LUFS alone (limited at -2 dB); "
                  f"game sound {20 * math.log10(gg):+.1f} dB, {DUCK_DB:.0f} dB under the voice; "
                  f"overall {20 * math.log10(fit):+.1f} dB; {lufs(out):.1f} LUFS")
    if problems:
        report += ["voice problems:"] + problems
    return out, report


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
        kept, dur, ff, pieces = plan(key, cues[key])
        plans[key] = (kept, dur, ff, pieces)
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
    segs, sounds, starts, lengths, at = [], [], {}, {}, 0.0
    for key in order:
        kept, dur, ff, pieces = plans[key]
        segs.append(encode_shot(key, kept, dur, ff))
        starts[key], lengths[key] = at, seconds(segs[-1])
        at += lengths[key]
        sounds.append(encode_sound(key, pieces, lengths[key]))
        peak, mean = levels(sounds[-1])
        print(f"  encoded {key}: sound peak {peak:.1f} dB, mean {mean:.1f} dB", flush=True)
    closing = os.path.join(WORK, "closing.mp4")
    sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", str(FPS), "-t",
       f"{CLOSING_SECONDS}", "-i", os.path.join(WORK, "closing.png"), "-vf",
       f"fade=t=in:st=0:d=0.5,fade=t=out:st={CLOSING_SECONDS - 0.6}:d=0.6,format=yuv420p", "-r", str(FPS),
       "-c:v", "libx264", "-preset", "medium", "-crf", "18", closing)
    segs.append(closing)
    sounds.append(silence(os.path.join(WORK, "closing.wav"), seconds(closing)))
    lst = os.path.join(WORK, "segments.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{s}'\n" for s in segs)
    alst = os.path.join(WORK, "sounds.txt")
    with open(alst, "w") as f:
        f.writelines(f"file '{s}'\n" for s in sounds)
    peak, mean = levels(alst)
    gain = PEAK_DB - peak
    print(f"  sound before gain: peak {peak:.1f} dB, mean {mean:.1f} dB; gain {gain:+.1f} dB", flush=True)
    if VOICE:
        mix, report = narrate(alst, starts, lengths)
        sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
           "-i", mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-ac", "2", "-c:a", "aac", "-b:a", "192k",
           "-shortest", "-movflags", "+faststart", OUT)
        timeline += ["sound: the game's own, with a synthetic narration on top"] + report
        print("\n".join(report), flush=True)
    else:
        sh("ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
           "-f", "concat", "-safe", "0", "-i", alst, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
           "-af", f"volume={gain:.2f}dB", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
           OUT)
        timeline.append(f"sound: the game's own; one gain {gain:+.1f} dB brings the peak to {PEAK_DB} dB")
    with open(os.path.join(DIR, "timeline-voice.txt" if VOICE else "timeline.txt"), "w") as f:
        f.write("\n".join(timeline) + "\n")
    probe = sh("ffprobe", "-v", "error", "-show_entries",
               "format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels,duration",
               "-of", "json", OUT)
    print(OUT, json.dumps(json.loads(probe)), flush=True)


if __name__ == "__main__":
    main()
