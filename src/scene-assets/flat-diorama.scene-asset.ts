/**
 * Static set for Changeover: a seated-height table carrying a lap-sized model of
 * a two-storey flat, the street line pole and the generator outside. Built only
 * from primitives (no downloaded art). Origin = floor contact under the table's
 * centre. Named meshes are restyled at runtime by PlaySystem:
 *   'window-*'  emissive when the house has power
 *   'street-line' turns red on a refused backfeed
 *   'generator'  glows while it feeds the house
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from '@iwsdk/core';

import { FLAT_OFFSET, GENERATOR_POS, TABLE_D, TABLE_POS, TABLE_TOP_Y, TABLE_W } from '../layout.js';

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, name: string): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.name = name;
  return m;
}

export function createFlatDiorama(): Object3D {
  const root = new Group();
  root.name = 'flat-diorama';

  const wood = new MeshStandardMaterial({ color: 0x5a4030, roughness: 0.85, flatShading: true });
  const wall = new MeshStandardMaterial({ color: 0xc9b79c, roughness: 0.9, flatShading: true });
  const roof = new MeshStandardMaterial({ color: 0x7b3b2a, roughness: 0.8, flatShading: true });
  const metal = new MeshStandardMaterial({ color: 0x55606a, roughness: 0.6, metalness: 0.3 });
  const line = new MeshStandardMaterial({ color: 0x23282c, roughness: 0.7 });
  const genMat = new MeshStandardMaterial({ color: 0x3d6b4a, roughness: 0.6 });

  // Table: top + four legs.
  const top = box(TABLE_W, 0.04, TABLE_D, wood, 'table-top');
  top.position.y = TABLE_TOP_Y - 0.02;
  root.add(top);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const leg = box(0.05, TABLE_TOP_Y - 0.04, 0.05, wood, 'table-leg');
    leg.position.set(sx * (TABLE_W / 2 - 0.06), (TABLE_TOP_Y - 0.04) / 2, sz * (TABLE_D / 2 - 0.06));
    root.add(leg);
  }

  // The flat: two storeys, a roof slab, a door, six windows (one material each,
  // so rooms can light independently).
  const flat = new Group();
  flat.name = 'flat';
  flat.position.set(FLAT_OFFSET.x, TABLE_TOP_Y, FLAT_OFFSET.z);
  const body = box(0.26, 0.18, 0.16, wall, 'flat-body');
  body.position.y = 0.09;
  flat.add(body);
  const slab = box(0.29, 0.015, 0.19, roof, 'flat-roof');
  slab.position.y = 0.1875;
  flat.add(slab);
  const door = box(0.035, 0.06, 0.004, wood, 'flat-door');
  door.position.set(0, 0.03, 0.081);
  flat.add(door);
  let i = 0;
  for (const y of [0.055, 0.135]) {
    for (const x of [-0.085, 0, 0.085]) {
      if (y < 0.1 && x === 0) continue; // door below
      const glass = new MeshStandardMaterial({ color: 0x1a1d22, emissive: 0x000000, roughness: 0.3 });
      const w = box(0.045, 0.035, 0.004, glass, `window-${i++}`);
      w.position.set(x, y, 0.081);
      flat.add(w);
    }
  }
  // One window on the side wall facing the player's right, so light reads at an angle.
  const sideGlass = new MeshStandardMaterial({ color: 0x1a1d22, emissive: 0x000000, roughness: 0.3 });
  const side = box(0.004, 0.035, 0.05, sideGlass, `window-${i++}`);
  side.position.set(0.131, 0.135, 0);
  flat.add(side);
  root.add(flat);

  // Street pole and the line into the house (it glows red if you would backfeed it).
  const pole = new Mesh(new CylinderGeometry(0.006, 0.008, 0.3, 8), metal);
  pole.name = 'street-pole';
  pole.position.set(FLAT_OFFSET.x - 0.2, TABLE_TOP_Y + 0.15, FLAT_OFFSET.z - 0.04);
  root.add(pole);
  const wire = box(0.075, 0.004, 0.004, line, 'street-line');
  wire.position.set(FLAT_OFFSET.x - 0.163, TABLE_TOP_Y + 0.19, FLAT_OFFSET.z - 0.04);
  wire.rotation.z = -0.35;
  root.add(wire);

  // Generator outside, on the player's side of the flat (root sits at TABLE_POS).
  const gen = box(0.07, 0.045, 0.045, genMat, 'generator');
  gen.position.set(GENERATOR_POS.x - TABLE_POS.x, TABLE_TOP_Y + 0.0225, GENERATOR_POS.z - TABLE_POS.z);
  root.add(gen);
  const tank = box(0.05, 0.012, 0.035, metal, 'generator-tank');
  tank.position.set(gen.position.x, TABLE_TOP_Y + 0.051, gen.position.z);
  root.add(tank);

  return root;
}

export default createFlatDiorama();
