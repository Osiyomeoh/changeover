import { describe, expect, it } from 'vitest';
import {
  FREE_PLAY,
  initialInterlock,
  stepInterlock,
  type Hand,
  type Holder,
  type InterlockInput,
  type InterlockState,
  type Tracked,
} from './interlock.js';

const both = { left: true, right: true };
const frame = (
  isolatorHolder: Holder | null,
  leverHolder: Hand | null,
  requestedTravel: number,
  tracked: Tracked = both,
): InterlockInput => ({ isolatorHolder, leverHolder, requestedTravel, tracked });

function run(frames: InterlockInput[], s: InterlockState = initialInterlock()) {
  for (const f of frames) s = stepInterlock(s, f);
  return s;
}

/** Left holds isolator, right drags lever from 0 to `to` in 10 steps. */
const throwTo = (to: number): InterlockInput[] =>
  Array.from({ length: 11 }, (_, i) => frame('left', 'right', (to * i) / 10));

describe('interlock: happy path', () => {
  it('starts off and de-energised', () => {
    expect(initialInterlock()).toMatchObject({ phase: 'off', energised: false, travel: 0 });
  });

  it('holding the isolator alone arms but does not energise', () => {
    expect(run([frame('left', null, 0)])).toMatchObject({ phase: 'arming', energised: false });
  });

  it('isolator held + lever thrown fully → latched and energised', () => {
    expect(run(throwTo(1))).toMatchObject({ phase: 'latched', energised: true, travel: 1 });
  });

  it('works with hands swapped (right isolates, left throws)', () => {
    const s = run(Array.from({ length: 11 }, (_, i) => frame('right', 'left', i / 10)));
    expect(s.energised).toBe(true);
  });

  it('once latched, releasing both hands keeps it ON (mechanical latch)', () => {
    const s = run([...throwTo(1), frame(null, null, 0, { left: false, right: false })]);
    expect(s).toMatchObject({ phase: 'latched', energised: true });
  });

  it('mid-throw travel is applied but nothing is energised', () => {
    expect(run(throwTo(0.6))).toMatchObject({ phase: 'throwing', energised: false, travel: 0.6 });
  });
});

describe('interlock: safe failures (never energise on a broken interlock)', () => {
  it('lever hand lost from tracking mid-throw → springs back, reason tracking-lost', () => {
    const s = run([...throwTo(0.7), frame('left', 'right', 0.8, { left: true, right: false })]);
    expect(s).toMatchObject({ travel: 0, energised: false, lastReset: 'tracking-lost' });
  });

  it('isolator hand lost from tracking mid-throw → springs back, tracking-lost', () => {
    const s = run([...throwTo(0.7), frame('left', 'right', 0.8, { left: false, right: true })]);
    expect(s).toMatchObject({ phase: 'off', travel: 0, energised: false, lastReset: 'tracking-lost' });
  });

  it('runtime still reports a holder but the hand is untracked → treated as released', () => {
    // Guards against a stale Grabbed tag after tracking loss.
    const s = run([...throwTo(0.7), frame('left', 'right', 0.99, { left: true, right: false })]);
    expect(s.energised).toBe(false);
  });

  it('lever released mid-throw → springs back, lever-released, still armed', () => {
    const s = run([...throwTo(0.7), frame('left', null, 0)]);
    expect(s).toMatchObject({ phase: 'arming', travel: 0, energised: false, lastReset: 'lever-released' });
  });

  it('isolator released mid-throw → springs back, isolator-released', () => {
    const s = run([...throwTo(0.7), frame(null, 'right', 0.8)]);
    expect(s).toMatchObject({ travel: 0, energised: false, lastReset: 'isolator-released' });
  });

  it('throwing without isolating → lever only wiggles within free play, refused', () => {
    const s = run(Array.from({ length: 11 }, (_, i) => frame(null, 'right', i / 10)));
    expect(s).toMatchObject({ phase: 'off', travel: FREE_PLAY, energised: false, lastReset: 'not-isolated' });
  });

  it('one hand cannot do both (same-hand) → refused', () => {
    const s = run(Array.from({ length: 11 }, (_, i) => frame('right', 'right', i / 10)));
    expect(s).toMatchObject({ energised: false, lastReset: 'same-hand' });
  });

  it('jumping straight to full travel without isolation never latches', () => {
    expect(run([frame(null, 'right', 1)]).energised).toBe(false);
  });

  it('a reset then a clean retry latches (recoverable, not stuck)', () => {
    const s = run([...throwTo(0.7), frame('left', null, 0), ...throwTo(1)]);
    expect(s.energised).toBe(true);
  });

  it('a refusal held for many frames counts once; a fresh attempt counts again', () => {
    const push = Array.from({ length: 8 }, () => frame(null, 'right', 0.5));
    const once = run(push);
    expect(once).toMatchObject({ resets: 1, refusing: true, lastReset: 'not-isolated' });
    expect(run([frame(null, null, 0), ...push], once).resets).toBe(2);
  });

  it('garbage travel (NaN, negative, >1) is clamped, never energises without interlock', () => {
    for (const t of [NaN, -5, 99, Infinity]) {
      expect(run([frame(null, 'right', t)]).energised).toBe(false);
    }
  });
});

const withEyes = { left: true, right: true, eyes: true };
/** The eyes hold the isolator, `hand` drags the lever from 0 to `to` in 10 steps. */
const lookThrowTo = (to: number, hand: Hand = 'right', tracked: Tracked = withEyes): InterlockInput[] =>
  Array.from({ length: 11 }, (_, i) => frame('eyes', hand, (to * i) / 10, tracked));

describe('interlock: look-to-hold (the eyes hold the isolator, a hand throws)', () => {
  it('eyes hold + right hand throws → latched and energised', () => {
    expect(run(lookThrowTo(1))).toMatchObject({ phase: 'latched', energised: true, isolatorHolder: 'eyes', leverHand: 'right' });
  });

  it('one-handed: eyes + the left hand alone, the right hand never tracked', () => {
    const s = run(lookThrowTo(1, 'left', { left: true, right: false, eyes: true }));
    expect(s.energised).toBe(true);
  });

  it('the eyes alone arm the board but never energise', () => {
    expect(run([frame('eyes', null, 1, withEyes)])).toMatchObject({ phase: 'arming', energised: false, travel: 0 });
  });

  it('looking away mid-throw → springs back, reason looked-away', () => {
    const s = run([...lookThrowTo(0.7), frame(null, 'right', 0.8, withEyes)]);
    expect(s).toMatchObject({ phase: 'off', travel: 0, energised: false, lastReset: 'looked-away' });
  });

  it('eye pose lost mid-throw → springs back, reason tracking-lost', () => {
    const s = run([...lookThrowTo(0.7), frame('eyes', 'right', 0.8, { left: true, right: true, eyes: false })]);
    expect(s).toMatchObject({ phase: 'off', travel: 0, energised: false, lastReset: 'tracking-lost' });
  });

  it('a device without eye tracking: an eyes holder counts for nothing', () => {
    const s = run(Array.from({ length: 11 }, (_, i) => frame('eyes', 'right', i / 10, both)));
    expect(s).toMatchObject({ phase: 'off', travel: FREE_PLAY, energised: false, lastReset: 'not-isolated' });
  });

  it('the eyes cannot throw the lever', () => {
    const asLever = 'eyes' as unknown as Hand;
    const s = run(Array.from({ length: 11 }, (_, i) => frame('left', asLever, i / 10, withEyes)));
    expect(s).toMatchObject({ phase: 'arming', travel: 0, energised: false });
  });

  it('the holder that starts a throw must finish it: eyes → hand mid-throw resets', () => {
    const s = run([...lookThrowTo(0.7), frame('left', 'right', 0.8, withEyes)]);
    expect(s).toMatchObject({ phase: 'arming', travel: 0, energised: false, lastReset: 'looked-away', isolatorHolder: 'left' });
    expect(run(throwTo(1), s).energised).toBe(true); // and a clean retry still works
  });

  it('two look-aways in a row are two resets, each with its reason', () => {
    const once = run([...lookThrowTo(0.7), frame(null, 'right', 0.8, withEyes)]);
    const twice = run([...lookThrowTo(0.7), frame(null, 'right', 0.8, withEyes)], once);
    expect(once).toMatchObject({ resets: 1, lastReset: 'looked-away' });
    expect(twice).toMatchObject({ resets: 2, lastReset: 'looked-away', travel: 0 });
  });

  it('once latched, looking away keeps it ON (mechanical latch)', () => {
    const s = run([...lookThrowTo(1), frame(null, null, 0, { left: false, right: false, eyes: false })]);
    expect(s).toMatchObject({ phase: 'latched', energised: true });
  });
});

describe('interlock: property — never energised without a valid two-hand interlock', () => {
  it('random 20k-frame fuzz: energised implies latch was reached via a valid frame', () => {
    // Deterministic LCG so the run is reproducible.
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const hands: (Hand | null)[] = ['left', 'right', null];
    let violations = 0;
    let latches = 0;
    for (let trial = 0; trial < 2000; trial++) {
      let s = initialInterlock();
      for (let f = 0; f < 10; f++) {
        const input = frame(
          hands[Math.floor(rnd() * 3)],
          hands[Math.floor(rnd() * 3)],
          rnd() * 1.2,
          { left: rnd() > 0.15, right: rnd() > 0.15 },
        );
        const prev = s;
        s = stepInterlock(s, input);
        if (s.energised && !prev.energised) {
          latches++;
          const { isolatorHolder: i, leverHolder: l, tracked } = input;
          const valid = i !== null && l !== null && i !== l && tracked[i] && tracked[l];
          if (!valid) violations++;
        }
      }
    }
    expect(violations).toBe(0);
    expect(latches).toBeGreaterThan(0); // the fuzz actually exercised latching
  });

  it('random fuzz with the eyes as a third holder: a hand always throws, a different tracked holder always isolates', () => {
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    // 'eyes' is offered for the lever too (cast), to prove gaze cannot throw it.
    const holders: (Holder | null)[] = ['left', 'right', 'eyes', null];
    const on = (t: Tracked, h: Holder) => (h === 'eyes' ? t.eyes === true : t[h]);
    let violations = 0;
    let eyeLatches = 0;
    let springBacks = 0;
    let handLatches = 0;
    for (let trial = 0; trial < 4000; trial++) {
      let s = initialInterlock();
      for (let f = 0; f < 10; f++) {
        const tracked: Tracked = { left: rnd() > 0.15, right: rnd() > 0.15 };
        if (trial % 4 !== 0) tracked.eyes = rnd() > 0.15; // every 4th trial: a device without eye tracking
        const iso = holders[Math.floor(rnd() * 4)];
        const lev = holders[Math.floor(rnd() * 4)] as Hand | null;
        const input = frame(iso, lev, rnd() * 1.2, tracked);
        const prev = s;
        s = stepInterlock(s, input);
        const valid =
          iso !== null && (lev === 'left' || lev === 'right') && iso !== lev && on(tracked, iso) && tracked[lev];
        if (s.phase === 'throwing' && !valid) violations++;
        // Every spring-back and every new refusal counts exactly once.
        const springBack = prev.phase === 'throwing' && (s.phase === 'off' || s.phase === 'arming');
        const newRefusal = s.refusing && !prev.refusing;
        if (s.resets - prev.resets !== (springBack || newRefusal ? 1 : 0)) violations++;
        if (springBack) springBacks++;
        if (s.energised && !prev.energised) {
          if (!valid) violations++;
          if (iso === 'eyes') eyeLatches++;
          else handLatches++;
        }
      }
    }
    expect(violations).toBe(0);
    expect(eyeLatches).toBeGreaterThan(0);
    expect(handLatches).toBeGreaterThan(0);
    expect(springBacks).toBeGreaterThan(0);
  });
});
