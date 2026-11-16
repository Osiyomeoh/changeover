/**
 * Changeover interlock — pure, deterministic state machine (no IWSDK imports).
 *
 * Safety rule modelled (real-world practice): the generator may only feed the
 * house once the house is isolated from the grid. In the game that takes two
 * separate holders: one HOLDS the isolator, a hand THROWS the lever.
 *
 * Look-to-hold: the isolator can be held by either hand or by the eyes.
 * "Your eyes hold the isolator. Your hand throws the lever. Look away and the
 * power stays off." Gaze never acts alone: the lever always needs a tracked
 * hand, and the eyes count only on frames with a tracked eye pose. The timing
 * of an eye hold (dwell to take hold, grace through a blink) lives in
 * ./look-hold.ts; this machine only sees who is holding each frame.
 *
 * Safe-failure rule (Meta hands-only guidance: "a pinch releases when tracking
 * is lost"): until the lever latches, losing either holder — a release, a look
 * away, tracking loss, or one hand trying to do both — springs the lever back
 * to OFF. The holder that starts a throw must finish it. A half-finished throw
 * never energises anything.
 */

export type Hand = 'left' | 'right';

/** Who can hold the isolator: either hand, or the eyes (look-to-hold). */
export type Holder = Hand | 'eyes';

export type InterlockPhase = 'off' | 'arming' | 'throwing' | 'latched';

export type ResetReason =
  | 'lever-released'
  | 'isolator-released'
  | 'looked-away'
  | 'tracking-lost'
  | 'same-hand'
  | 'not-isolated';

/** What the runtime is tracking this frame. */
export interface Tracked {
  left: boolean;
  right: boolean;
  /** A tracked eye pose this frame. Omitted on devices without eye tracking. */
  eyes?: boolean;
}

export interface InterlockInput {
  /** Who is holding the isolator (a pinching hand, or the eyes), or null. */
  isolatorHolder: Holder | null;
  /** Hand currently pinching the lever, or null. Only a hand can throw it. */
  leverHolder: Hand | null;
  /** Lever travel the hand is asking for, 0 (OFF) … 1 (ON). */
  requestedTravel: number;
  tracked: Tracked;
}

export interface InterlockState {
  phase: InterlockPhase;
  /** Lever travel actually applied, 0 … 1. */
  travel: number;
  /** True only when latched: generator feeds the house, grid isolated. */
  energised: boolean;
  /** Who was holding during the current throw (for loss attribution). */
  leverHand: Hand | null;
  isolatorHolder: Holder | null;
  /** Why the most recent throw/attempt was refused (null if none). */
  lastReset: ResetReason | null;
  /**
   * Counts every spring-back and every refused attempt, once each, so callers
   * can react to each one even when two in a row share a reason.
   */
  resets: number;
  /** The lever is being pushed past free play without a valid interlock. */
  refusing: boolean;
}

/** Travel at or beyond which the lever latches ON. */
export const LATCH_AT = 0.95;
/** Without a valid interlock the lever moves at most this far (a "wiggle"). */
export const FREE_PLAY = 0.1;

export function initialInterlock(): InterlockState {
  return {
    phase: 'off',
    travel: 0,
    energised: false,
    leverHand: null,
    isolatorHolder: null,
    lastReset: null,
    resets: 0,
    refusing: false,
  };
}

const clamp01 = (v: number): number =>
  Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;

const isHand = (h: unknown): h is Hand => h === 'left' || h === 'right';
const isHolder = (h: unknown): h is Holder => isHand(h) || h === 'eyes';
const isTracked = (t: Tracked, h: Holder): boolean => (h === 'eyes' ? t.eyes === true : t[h] === true);

function rest(
  s: InterlockState,
  phase: 'off' | 'arming',
  lastReset: ResetReason | null,
  isolatorHolder: Holder | null,
  springBack: boolean,
): InterlockState {
  return {
    phase,
    travel: 0,
    energised: false,
    leverHand: null,
    isolatorHolder,
    lastReset,
    resets: springBack ? s.resets + 1 : s.resets,
    refusing: false,
  };
}

/** Advance one frame. Pure: same (state, input) → same output. */
export function stepInterlock(
  s: InterlockState,
  input: InterlockInput,
): InterlockState {
  // A latched changeover is a mechanical latch, not a held button.
  if (s.phase === 'latched') return s;

  const { tracked } = input;
  // A holder the runtime no longer tracks cannot be holding anything.
  const iso = isHolder(input.isolatorHolder) && isTracked(tracked, input.isolatorHolder) ? input.isolatorHolder : null;
  // The lever needs a hand. Anything else, the eyes included, cannot throw it.
  const lev = isHand(input.leverHolder) && tracked[input.leverHolder] === true ? input.leverHolder : null;
  const travel = clamp01(input.requestedTravel);

  if (s.phase === 'throwing') {
    // Any break in the interlock mid-throw → spring back, attributed.
    const lostLever = lev !== s.leverHand;
    const lostIso = iso !== s.isolatorHolder;
    if (lostLever || lostIso) {
      const vanished =
        (lostLever && s.leverHand !== null && !isTracked(tracked, s.leverHand)) ||
        (lostIso && s.isolatorHolder !== null && !isTracked(tracked, s.isolatorHolder));
      const reason: ResetReason = vanished
        ? 'tracking-lost'
        : lostLever
          ? 'lever-released'
          : s.isolatorHolder === 'eyes'
            ? 'looked-away'
            : 'isolator-released';
      return rest(s, iso ? 'arming' : 'off', reason, iso, true);
    }
  }

  if (lev === null) {
    return rest(s, iso ? 'arming' : 'off', s.lastReset, iso, false);
  }

  if (iso === null || iso === lev) {
    // Lever touched without isolation: it only wiggles within free play.
    const refused = travel > FREE_PLAY;
    return {
      phase: 'off',
      travel: Math.min(travel, FREE_PLAY),
      energised: false,
      leverHand: null,
      isolatorHolder: null,
      lastReset: refused ? (iso === lev ? 'same-hand' : 'not-isolated') : s.lastReset,
      resets: refused && !s.refusing ? s.resets + 1 : s.resets,
      refusing: refused,
    };
  }

  // Valid interlock: isolator held by one tracked holder, lever by a different tracked hand.
  if (travel >= LATCH_AT) {
    return {
      phase: 'latched',
      travel: 1,
      energised: true,
      leverHand: lev,
      isolatorHolder: iso,
      lastReset: null,
      resets: s.resets,
      refusing: false,
    };
  }
  return {
    phase: 'throwing',
    travel,
    energised: false,
    leverHand: lev,
    isolatorHolder: iso,
    lastReset: s.lastReset,
    resets: s.resets,
    refusing: false,
  };
}
