/**
 * Records the game's own sound for the video (scripts/emu-film.py --capture). scripts/pw-open.mjs installs this
 * at document start when CO_AUDIO_TAP=1, and it acts only in a page whose sessionStorage carries the flag
 * pw-open sets, so other runs are unchanged.
 *
 * Every connection to an AudioContext's destination is also connected to an AudioWorklet that copies the
 * mix as it is rendered, 4096 frames at a time, with the context frame each block starts on. The worklet
 * outputs silence (gain 0), so what the page plays is unchanged. getOutputTimestamp() ties the context's clock
 * to the page's epoch clock at the moment the sound leaves the speakers, which is the clock the screencast
 * frames carry. scripts/film-capture.mjs drains window.__coAudioTap.take() while it records.
 */
export const AUDIO_TAP_FLAG = 'changeover.film.audioTap';

export function audioTap(flag) {
  let on = false;
  try {
    on = sessionStorage.getItem(flag) === '1';
  } catch {
    on = false;
  }
  if (!on || window.__coAudioTap) return;
  const N = 4096;
  const worklet = `class T extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(${N}); this.n = 0; this.f = 0; }
  process(inputs) {
    const c = inputs[0] && inputs[0][0];
    if (this.n === 0) this.f = currentFrame;
    if (c) this.b.set(c, this.n);
    this.n += c ? c.length : 128;
    if (this.n >= ${N}) {
      this.port.postMessage({ f: this.f, d: this.b }, [this.b.buffer]);
      this.b = new Float32Array(${N});
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('co-tap', T);`;
  const connect = AudioNode.prototype.connect;
  const taps = new Map();
  const chunks = [];
  const maps = [];
  const errors = [];
  const tapFor = (ctx) => {
    let t = taps.get(ctx);
    if (t) return t;
    t = { id: taps.size, node: null, pending: [] };
    taps.set(ctx, t);
    const url = URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' }));
    ctx.audioWorklet
      .addModule(url)
      .then(() => {
        const node = new AudioWorkletNode(ctx, 'co-tap', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        const mute = ctx.createGain();
        mute.gain.value = 0;
        connect.call(node, mute);
        connect.call(mute, ctx.destination);
        node.port.onmessage = ({ data }) => {
          const ts = ctx.getOutputTimestamp();
          // Epoch milliseconds at context time 0, as heard.
          if (ts.performanceTime > 0) maps.push([t.id, performance.timeOrigin + ts.performanceTime - ts.contextTime * 1000]);
          const x = data.d;
          const pcm = new Int16Array(x.length);
          for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-1, Math.min(1, x[i])) * 32767;
          chunks.push([t.id, data.f, pcm]);
        };
        t.node = node;
        for (const n of t.pending) connect.call(n, node);
        t.pending.length = 0;
      })
      .catch((e) => errors.push(String(e)));
    return t;
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && dest.context === this.context) {
      const t = tapFor(this.context);
      if (t.node) connect.call(this, t.node);
      else t.pending.push(this);
    }
    return r;
  };
  const b64 = (pcm) => {
    const u = new Uint8Array(pcm.buffer);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  window.__coAudioTap = {
    take() {
      const rates = [...taps.keys()].map((c) => c.sampleRate);
      const states = [...taps.keys()].map((c) => c.state);
      return {
        rates,
        states,
        chunks: chunks.splice(0).map(([id, f, pcm]) => [id, f, b64(pcm)]),
        maps: maps.splice(0),
        errors: errors.splice(0),
      };
    },
  };
}
