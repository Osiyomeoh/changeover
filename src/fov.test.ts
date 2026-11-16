/**
 * Glasses FoV fit: every element the player must see or touch lies inside the
 * Meta VR Glasses view at the design head pose (seated, looking 35° down).
 *
 * Mask source: IWER 2.7.0 (MIT), node_modules/iwer/lib/device/configs/headset/meta.js,
 * `metaVRGlassesVisibilityMask`: "Angular bounds sampled from Meta VR Glasses XRView
 * projection matrices": 37° left, 37° right, 25° up, 43° down, same for both eyes.
 * Treating each element as an axis-aligned box and testing its 8 corners is
 * conservative for the convex view frustum.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD,
  BOARD_H,
  BOARD_W,
  CORD_POS,
  DESIGN_EYE,
  DESIGN_PITCH_DEG,
  GRAB_SPACING_M,
  ISOLATOR_X,
  LEVER_SPAN,
  LEVER_X,
  LEVER_Y0,
  LOOK_TARGET_M,
  NEXT_POS,
  PANEL_H,
  PANEL_POS,
  PANEL_TILT_X,
  PANEL_W,
  PROXY_Z,
  SLOT_COUNT,
  SLOT_Z,
  TOKEN_COUNT,
  TOP_Y,
  slotX,
  trayPos,
} from './layout.js';

const MASK = { left: 37, right: 37, up: 25, down: 43 };
/** Keep at least this much angular slack at the design pose. */
const MARGIN_DEG = 1.5;

type V = [number, number, number];
const deg = (r: number) => (r * 180) / Math.PI;

function corners(c: V, h: V): V[] {
  const out: V[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push([c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]]);
  }
  return out;
}

/** Horizontal and vertical view angles (degrees) of a point for a head pitched by `pitchDeg`. */
function viewAngles(p: V, pitchDeg: number): { h: number; v: number } {
  const a = (pitchDeg * Math.PI) / 180;
  const d: V = [p[0] - DESIGN_EYE.x, p[1] - DESIGN_EYE.y, p[2] - DESIGN_EYE.z];
  const fwd = d[1] * Math.sin(a) - d[2] * Math.cos(a);
  const up = d[1] * Math.cos(a) + d[2] * Math.sin(a);
  return { h: deg(Math.atan2(d[0], fwd)), v: deg(Math.atan2(up, fwd)) };
}

/** Worst overshoot past the mask (negative = inside with that much slack). */
function overshoot(pts: V[], pitchDeg: number): number {
  let worst = -Infinity;
  for (const p of pts) {
    const { h, v } = viewAngles(p, pitchDeg);
    worst = Math.max(worst, h - MASK.right, -h - MASK.left, v - MASK.up, -v - MASK.down);
  }
  return worst;
}

function panelCorners(): V[] {
  // The panel is a plane tilted about x by PANEL_TILT_X.
  const out: V[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const ly = (sy * PANEL_H) / 2;
    out.push([
      PANEL_POS.x + (sx * PANEL_W) / 2,
      PANEL_POS.y + ly * Math.cos(PANEL_TILT_X),
      PANEL_POS.z + ly * Math.sin(PANEL_TILT_X),
    ]);
  }
  return out;
}

const critical: Array<[string, V[]]> = [
  ...Array.from({ length: TOKEN_COUNT }, (_, i): [string, V[]] => [
    `token ${i}`,
    corners([trayPos(i).x, TOP_Y + 0.04, trayPos(i).z], [0.035, 0.04, 0.035]),
  ]),
  ...Array.from({ length: SLOT_COUNT }, (_, i): [string, V[]] => [
    `slot ${i}`,
    corners([slotX(i), TOP_Y + 0.01, SLOT_Z], [0.04, 0.01, 0.04]),
  ]),
  ['isolator', corners([BOARD.x + ISOLATOR_X, BOARD.y, BOARD.z + PROXY_Z], [0.03, 0.04, 0.02])],
  ['lever at OFF', corners([BOARD.x + LEVER_X, BOARD.y + LEVER_Y0, BOARD.z + PROXY_Z], [0.03, 0.02, 0.02])],
  ['lever at ON', corners([BOARD.x + LEVER_X, BOARD.y + LEVER_Y0 + LEVER_SPAN, BOARD.z + PROXY_Z], [0.03, 0.02, 0.02])],
  ['board face', corners([BOARD.x, BOARD.y, BOARD.z], [BOARD_W / 2, BOARD_H / 2, 0.01])],
  ['generator cord + label', corners([CORD_POS.x, CORD_POS.y + 0.01, CORD_POS.z], [0.04, 0.03, 0.02])],
  // The end-of-night button: a 0.1 × 0.0375 m plate inside a 0.07 m grab box.
  ['next-night button', corners([NEXT_POS.x, NEXT_POS.y, NEXT_POS.z], [0.05, 0.035, 0.035])],
  ['status panel', panelCorners()],
];

describe('Meta VR Glasses FoV fit at the design pose', () => {
  it.each(critical)('%s is inside the mask with margin', (_name, pts) => {
    expect(overshoot(pts, DESIGN_PITCH_DEG)).toBeLessThanOrEqual(-MARGIN_DEG);
  });

  it('everything still fits within ±3° of the design pitch', () => {
    for (const dp of [-3, 3]) {
      for (const [, pts] of critical) expect(overshoot(pts, DESIGN_PITCH_DEG + dp)).toBeLessThanOrEqual(0);
    }
  });

  it('the panel faces the design eye', () => {
    // Normal of a +z plane rotated by x: (0, -sin t, cos t); eye direction from panel centre.
    const n: V = [0, -Math.sin(PANEL_TILT_X), Math.cos(PANEL_TILT_X)];
    const e: V = [DESIGN_EYE.x - PANEL_POS.x, DESIGN_EYE.y - PANEL_POS.y, DESIGN_EYE.z - PANEL_POS.z];
    const len = Math.hypot(...e);
    expect((n[0] * e[0] + n[1] * e[1] + n[2] * e[2]) / len).toBeGreaterThan(0.999);
  });

  it('every pair of grab targets is at least GRAB_SPACING_M apart', () => {
    // Centres of everything a hand can grab: tokens at home and plugged in, the
    // isolator, the lever across its travel, the generator cord and the end-of-night button.
    const targets: Array<[string, V]> = [
      ...Array.from({ length: TOKEN_COUNT }, (_, i): [string, V] => [`token ${i}`, [trayPos(i).x, TOP_Y + 0.03, trayPos(i).z]]),
      ...Array.from({ length: SLOT_COUNT }, (_, i): [string, V] => [`plugged ${i}`, [slotX(i), TOP_Y + 0.036, SLOT_Z]]),
      ['isolator', [BOARD.x + ISOLATOR_X, BOARD.y, BOARD.z + PROXY_Z]],
      ...[0, 0.5, 1].map((t): [string, V] => [`lever ${t}`, [BOARD.x + LEVER_X, BOARD.y + LEVER_Y0 + t * LEVER_SPAN, BOARD.z + PROXY_Z]]),
      ['cord', [CORD_POS.x, CORD_POS.y, CORD_POS.z]],
      ['next', [NEXT_POS.x, NEXT_POS.y, NEXT_POS.z]],
    ];
    const close: string[] = [];
    for (let a = 0; a < targets.length; a++) {
      for (let b = a + 1; b < targets.length; b++) {
        const [na, pa] = targets[a];
        const [nb, pb] = targets[b];
        if (na.startsWith('lever') && nb.startsWith('lever')) continue; // one object
        const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
        if (d < GRAB_SPACING_M - 1e-9) close.push(`${na}–${nb} ${d.toFixed(3)}`);
      }
    }
    expect(close).toEqual([]);
  });

  // Look-targets: every token at home and plugged in, the cord and the end-of-night button.
  const lookTargets: Array<[string, V]> = [
    ...Array.from({ length: TOKEN_COUNT }, (_, i): [string, V] => [`token ${i}`, [trayPos(i).x, TOP_Y + 0.03, trayPos(i).z]]),
    ...Array.from({ length: SLOT_COUNT }, (_, i): [string, V] => [`plugged ${i}`, [slotX(i), TOP_Y + 0.036, SLOT_Z]]),
    ['cord', [CORD_POS.x, CORD_POS.y, CORD_POS.z]],
    ['next', [NEXT_POS.x, NEXT_POS.y, NEXT_POS.z]],
  ];

  it('look-target cubes never overlap', () => {
    // Axis-aligned cubes of edge L overlap only if every axis gap is below L.
    const overlaps: string[] = [];
    for (let a = 0; a < lookTargets.length; a++) {
      for (let b = a + 1; b < lookTargets.length; b++) {
        const [na, pa] = lookTargets[a];
        const [nb, pb] = lookTargets[b];
        const gap = Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2]));
        if (gap < LOOK_TARGET_M) overlaps.push(`${na}–${nb} ${gap.toFixed(3)}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('looking straight at any look-target leaves every other one outside the gaze cone', () => {
    // IWSDK 1.0.1 GazeSystem `coneAngle` default: 5° half-angle
    // (node_modules/@iwsdk/core/dist/gaze/gaze-system.d.ts). Not overridden in iwsdk.config.json.
    const CONE_HALF_DEG = 5;
    const dir = (p: V): V => {
      const d: V = [p[0] - DESIGN_EYE.x, p[1] - DESIGN_EYE.y, p[2] - DESIGN_EYE.z];
      const l = Math.hypot(...d);
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    let min = Infinity;
    for (let a = 0; a < lookTargets.length; a++) {
      for (let b = a + 1; b < lookTargets.length; b++) {
        const u = dir(lookTargets[a][1]);
        const v = dir(lookTargets[b][1]);
        min = Math.min(min, deg(Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))));
      }
    }
    expect(min).toBeGreaterThan(CONE_HALF_DEG);
    expect(min).toBeCloseTo(7.75, 1); // measured: far-row token vs the slot behind it
  });

  it('the old layout (panel at 1.30 m, tray at 0.215 m) did NOT fit, so this test can fail', () => {
    const oldPanel = corners([0, 1.3, -0.46], [0.12, 0.076, 0]);
    expect(overshoot(oldPanel, DESIGN_PITCH_DEG)).toBeGreaterThan(0);
  });
});
