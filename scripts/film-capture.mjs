/**
 * Records the managed browser's page as JPEG frames (Chrome DevTools screencast) while
 * scripts/emu-film.py plays the shots, for cutting the video with scripts/film-cut.py.
 * Picture only: the game's generated sound is not captured.
 *
 * Runs until the stop file exists (default .stills-tmp/capture/STOP) or CO_CAPTURE_MAX_S passes.
 * Writes f000000.jpg… and index.txt ("<epoch seconds> <file>" per frame) into CO_CAPTURE_DIR.
 * CO_CAPTURE_NTH=2 keeps every second frame.
 * Usage: CO_CAPTURE_DIR=.stills-tmp/capture iwsdk browser run scripts/film-capture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

export default async ({ page, context, workspaceRoot }) => {
  const dir = path.resolve(workspaceRoot ?? '.', process.env.CO_CAPTURE_DIR ?? '.stills-tmp/capture');
  const stop = path.join(dir, 'STOP');
  const maxS = Number(process.env.CO_CAPTURE_MAX_S ?? 900);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(stop, { force: true });
  const s = await context.newCDPSession(page);
  const index = [];
  let n = 0;
  let size = null;
  s.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const f = `f${String(n++).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, f), Buffer.from(data, 'base64'));
    index.push(`${metadata.timestamp.toFixed(4)} ${f}`);
    size ??= [metadata.deviceWidth, metadata.deviceHeight];
    s.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const nth = Number(process.env.CO_CAPTURE_NTH ?? 1); // 2 halves ~66 fps to ~33
  await s.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: nth });
  const t0 = Date.now();
  while (!fs.existsSync(stop) && Date.now() - t0 < maxS * 1000) await new Promise((r) => setTimeout(r, 200));
  await s.send('Page.stopScreencast').catch(() => {});
  await s.detach().catch(() => {});
  fs.writeFileSync(path.join(dir, 'index.txt'), index.join('\n') + '\n');
  const secs = (Date.now() - t0) / 1000;
  return { dir, frames: n, seconds: secs, fps: +(n / secs).toFixed(1), size, stoppedBy: fs.existsSync(stop) ? 'stop file' : 'max' };
};
