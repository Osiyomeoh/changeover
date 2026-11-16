/**
 * Shared layout for a seated player at the origin (eyes ≈ 1.25 m). Pure numbers,
 * no engine imports, so `fov.test.ts` can prove every critical element sits
 * inside the Meta VR Glasses field of view at the design head pose.
 *
 * The scene JSON places the flat-diorama asset at TABLE_POS; keep the two in sync.
 */

/** Table top height above the floor, in the diorama's own frame. */
export const TABLE_TOP_Y = 0.72;
export const TABLE_W = 1.1;
export const TABLE_D = 0.55;

export const TABLE_POS = { x: 0, y: 0, z: -0.45 } as const;
export const TOP_Y = TABLE_POS.y + TABLE_TOP_Y;

/** Seated eye height and the head pose the layout is designed for (look 35° down at the table). */
export const DESIGN_EYE = { x: 0, y: 1.25, z: 0 } as const;
export const DESIGN_PITCH_DEG = -35;

/**
 * Grab targets keep at least this centre-to-centre distance. IWSDK's near grab is a
 * 7 cm sphere centred on the palm (grip space), not the pinch point, and picks the
 * nearest box; measured in IWER, the palm sat 3–5 cm off the hand pose, so 7.5 cm
 * spacing grabbed the neighbour. 10 cm puts every boundary 5 cm from each centre.
 */
export const GRAB_SPACING_M = 0.1;

/**
 * Edge of the invisible cube each token and the cord carry for look-and-pinch.
 * Smaller than GRAB_SPACING_M so neighbouring look-targets never overlap.
 */
export const LOOK_TARGET_M = 0.09;

/** Four circuit slots in a row, between the tray and the changeover board. */
export const SLOT_COUNT = 4;
export const SLOT_Z = -0.41;
export const SLOT_PITCH = 0.1;
export function slotX(i: number): number {
  return (i - (SLOT_COUNT - 1) / 2) * SLOT_PITCH;
}
/** Release within this horizontal distance of a slot centre to plug in. */
export const SLOT_SNAP_M = 0.06;
/** And no higher than this above the table. */
export const SLOT_SNAP_H = 0.14;

/** Token tray: two rows of four along the near edge, GRAB_SPACING_M apart both ways. */
export const TOKEN_COUNT = 8;
export const TRAY_COLS = 4;
export const TRAY_PITCH = GRAB_SPACING_M;
/** Near row first (tokens 0–3), then the far row (4–7). */
export const TRAY_ROW_Z = [-0.21, -0.21 - GRAB_SPACING_M] as const;
export function trayPos(i: number): { x: number; z: number } {
  const col = i % TRAY_COLS;
  const row = Math.floor(i / TRAY_COLS);
  return { x: (col - (TRAY_COLS - 1) / 2) * TRAY_PITCH, z: TRAY_ROW_Z[row] };
}

/** Changeover board centre, and its controls in board-local metres. */
export const BOARD = { x: 0, y: 0.89, z: -0.52 } as const;
export const BOARD_W = 0.3;
export const BOARD_H = 0.22;
export const ISOLATOR_X = -0.08;
export const LEVER_X = 0.08;
/** Board-local y of the lever at OFF; it travels LEVER_SPAN upward to latch ON. */
export const LEVER_Y0 = -0.05;
export const LEVER_SPAN = 0.14;
/** Grab proxies sit this far in front of the board face. */
export const PROXY_Z = 0.05;

/** Status strip directly above the board, tilted to face the design eye. */
export const PANEL_W = 0.28;
export const PANEL_H = 0.1;
export const PANEL_POS = { x: 0, y: BOARD.y + BOARD_H / 2 + 0.01 + PANEL_H / 2, z: BOARD.z } as const;
export const PANEL_TILT_X = -Math.atan2(DESIGN_EYE.y - PANEL_POS.y, DESIGN_EYE.z - PANEL_POS.z);

/** Model generator on the table (world x/z), in front of the flat, clear of the slots. */
export const GENERATOR_POS = { x: -0.30, z: -0.38 } as const;
/** Its pull-cord sits on top of it. */
export const CORD_POS = { x: GENERATOR_POS.x, y: TOP_Y + 0.07, z: GENERATOR_POS.z } as const;

/** End-of-night button (Next night / Retry), mirroring the cord on the right. */
export const NEXT_POS = { x: -CORD_POS.x, y: TOP_Y + 0.04, z: CORD_POS.z } as const;

/** Where hidden interactables wait (the cord on nights without a generator, the
 * button while a night is playing): far below the floor, out of reach and sight. */
export const PARKED_POS = { x: 0, y: -10, z: 0 } as const;

/** Flat model position on the table top, relative to the table centre. */
export const FLAT_OFFSET = { x: -0.36, z: -0.08 } as const;
