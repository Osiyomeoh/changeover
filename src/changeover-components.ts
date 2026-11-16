import { createComponent, Types } from '@iwsdk/core';

/** Marks the grabbable proxy for one part of the changeover switch. */
export const SwitchPart = createComponent('SwitchPart', {
  role: { type: Types.String, default: 'lever', help: "'isolator' or 'lever'" },
});

/**
 * Live interlock state, mirrored from the pure model every frame so it can be
 * read by the HUD and by emulator tests (`iwsdk ecs query`).
 */
export const InterlockStatus = createComponent('InterlockStatus', {
  phase: { type: Types.String, default: 'off' },
  travel: { type: Types.Float32, default: 0 },
  energised: { type: Types.Boolean, default: false },
  lastReset: { type: Types.String, default: '' },
  isolatorHolder: { type: Types.String, default: '' },
  leverHolder: { type: Types.String, default: '' },
  leftTracked: { type: Types.Boolean, default: false },
  rightTracked: { type: Types.Boolean, default: false },
  eyesTracked: { type: Types.Boolean, default: false, help: 'the device gives a tracked eye pose this frame' },
  eyesHolding: { type: Types.Boolean, default: false, help: 'look-to-hold: the eyes hold the isolator' },
  eyesAngle: { type: Types.Float32, default: -1, help: 'degrees from the eye ray to the isolator; -1 without a tracked eye pose' },
  resets: { type: Types.Int16, default: 0, help: 'refused or reset throws since load' },
});

/** An appliance token the player pinches onto a circuit slot. */
export const Token = createComponent('Token', {
  applianceId: { type: Types.String, default: '' },
  /** Circuit slot index, or -1 when resting in the tray. */
  slot: { type: Types.Int8, default: -1 },
});

/** The generator's pull-cord: pinching it tries to start the generator. */
export const GeneratorCord = createComponent('GeneratorCord', {});

/** The table button shown once a night ends: Next night, Retry or Play again. */
export const NextButton = createComponent('NextButton', {});

/** Live night state, mirrored for the HUD and for emulator tests. */
export const PlayStatus = createComponent('PlayStatus', {
  started: { type: Types.Boolean, default: false },
  clock: { type: Types.String, default: '' },
  elapsedH: { type: Types.Float32, default: 0 },
  remainingWh: { type: Types.Float32, default: 0 },
  loadW: { type: Types.Float32, default: 0 },
  source: { type: Types.String, default: 'battery' },
  fuelH: { type: Types.Float32, default: 0 },
  on: { type: Types.String, default: '', help: 'comma-separated appliance ids' },
  trips: { type: Types.Int16, default: 0 },
  backfeedRefusals: { type: Types.Int16, default: 0 },
  outcome: { type: Types.String, default: 'playing' },
  stars: { type: Types.Int8, default: 0 },
  streak: { type: Types.Int16, default: 0, help: 'Daily Outage streak as it stands today' },
  streakBest: { type: Types.Int16, default: 0 },
  lookSelects: { type: Types.Int16, default: 0, help: 'look-and-pinch selections this night' },
  lastLookSource: { type: Types.String, default: '', help: "'gaze', 'ray' or '' (pointer that made the last look-select)" },
  caption: { type: Types.String, default: '' },
  mode: { type: Types.String, default: 'night', help: "'night' (Nights 1–5) or 'daily'" },
  night: { type: Types.Int8, default: 0, help: 'campaign night 1–5; 0 in the Daily Outage' },
  resumed: { type: Types.Boolean, default: false, help: 'this night was restored after a reload' },
  progress: { type: Types.String, default: '', help: 'best stars per night, e.g. 3,1,0,0,0' },
  hasGenerator: { type: Types.Boolean, default: true },
  nextLabel: { type: Types.String, default: '', help: "the end-of-night button's label; '' while playing" },
  audio: { type: Types.String, default: '', help: "AudioContext state: 'running', 'suspended', 'closed' or 'unavailable'" },
  cues: { type: Types.Int16, default: 0, help: 'sound cues played this night' },
  recentCues: { type: Types.String, default: '', help: 'the last few cues, newest last, e.g. plug,request,served' },
  regainedIgnored: { type: Types.Int16, default: 0, help: 'one-shot pinches ignored this night because the hand had just regained tracking' },
  reveal: { type: Types.Float32, default: -1, help: 'dawn reveal: how far the room has grown, 0–1, after a won night; -1 otherwise' },
  revealOn: { type: Types.String, default: '', help: "what runs in the dawn room: 'fridge', 'fan', 'fridge,fan' or ''" },
});

/**
 * An invisible look-target that follows a token or the generator cord, so gaze
 * (or a hand ray on devices without eye tracking) plus a pinch can act on it.
 * A separate entity because hand-grab objects refuse ray pointers, and gaze is
 * a ray pointer.
 */
export const GazeTarget = createComponent('GazeTarget', {
  kind: { type: Types.String, default: 'token', help: "'token', 'cord' or 'next'" },
  /** Index into the token list; -1 for the cord and the next button. */
  index: { type: Types.Int8, default: -1 },
});
