/**
 * LookHold — gaze as a dead-man's switch. Pure and engine-free (no IWSDK or
 * three.js imports), so it can be reused anywhere you have an eye ray.
 *
 * The eyes take hold of a target after resting on it for `acquireS`, and keep
 * hold through gaps shorter than `graceS` (a blink, a dropped frame). When a
 * gap reaches `graceS` the hold drops. Losing the eye pose for good
 * (`tracked: false`, e.g. the eye-tracking source went away) drops it the
 * same frame, with no grace.
 *
 * "On target" has spatial hysteresis: the ray must come within `acquireDeg`
 * of the target's centre to take hold, but once holding it may drift out to
 * `keepDeg` before that counts as looking away.
 *
 * Time is handled asymmetrically, in the safe direction: a long frame (a
 * hitch, a hidden tab) can always end a hold but never grants one, because at
 * most MAX_ACQUIRE_DT of any single frame counts toward acquiring.
 *
 * Deterministic: the same state and input always give the same result. It
 * mutates the state in place so a per-frame call allocates nothing.
 */

export interface LookHoldConfig {
  /** Seconds the eyes must rest on the target before they hold it. */
  acquireS: number;
  /** Seconds of looking away a hold survives (a blink, a dropped frame). */
  graceS: number;
  /** Cone half-angle, in degrees, within which the eyes can take hold. */
  acquireDeg: number;
  /** Wider half-angle within which a hold already taken is kept. */
  keepDeg: number;
}

export const LOOK_HOLD_DEFAULTS: Readonly<LookHoldConfig> = {
  acquireS: 0.25,
  graceS: 0.15,
  acquireDeg: 5,
  keepDeg: 8,
};

/** At most this much of any one frame counts toward acquiring a hold. */
export const MAX_ACQUIRE_DT = 0.05;

export interface LookHoldState {
  holding: boolean;
  /** Seconds the eyes have rested on the target (toward acquireS). */
  onS: number;
  /** Seconds since the eyes were last on the target. */
  offS: number;
}

export interface LookHoldInput {
  /** The runtime has a tracked eye pose this frame. */
  tracked: boolean;
  /** Angle between the eye ray and the direction to the target, in degrees. */
  angleDeg: number;
  /** Seconds since the previous step. */
  dt: number;
}

export function initialLookHold(): LookHoldState {
  return { holding: false, onS: 0, offS: 0 };
}

function drop(s: LookHoldState, offS: number): boolean {
  s.holding = false;
  s.onS = 0;
  s.offS = offS;
  return false;
}

/** Advance one frame; returns whether the eyes hold the target now. */
export function stepLookHold(
  s: LookHoldState,
  input: LookHoldInput,
  cfg: Readonly<LookHoldConfig> = LOOK_HOLD_DEFAULTS,
): boolean {
  // NaN or negative dt counts as no time; +Infinity stays (it can only end a hold).
  const dt = input.dt > 0 ? input.dt : 0;
  if (!input.tracked) return drop(s, 0);

  const cone = s.holding ? cfg.keepDeg : cfg.acquireDeg;
  // NaN fails the comparison, so a broken angle counts as looking away.
  const on = input.angleDeg <= cone;
  if (on) {
    s.offS = 0;
    s.onS += Math.min(dt, MAX_ACQUIRE_DT);
    if (s.onS >= cfg.acquireS) s.holding = true;
    return s.holding;
  }
  const offS = s.offS + dt;
  if (offS >= cfg.graceS) return drop(s, offS);
  s.offS = offS;
  return s.holding;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Angle in degrees between a ray (origin, unit direction) and the direction
 * from the origin to `target`. NaN if the target sits on the origin.
 */
export function angleToDeg(origin: Vec3Like, dir: Vec3Like, target: Vec3Like): number {
  const tx = target.x - origin.x;
  const ty = target.y - origin.y;
  const tz = target.z - origin.z;
  const len = Math.hypot(tx, ty, tz) * Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 0)) return NaN;
  const cos = (tx * dir.x + ty * dir.y + tz * dir.z) / len;
  return (Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos) * 180) / Math.PI;
}
