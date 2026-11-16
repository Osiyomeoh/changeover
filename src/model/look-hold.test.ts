import { describe, expect, it } from 'vitest';
import {
  angleToDeg,
  initialLookHold,
  LOOK_HOLD_DEFAULTS as D,
  MAX_ACQUIRE_DT,
  stepLookHold,
  type LookHoldState,
} from './look-hold.js';

const DT = 1 / 72;

/** Run `seconds` of 72 Hz frames at a fixed angle; returns whether the eyes hold at the end. */
function look(s: LookHoldState, seconds: number, angleDeg: number, tracked = true): boolean {
  let held = s.holding;
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) held = stepLookHold(s, { tracked, angleDeg, dt: DT });
  return held;
}

/** A state that already holds the target. */
function held(): LookHoldState {
  const s = initialLookHold();
  look(s, 0.3, 0);
  return s;
}

describe('LookHold: taking hold', () => {
  it('a glance does not hold: 0.2 s on the target is not enough', () => {
    expect(look(initialLookHold(), 0.2, 0)).toBe(false);
  });

  it('resting on the target for 0.3 s takes hold', () => {
    expect(look(initialLookHold(), 0.3, 0)).toBe(true);
  });

  it(`outside the ${D.acquireDeg}° acquire cone it never takes hold`, () => {
    expect(look(initialLookHold(), 5, D.acquireDeg + 1)).toBe(false);
  });

  it('a long frame (a hitch, a hidden tab) never grants a hold', () => {
    const s = initialLookHold();
    expect(stepLookHold(s, { tracked: true, angleDeg: 0, dt: 2 })).toBe(false);
    expect(s.onS).toBe(MAX_ACQUIRE_DT);
    expect(stepLookHold(s, { tracked: true, angleDeg: 0, dt: Infinity })).toBe(false);
  });
});

describe('LookHold: keeping and losing hold (the dead-man rule)', () => {
  it('a blink-length look-away (0.1 s) keeps the hold', () => {
    const s = held();
    expect(look(s, 0.1, 30)).toBe(true);
    expect(look(s, 0.1, 0)).toBe(true);
  });

  it('looking away for 0.2 s drops the hold', () => {
    expect(look(held(), 0.2, 30)).toBe(false);
  });

  it('after a drop the dwell starts again from zero', () => {
    const s = held();
    look(s, 0.2, 30);
    expect(look(s, 0.2, 0)).toBe(false);
    expect(look(s, 0.1, 0)).toBe(true);
  });

  it('losing the eye pose drops the hold on the same frame, with no grace', () => {
    const s = held();
    expect(stepLookHold(s, { tracked: false, angleDeg: 0, dt: DT })).toBe(false);
    expect(s).toEqual(initialLookHold());
  });

  it(`spatial hysteresis: once held, drifting to ${D.keepDeg - 1}° keeps it`, () => {
    expect(look(held(), 2, D.keepDeg - 1)).toBe(true);
  });

  it(`beyond ${D.keepDeg}° counts as looking away`, () => {
    expect(look(held(), 0.2, D.keepDeg + 1)).toBe(false);
  });

  it('a long frame while looking away ends a hold', () => {
    expect(stepLookHold(held(), { tracked: true, angleDeg: 30, dt: 2 })).toBe(false);
    expect(stepLookHold(held(), { tracked: true, angleDeg: 30, dt: Infinity })).toBe(false);
  });

  it('bad inputs are safe: a NaN angle is looking away; NaN or negative dt is no time', () => {
    expect(look(held(), 0.2, NaN)).toBe(false);
    const s = initialLookHold();
    for (let i = 0; i < 100; i++) {
      stepLookHold(s, { tracked: true, angleDeg: 0, dt: NaN });
      stepLookHold(s, { tracked: true, angleDeg: 0, dt: -1 });
    }
    expect(s.holding).toBe(false);
  });
});

describe('angleToDeg', () => {
  const o = { x: 0, y: 0, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  it('measures the angle between the ray and the target', () => {
    expect(angleToDeg(o, fwd, { x: 0, y: 0, z: -2 })).toBeCloseTo(0, 6);
    expect(angleToDeg(o, fwd, { x: 1, y: 0, z: 0 })).toBeCloseTo(90, 6);
    expect(angleToDeg(o, fwd, { x: 0, y: 0, z: 3 })).toBeCloseTo(180, 6);
    expect(angleToDeg(o, fwd, { x: 0, y: 1, z: -1 })).toBeCloseTo(45, 6);
  });
  it('does not need a unit direction', () => {
    expect(angleToDeg(o, { x: 0, y: 0, z: -7 }, { x: 1, y: 0, z: -1 })).toBeCloseTo(45, 6);
  });
  it('is NaN (so: looking away) for a target on the eye or a zero direction', () => {
    expect(angleToDeg(o, fwd, o)).toBeNaN();
    expect(angleToDeg(o, o, fwd)).toBeNaN();
  });
});

describe('LookHold: property — the eyes hold only while tracked and recently on target', () => {
  it('random 300k-frame fuzz against an independent reference', () => {
    let seed = 2026;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const minOnFrames = Math.ceil(D.acquireS / MAX_ACQUIRE_DT);
    let violations = 0;
    let holds = 0;
    let drops = 0;
    for (let trial = 0; trial < 5000; trial++) {
      const s = initialLookHold();
      let sinceKeep = Infinity; // seconds since a tracked frame inside keepDeg
      let onFramesSinceLoss = 0; // tracked frames inside acquireDeg since the pose was last lost
      for (let f = 0; f < 60; f++) {
        const tracked = rnd() > 0.05;
        const angleDeg = rnd() < 0.6 ? rnd() * 6 : rnd() * 40;
        const r = rnd();
        const dt = r < 0.9 ? DT : r < 0.97 ? DT * 4 : 0.5 + rnd() * 3;
        const was = s.holding;
        const now = stepLookHold(s, { tracked, angleDeg, dt });
        if (!tracked) onFramesSinceLoss = 0;
        else if (angleDeg <= D.acquireDeg) onFramesSinceLoss++;
        sinceKeep = tracked && angleDeg <= D.keepDeg ? 0 : sinceKeep + dt;
        if (now !== s.holding) violations++;
        if (now && !tracked) violations++;
        if (now && !(sinceKeep < D.graceS)) violations++;
        if (now && !was) {
          holds++;
          if (!(angleDeg <= D.acquireDeg) || onFramesSinceLoss < minOnFrames) violations++;
        }
        if (was && !now) drops++;
      }
    }
    expect(violations).toBe(0);
    expect(holds).toBeGreaterThan(100);
    expect(drops).toBeGreaterThan(100);
  });
});
