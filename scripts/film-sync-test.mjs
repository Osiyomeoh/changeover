// Usage: CO_CAPTURE_DIR=.stills-tmp/sync iwsdk browser run scripts/film-sync-test.mjs (page opened with CO_AUDIO_TAP=1),
// then python3 scripts/film-sync-check.py .stills-tmp/sync
// Sync check for the video's sound: flash the app white and start a beep on the same animation frame,
// three times, while film-capture.mjs records; scripts compare the flash frames with the beep onsets.
import fs from 'node:fs';
import path from 'node:path';
import capture from './film-capture.mjs';

export default async (args) => {
  const { page, frame, workspaceRoot } = args;
  const dir = path.resolve(workspaceRoot ?? '.', process.env.CO_CAPTURE_DIR);
  const app = frame ?? page.mainFrame();
  const run = capture(args);
  await new Promise((r) => setTimeout(r, 1500));
  const marks = await app.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147483647;display:none';
    document.body.appendChild(div);
    const out = [];
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 900));
      await new Promise((r) => requestAnimationFrame(() => {
        div.style.display = 'block';
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 3000;
        g.gain.value = 0.5;
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.25);
        out.push(performance.timeOrigin + performance.now());
        r();
      }));
      await new Promise((r) => setTimeout(r, 300));
      div.style.display = 'none';
    }
    div.remove();
    return out;
  });
  await new Promise((r) => setTimeout(r, 1200));
  fs.writeFileSync(path.join(dir, 'STOP'), '');
  const res = await run;
  return { ...res, marks };
};
