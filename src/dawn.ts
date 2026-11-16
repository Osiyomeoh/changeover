/**
 * The dawn reveal. When a night is won, the flat on the table opens into a
 * full-size room around the seated player as the sun comes up: the fridge, the
 * fan over a sleeping child, light through the window. What you kept on is what
 * you see: the fan turns only if it was on at dawn.
 *
 * Pure numbers, no engine imports, so `dawn.test.ts` can check the growth and
 * that the finished room clears the table, the board and the player.
 *
 * Room frame = world frame once the reveal ends: origin on the floor under the
 * seated player, -z ahead, the table at TABLE_POS.
 */
import { FLAT_OFFSET, TABLE_POS, TOP_Y } from './layout.js';

/** Seconds after dawn before the room starts to grow (the dawn chime plays first). */
export const REVEAL_DELAY_S = 1.2;
/** Seconds the growth takes. */
export const REVEAL_GROW_S = 6;
/** The sun starts rising halfway through the growth and takes this long. */
export const SUNRISE_S = 7;

/** Room interior: x in ±halfW, z from `back` to `front`, floor 0 to ceiling `h`. Walls are `wall` thick, outside it. */
export const ROOM = { halfW: 2.2, back: -3.1, front: 1.3, h: 2.7, wall: 0.08 } as const;
/** Window opening in the back wall. */
export const WINDOW = { x0: -0.55, x1: 0.55, y0: 1.0, y1: 2.0 } as const;

/** Furniture footprints in the room frame: centre x/z, width (x) × depth (z), height. */
export const FRIDGE = { x: -1.5, z: -2.72, w: 0.6, d: 0.62, h: 1.7 } as const;
export const MATTRESS = { x: 1.1, z: -2.0, w: 0.95, d: 1.9, h: 0.18 } as const;
/** The child's pillow end of the mattress, towards the back wall. */
export const PILLOW_Z = MATTRESS.z - MATTRESS.d / 2 + 0.22;
/** Standing fan: foot centre, foot radius, hub height. Its head faces +x, towards the pillow, tilted down. */
export const FAN = { x: 0.3, z: PILLOW_Z + 0.05, r: 0.17, h: 0.95, tiltDeg: 36 } as const;
/** The sun disc behind the window: rises from y0 (hidden by the wall) to y1, during the sunrise. */
export const SUN = { x: 0.18, z: ROOM.back - 0.45, y0: 0.7, y1: 1.62, r: 0.14 } as const;
/** The sunbeam through the window slopes down this steeply, so it lands on the floor short of the table. */
export const BEAM_DEG = 40;
/** Peak opacity of the additive sunbeam. */
export const BEAM_OPACITY = 0.16;
/** The room's colour multiplier (linear RGB) as the sun comes up: cool and dim, then warm. */
export const ROOM_TINT0 = [0.62, 0.66, 0.85] as const;
export const ROOM_TINT1 = [1.3, 1.12, 0.9] as const;
/** Warm glow on the room's surfaces at full sunrise, so the shadowed sides are not black. */
export const DAWN_GLOW = 0.1;
/** The sky behind the window multiplies its gradient by this at the start (night), white at full sunrise. */
export const SKY_NIGHT = [0.06, 0.08, 0.18] as const;
/** Fan blade speed in turns per second (only if the fan was on at dawn). */
export const FAN_TURNS_PER_S = 4;
/** Breaths per second of the sleeping child (the blanket rises and falls). */
export const BREATH_HZ = 0.25;

/** Where the flat stands on the table, in the world. The room starts there, at the flat's size. */
export const FLAT_WORLD = { x: TABLE_POS.x + FLAT_OFFSET.x, y: TOP_Y, z: TABLE_POS.z + FLAT_OFFSET.z } as const;
/** Width of the flat model (flat-diorama 'flat-body'). */
export const FLAT_W = 0.26;
/** Start scale: the room is as wide as the flat. */
export const REVEAL_S0 = FLAT_W / (2 * ROOM.halfW);

export interface RevealPose {
  /** Growth progress 0..1. */
  k: number;
  /** Uniform scale of the room. */
  s: number;
  x: number;
  y: number;
  z: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => v * v * (3 - 2 * v);

/** Growth 0..1 at `t` seconds after dawn. */
export function growth(t: number): number {
  return smooth(clamp01((t - REVEAL_DELAY_S) / REVEAL_GROW_S));
}

/** Sunrise 0..1 at `t` seconds after dawn. */
export function sunrise(t: number): number {
  return smooth(clamp01((t - REVEAL_DELAY_S - REVEAL_GROW_S / 2) / SUNRISE_S));
}

/** Seconds from dawn until the reveal is complete. */
export const REVEAL_TOTAL_S = REVEAL_DELAY_S + REVEAL_GROW_S / 2 + SUNRISE_S;

/** The flat model hides once the room has grown out of it. */
export const FLAT_HIDE_K = 0.15;
/**
 * The ceiling and the wall behind the player appear only from this growth on,
 * once the ceiling is above the seated eye and that wall is behind the player.
 * Before then a ceiling would cover the table like a lid, and the near wall
 * would pass through the player's face.
 */
export const NEAR_SHELL_K = 0.8;
/** Height of the ceiling's underside in the world, and z of the near wall's inner face, at a pose. */
export function ceilingY(p: RevealPose): number {
  return p.y + ROOM.h * p.s;
}
export function nearWallZ(p: RevealPose): number {
  return p.z + ROOM.front * p.s;
}

/**
 * Room transform at `t` seconds after dawn, written into `out` (no allocation).
 * The room-frame floor point under the flat, (FLAT_WORLD.x, 0, FLAT_WORLD.z),
 * starts on the table top and sinks to the floor, while the scale grows
 * geometrically from REVEAL_S0 to 1 so the growth reads at a steady rate.
 */
export function revealPose(t: number, out: RevealPose): RevealPose {
  const k = growth(t);
  const s = Math.pow(REVEAL_S0, 1 - k);
  out.k = k;
  out.s = s;
  out.x = FLAT_WORLD.x * (1 - s);
  out.y = FLAT_WORLD.y * (1 - k);
  out.z = FLAT_WORLD.z * (1 - s);
  return out;
}
