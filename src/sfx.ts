/**
 * Procedural sound. Every sound is synthesised with Web Audio at run time: no
 * audio files and no third-party samples. Two beds follow the night (the
 * fridge's compressor hum while it runs, the generator's engine while it feeds
 * the house) and one-shot cues follow model changes (./model/cues.ts).
 *
 * Browsers keep an AudioContext suspended until a user gesture. The Enter XR
 * click is one, so `resume()` is called from pointerdown/keydown and from XR
 * select events. Without Web Audio the game plays silently.
 */
import type { Cue } from './model/cues.js';

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private humGain!: GainNode;
  private engineGain!: GainNode;
  private engineOsc!: OscillatorNode;
  private fridgeOn = false;
  private engineOn = false;
  /** One-shot cues started since construction (for tests and the status mirror). */
  played = 0;
  lastCue: Cue | '' = '';

  constructor() {
    try {
      const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(c.destination);

    // One second of white noise, reused by every noisy sound.
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Fridge bed: 100 Hz (twice 50 Hz mains) with a little 150 Hz.
    this.humGain = c.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);
    for (const [f, g] of [[100, 0.05], [150, 0.015]] as const) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.humGain);
      o.start();
    }

    // Generator bed: a low sawtooth chugging at ~9 Hz, plus filtered noise.
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.connect(this.engineGain);
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 38;
    const chug = c.createGain();
    chug.gain.value = 0.12;
    const lfo = c.createOscillator();
    lfo.frequency.value = 9;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.08;
    lfo.connect(lfoDepth).connect(chug.gain);
    this.engineOsc.connect(chug).connect(lp);
    const rumble = c.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const rg = c.createGain();
    rg.gain.value = 0.05;
    rumble.connect(rg).connect(lp);
    this.engineOsc.start();
    lfo.start();
    rumble.start();
  }

  /** 'running', 'suspended', 'closed' or 'unavailable'. */
  get state(): string {
    return this.ctx?.state ?? 'unavailable';
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  /** Fade the beds to match the night; cheap to call every frame. */
  setBeds(fridge: boolean, engine: boolean): void {
    const c = this.ctx;
    if (!c) return;
    if (fridge !== this.fridgeOn) {
      this.fridgeOn = fridge;
      this.humGain.gain.setTargetAtTime(fridge ? 1 : 0, c.currentTime, 0.15);
    }
    if (engine !== this.engineOn) {
      this.engineOn = engine;
      this.engineGain.gain.setTargetAtTime(engine ? 1 : 0, c.currentTime, engine ? 0.4 : 0.6);
      // Spin up from idle, or wind down as it stops.
      this.engineOsc.frequency.setTargetAtTime(engine ? 38 : 22, c.currentTime, 0.5);
    }
  }

  play(cue: Cue): void {
    this.played++;
    this.lastCue = cue;
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    switch (cue) {
      case 'plug':
        this.click(t, 1800, 0.35);
        this.tone(t, 'sine', 140, 90, 0.07, 0.25);
        break;
      case 'unplug':
        this.click(t, 2600, 0.3);
        break;
      case 'trip':
        this.click(t, 1200, 0.7, 0.04);
        this.tone(t + 0.02, 'sawtooth', 420, 70, 0.45, 0.18);
        break;
      case 'refused':
        this.tone(t, 'square', 110, 110, 0.18, 0.12);
        this.tone(t + 0.26, 'square', 110, 110, 0.18, 0.12);
        break;
      case 'gen-start':
        this.whoosh(t, 0.3, 400, 1600, 0.35);
        break;
      case 'gen-stop':
        this.tone(t, 'sawtooth', 60, 25, 0.8, 0.08);
        break;
      case 'request':
        this.tone(t, 'sine', 880, 880, 0.12, 0.18);
        this.tone(t + 0.14, 'sine', 1175, 1175, 0.16, 0.18);
        break;
      case 'served':
        [660, 880, 1320].forEach((f, i) => this.tone(t + i * 0.08, 'triangle', f, f, 0.14, 0.2));
        break;
      case 'missed':
        this.tone(t, 'triangle', 660, 660, 0.14, 0.14);
        this.tone(t + 0.16, 'triangle', 440, 440, 0.22, 0.14);
        break;
      case 'battery-low':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.2, 'sine', 1000, 1000, 0.08, 0.15);
        break;
      case 'battery-dead':
        this.tone(t, 'sawtooth', 300, 40, 1.0, 0.16);
        break;
      case 'dawn':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(t + i * 0.18, 'triangle', f, f, 1.2, 0.16));
        break;
      case 'spoiled':
        this.tone(t, 'sine', 110, 104, 1.4, 0.22);
        this.tone(t, 'sine', 130.81, 124, 1.4, 0.18);
        break;
    }
  }

  dispose(): void {
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  /** A pitched blip: frequency glides f0 → f1 over `dur` with a fast attack and exponential decay. */
  private tone(t: number, type: Wave, f0: number, f1: number, dur: number, peak: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A short band-passed noise burst: switch contacts. */
  private click(t: number, freq: number, peak: number, dur = 0.02): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5, dur + 0.01);
  }

  /** Noise swept through a band-pass: the pull-cord. */
  private whoosh(t: number, dur: number, f0: number, f1: number, peak: number): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(this.master);
    s.start(t, 0, dur + 0.02);
  }
}
