/**
 * Records the managed browser's page as JPEG frames (Chrome DevTools screencast) while
 * scripts/emu-film.py plays the shots, for cutting the video with scripts/film-cut.py.
 * The game's sound comes from scripts/film-audio-tap.mjs when the page was opened with CO_AUDIO_TAP=1
 * (scripts/pw-open.mjs): it is drained twice a second and written as audio.wav (16-bit mono) with
 * audio.json, whose startEpoch is the epoch second the WAV's first sample was heard.
 *
 * Runs until the stop file exists (default .stills-tmp/capture/STOP) or CO_CAPTURE_MAX_S passes.
 * Writes f000000.jpg… and index.txt ("<epoch seconds> <file>" per frame) into CO_CAPTURE_DIR.
 * CO_CAPTURE_NTH=2 keeps every second frame.
 * Usage: CO_CAPTURE_DIR=.stills-tmp/capture iwsdk browser run scripts/film-capture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Places each context's blocks at their epoch time and mixes them into one 16-bit mono WAV. */
function writeAudio(dir, takes) {
  const blocks = takes.flatMap((t) => t.chunks);
  if (!blocks.length) return { audio: 'none', errors: takes.flatMap((t) => t.errors) };
  const rate = takes.find((t) => t.rates.length)?.rates[0];
  const offsets = {};
  for (const id of new Set(blocks.map((b) => b[0]))) {
    const m = takes.flatMap((t) => t.maps).filter((x) => x[0] === id).map((x) => x[1]);
    offsets[id] = median(m) / 1000; // epoch seconds at context time 0
  }
  const placed = blocks.map(([id, f, data]) => {
    const pcm = new Int16Array(new Uint8Array(Buffer.from(data, 'base64')).buffer);
    return { id, f, at: offsets[id] + f / rate, pcm };
  });
  const start = Math.min(...placed.map((p) => p.at));
  const end = Math.max(...placed.map((p) => p.at + p.pcm.length / rate));
  const mix = new Int32Array(Math.ceil((end - start) * rate));
  let gaps = 0;
  const last = {};
  for (const p of placed.sort((a, b) => a.f - b.f)) {
    if (last[p.id] !== undefined && p.f !== last[p.id]) gaps++;
    last[p.id] = p.f + p.pcm.length;
    const o = Math.round((p.at - start) * rate);
    for (let i = 0; i < p.pcm.length && o + i < mix.length; i++) mix[o + i] += p.pcm[i];
  }
  const out = Buffer.alloc(44 + mix.length * 2);
  let peak = 0;
  for (let i = 0; i < mix.length; i++) {
    const v = Math.max(-32768, Math.min(32767, mix[i]));
    peak = Math.max(peak, Math.abs(v));
    out.writeInt16LE(v, 44 + i * 2);
  }
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + mix.length * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(mix.length * 2, 40);
  fs.writeFileSync(path.join(dir, 'audio.wav'), out);
  const info = {
    sampleRate: rate,
    startEpoch: start,
    seconds: +(mix.length / rate).toFixed(2),
    contexts: Object.keys(offsets).length,
    blocks: blocks.length,
    gaps,
    peakDb: peak ? +(20 * Math.log10(peak / 32767)).toFixed(1) : null,
    errors: takes.flatMap((t) => t.errors),
  };
  fs.writeFileSync(path.join(dir, 'audio.json'), JSON.stringify(info, null, 1));
  return info;
}

export default async ({ page, frame, context, workspaceRoot }) => {
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
  const app = frame ?? page.mainFrame();
  const takes = [];
  const drain = async () => {
    const t = await app.evaluate(() => window.__coAudioTap?.take() ?? null).catch(() => null);
    if (t) takes.push(t);
  };
  const t0 = Date.now();
  let lastDrain = 0;
  while (!fs.existsSync(stop) && Date.now() - t0 < maxS * 1000) {
    await new Promise((r) => setTimeout(r, 200));
    if (Date.now() - lastDrain > 500) {
      lastDrain = Date.now();
      await drain();
    }
  }
  await s.send('Page.stopScreencast').catch(() => {});
  await new Promise((r) => setTimeout(r, 300)); // let the last audio block in
  await drain();
  await s.detach().catch(() => {});
  fs.writeFileSync(path.join(dir, 'index.txt'), index.join('\n') + '\n');
  const secs = (Date.now() - t0) / 1000;
  const audio = writeAudio(dir, takes);
  return { dir, frames: n, seconds: secs, fps: +(n / secs).toFixed(1), size, stoppedBy: fs.existsSync(stop) ? 'stop file' : 'max', audio };
};
