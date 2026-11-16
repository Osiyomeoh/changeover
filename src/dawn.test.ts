/**
 * The dawn reveal: the room starts as the flat on the table, ends as the room
 * you sit in, never covers the table like a lid, and its furniture clears the
 * table, the board and the seated player.
 */
import { describe, expect, it } from 'vitest';
import {
  BEAM_DEG, FAN, FLAT_HIDE_K, FLAT_W, FLAT_WORLD, FRIDGE, MATTRESS, NEAR_SHELL_K, PILLOW_Z, REVEAL_DELAY_S,
  REVEAL_GROW_S, REVEAL_S0, REVEAL_TOTAL_S, ROOM, SUN, WINDOW, ceilingY, growth, nearWallZ, revealPose,
  sunrise, type RevealPose,
} from './dawn.js';
import { BOARD, BOARD_W, DESIGN_EYE, TABLE_D, TABLE_POS, TABLE_W, TOP_Y } from './layout.js';

const pose = (t: number): RevealPose => revealPose(t, { k: 0, s: 0, x: 0, y: 0, z: 0 });
/** A room-frame point in the world at a pose. */
const world = (p: RevealPose, x: number, y: number, z: number) => ({ x: p.x + p.s * x, y: p.y + p.s * y, z: p.z + p.s * z });
const ts = Array.from({ length: 401 }, (_, i) => (i / 400) * (REVEAL_TOTAL_S + 1));

describe('dawn reveal: growth', () => {
  it('starts as the flat: as wide as the flat, its floor on the table top under the flat', () => {
    for (const t of [0, REVEAL_DELAY_S * 0.5, REVEAL_DELAY_S]) {
      const p = pose(t);
      expect(p.k).toBe(0);
      expect(p.s).toBeCloseTo(REVEAL_S0, 12);
      expect(2 * ROOM.halfW * p.s).toBeCloseTo(FLAT_W, 12);
      const f = world(p, FLAT_WORLD.x, 0, FLAT_WORLD.z);
      expect(f.x).toBeCloseTo(FLAT_WORLD.x, 12);
      expect(f.y).toBeCloseTo(TOP_Y, 12);
      expect(f.z).toBeCloseTo(FLAT_WORLD.z, 12);
    }
  });

  it('starts inside the table top', () => {
    const p = pose(0);
    const a = world(p, -ROOM.halfW - ROOM.wall, 0, ROOM.back - ROOM.wall);
    const b = world(p, ROOM.halfW + ROOM.wall, 0, ROOM.front + ROOM.wall);
    expect(a.x).toBeGreaterThan(TABLE_POS.x - TABLE_W / 2);
    expect(b.x).toBeLessThan(BOARD.x - BOARD_W / 2);
    expect(a.z).toBeGreaterThan(TABLE_POS.z - TABLE_D / 2);
    expect(b.z).toBeLessThan(TABLE_POS.z + TABLE_D / 2);
  });

  it('ends as the room you sit in: identity transform', () => {
    for (const t of [REVEAL_DELAY_S + REVEAL_GROW_S, REVEAL_TOTAL_S, 1e4]) {
      const p = pose(t);
      expect(p.k).toBe(1);
      expect(p.s).toBe(1);
      expect(Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z)).toBe(0);
    }
  });

  it('grows steadily: scale never shrinks, the floor never rises, the flat point stays put', () => {
    let prev = pose(0);
    for (const t of ts) {
      const p = pose(t);
      expect(p.s).toBeGreaterThanOrEqual(prev.s);
      expect(p.y).toBeLessThanOrEqual(prev.y);
      const f = world(p, FLAT_WORLD.x, 0, FLAT_WORLD.z);
      expect(f.x).toBeCloseTo(FLAT_WORLD.x, 9);
      expect(f.z).toBeCloseTo(FLAT_WORLD.z, 9);
      prev = { ...p };
    }
  });

  it('the sun rises after the room starts growing and finishes at the end', () => {
    expect(sunrise(REVEAL_DELAY_S + REVEAL_GROW_S / 2)).toBe(0);
    expect(sunrise(REVEAL_TOTAL_S)).toBe(1);
    expect(growth(REVEAL_DELAY_S)).toBe(0);
  });
});

describe('dawn reveal: never a lid over the table', () => {
  it('the ceiling and near wall appear only once they are above and behind the seated eye', () => {
    const t = ts.find((x) => growth(x) >= NEAR_SHELL_K)!;
    const p = pose(t);
    expect(ceilingY(p)).toBeGreaterThan(DESIGN_EYE.y + 0.3);
    expect(nearWallZ(p)).toBeGreaterThan(DESIGN_EYE.z + 0.35);
    // and stays so for the rest of the reveal
    for (const x of ts.filter((v) => v >= t)) {
      expect(ceilingY(pose(x))).toBeGreaterThan(DESIGN_EYE.y + 0.3);
      expect(nearWallZ(pose(x))).toBeGreaterThan(DESIGN_EYE.z + 0.35);
    }
  });

  it('the flat model hides only after the room is wider than it', () => {
    const t = ts.find((x) => growth(x) >= FLAT_HIDE_K)!;
    expect(2 * ROOM.halfW * pose(t).s).toBeGreaterThan(FLAT_W * 1.5);
  });
});

interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
const overlaps = (a: Box, b: Box, m = 0): boolean =>
  a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
/** Does the segment a→b pass through the box? (slab test) */
function segmentHits(a: number[], b: number[], box: Box): boolean {
  let lo = 0, hi = 1;
  const mins = [box.x0, box.y0, box.z0], maxs = [box.x1, box.y1, box.z1];
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-12) { if (a[i] < mins[i] || a[i] > maxs[i]) return false; continue; }
    let t0 = (mins[i] - a[i]) / d, t1 = (maxs[i] - a[i]) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    if (lo > hi) return false;
  }
  return true;
}
const footprint = (o: { x: number; z: number; w: number; d: number; h: number }): Box =>
  ({ x0: o.x - o.w / 2, x1: o.x + o.w / 2, y0: 0, y1: o.h, z0: o.z - o.d / 2, z1: o.z + o.d / 2 });

const fridge = footprint(FRIDGE);
const bed = { ...footprint(MATTRESS), y1: MATTRESS.h + 0.25 }; // pillow + child
const fan: Box = { x0: FAN.x - FAN.r, x1: FAN.x + 0.3, y0: 0, y1: FAN.h + 0.24, z0: FAN.z - 0.25, z1: FAN.z + 0.25 };
const table: Box = { x0: TABLE_POS.x - TABLE_W / 2, x1: TABLE_POS.x + TABLE_W / 2, y0: 0, y1: TOP_Y + 0.4, z0: TABLE_POS.z - TABLE_D / 2, z1: TABLE_POS.z + TABLE_D / 2 };
/** The table top and the low pieces on it (tokens, slots, the generator), for sight lines. */
const tableTop: Box = { ...table, y0: TOP_Y - 0.04, y1: TOP_Y + 0.08 };
const seat: Box = { x0: -0.45, x1: 0.45, y0: 0, y1: 1.5, z0: -0.4, z1: 0.6 };
const boardAndPanel: Box = { x0: BOARD.x - BOARD_W / 2, x1: BOARD.x + BOARD_W / 2, y0: BOARD.y - 0.11, y1: BOARD.y + 0.22, z0: BOARD.z - 0.03, z1: BOARD.z + 0.03 };
const eye = [DESIGN_EYE.x, DESIGN_EYE.y, DESIGN_EYE.z];
const childHead = [MATTRESS.x, MATTRESS.h + 0.1, PILLOW_Z];
const fanHub = [FAN.x, FAN.h, FAN.z];

describe('dawn room layout', () => {
  const pieces: Array<[string, Box]> = [['fridge', fridge], ['bed', bed], ['fan', fan]];

  it('every piece stands inside the room, against nothing else', () => {
    for (const [name, b] of pieces) {
      expect(b.x0, name).toBeGreaterThan(-ROOM.halfW);
      expect(b.x1, name).toBeLessThan(ROOM.halfW);
      expect(b.z0, name).toBeGreaterThan(ROOM.back);
      expect(b.z1, name).toBeLessThan(ROOM.front);
      expect(b.y1, name).toBeLessThan(ROOM.h);
    }
    expect(overlaps(fridge, bed)).toBe(false);
    expect(overlaps(fridge, fan)).toBe(false);
    expect(overlaps(bed, fan)).toBe(false);
  });

  it('clears the table, the board and the seated player by 10 cm', () => {
    for (const [name, b] of pieces) {
      expect(overlaps(b, table, 0.1), `${name} vs table`).toBe(false);
      expect(overlaps(b, seat, 0.1), `${name} vs seat`).toBe(false);
      expect(overlaps(b, boardAndPanel, 0.1), `${name} vs board`).toBe(false);
    }
  });

  it('the window sits in the back wall, clear of the fridge', () => {
    expect(WINDOW.x0).toBeGreaterThan(-ROOM.halfW);
    expect(WINDOW.x1).toBeLessThan(ROOM.halfW);
    expect(WINDOW.y0).toBeGreaterThan(0.5);
    expect(WINDOW.y1).toBeLessThan(ROOM.h - 0.3);
    expect(fridge.x1).toBeLessThan(WINDOW.x0);
  });

  it('from the seat, the child and the fan are in sight over the table and the board', () => {
    for (const p of [childHead, fanHub]) {
      expect(segmentHits(eye, p, tableTop)).toBe(false);
      expect(segmentHits(eye, p, boardAndPanel)).toBe(false);
    }
  });

  it('the fan points at the child', () => {
    const tilt = (FAN.tiltDeg * Math.PI) / 180;
    const axis = [Math.cos(tilt), -Math.sin(tilt), 0];
    const v = childHead.map((c, i) => c - fanHub[i]);
    const len = Math.hypot(...v);
    const cos = (axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]) / len;
    expect((Math.acos(cos) * 180) / Math.PI).toBeLessThan(12);
  });
});

describe('dawn room: the sunbeam', () => {
  it('lands on the floor short of the table and never reaches the board or the seat', () => {
    const run = 1 / Math.tan((BEAM_DEG * Math.PI) / 180);
    const farthest = ROOM.back + WINDOW.y1 * run; // where the beam's top edge meets the floor
    expect(farthest).toBeLessThan(TABLE_POS.z - TABLE_D / 2 + 0.01);
    // The beam's top face at the board and at the table's back edge is under the floor.
    for (const z of [BOARD.z, TABLE_POS.z - TABLE_D / 2]) expect(WINDOW.y1 - (z - ROOM.back) / run).toBeLessThan(0.01);
  });
  it('the sun starts behind the wall and ends in the window', () => {
    expect(SUN.y0 + SUN.r).toBeLessThan(WINDOW.y0 + 0.05);
    expect(SUN.y1 - SUN.r).toBeGreaterThan(WINDOW.y0);
    expect(SUN.y1 + SUN.r).toBeLessThan(WINDOW.y1);
    expect(Math.abs(SUN.x) + SUN.r).toBeLessThan(WINDOW.x1);
  });
});
