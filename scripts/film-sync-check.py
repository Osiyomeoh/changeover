"""Sync check for the video's sound: beep onsets in DIR/audio.wav against the frames where the app flashed white
(scripts/film-sync-test.mjs). Prints audio minus video for each flash, in milliseconds.
  python3 scripts/film-sync-check.py .stills-tmp/sync
"""
import json, subprocess, sys, wave, array
d = sys.argv[1]
info = json.load(open(f"{d}/audio.json"))
w = wave.open(f"{d}/audio.wav"); sr = w.getframerate(); a = array.array('h', w.readframes(w.getnframes()))
# beep onsets: first sample above 0.25 full scale after 0.4 s of quiet
on, last = [], -10**9
for i, v in enumerate(a):
    if abs(v) > 8000:
        if i - last > 0.4 * sr:
            on.append(info["startEpoch"] + i / sr)
        last = i
# flash frames: mean luma of each frame
idx = [l.split() for l in open(f"{d}/index.txt") if l.strip()]
import os
lst = os.path.join(d, "frames.txt")
open(lst, "w").write("".join(f"file '{os.path.abspath(d)}/{f}'\nduration 0.03\n" for _, f in idx))
r = subprocess.run(["ffmpeg", "-hide_banner", "-f", "concat", "-safe", "0", "-i", lst, "-vf", "crop=936:870:132:332,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"],
                   capture_output=True, text=True)
y = [float(l.split("=")[1]) for l in r.stderr.splitlines() if "YAVG=" in l][:len(idx)]
thr = (min(y) + max(y)) / 2; print("luma", round(min(y)), round(max(y)))
fl, prev = [], 1e9
for (t, f), v in zip(idx, y):
    if v > thr and prev <= thr:
        fl.append(float(t))
    prev = v
print("beeps ", [f"{x:.3f}" for x in on]); print("flashes", [f"{x:.3f}" for x in fl])
print("audio minus video (ms):", [round((b - v) * 1000) for b, v in zip(on, fl)])
