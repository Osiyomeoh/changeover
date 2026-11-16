/**
 * The room the flat grows into at dawn (see src/dawn.ts). Same flat-shaded box
 * language as the diorama, just full size: walls, a window with the sunrise
 * behind it, the fridge, and a standing fan over a sleeping child (a generic
 * figure: a blanket and a head, no face).
 *
 * Origin = the floor under the seated player, -z ahead. Hidden until dawn; the
 * PlaySystem scales and places it. Static parts are merged by hand into a few
 * vertex-coloured meshes sharing one material, so the room costs ~9 draw calls.
 *
 * Named parts the PlaySystem drives: room-shell-near (ceiling + wall behind
 * you, shown late), room-child-blanket (breathes), room-fan-blades (turn if the
 * fan was on), room-fridge-led (lit if the fridge was on), room-sky, room-sun,
 * room-sunbeam.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from '@iwsdk/core';
import { BEAM_DEG, FAN, FRIDGE, MATTRESS, PILLOW_Z, ROOM, SUN, WINDOW } from '../dawn.js';

interface Part { g: BufferGeometry; m: Matrix4; c: number }
const _q = new Quaternion();
const _e = new Euler();
const _v = new Vector3();
const _one = new Vector3(1, 1, 1);
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 =>
  new Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _one);
/** A box of size w×h×d centred at (x, y, z). */
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number): Part =>
  ({ g: new BoxGeometry(w, h, d), m: at(x, y, z), c });
/** A box spanning [x0,x1]×[y0,y1]×[z0,z1]. */
const span = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): Part =>
  box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, c);

/** Merge parts into one non-indexed geometry with per-part vertex colours (position, normal, color). */
function merge(parts: Part[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (const p of parts) {
    const g = (p.g.index ? p.g.toNonIndexed() : p.g).applyMatrix4(p.m);
    c.set(p.c); // sRGB hex → linear working colour
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
    p.g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  out.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function named<T extends Mesh | Group>(o: T, name: string): T {
  o.name = name;
  return o;
}
const meshOf = (name: string, parts: Part[], mat: Material): Mesh => named(new Mesh(merge(parts), mat), name);

const WALL = 0xc9b79c; // the diorama's wall colour
const CEILING = 0xe2d8c6;
const FLOOR = 0x6e5440;
const WOOD = 0x5a4030;
const FRIDGE_C = 0xe6e3da;
const SEAM = 0x6a6a6a;
const SHEET = 0x3f6f8f;
const PILLOW = 0xf0ebe0;
const BLANKET = 0xd9a441;
const SKIN = 0x5a3a28;
const FAN_DARK = 0x2b2b2b;
const FAN_BODY = 0x3a6ea5;
const BLADE = 0x9cc4e6;

/** Room shell, far side: floor, back wall with the window opening, side walls, window frame and sill. */
function shellFar(): Part[] {
  const { halfW: W, back: B, front: F, h: H, wall: T } = ROOM;
  const { x0, x1, y0, y1 } = WINDOW;
  const f = 0.05; // frame bar
  return [
    span(-W - T, W + T, -0.04, 0, B - T, F + T, FLOOR),
    span(-W - T, x0, 0, H, B - T, B, WALL),
    span(x1, W + T, 0, H, B - T, B, WALL),
    span(x0, x1, 0, y0, B - T, B, WALL),
    span(x0, x1, y1, H, B - T, B, WALL),
    span(-W - T, -W, 0, H, B, F, WALL),
    span(W, W + T, 0, H, B, F, WALL),
    span(x0 - f, x0, y0, y1, B - T, B + 0.02, WOOD),
    span(x1, x1 + f, y0, y1, B - T, B + 0.02, WOOD),
    span(x0 - f, x1 + f, y1, y1 + f, B - T, B + 0.02, WOOD),
    span(x0 - f, x1 + f, y0 - 0.03, y0, B - T, B + 0.08, WOOD), // sill
    span(-0.006, 0.006, y0, y1, B - T / 2 - 0.005, B - T / 2 + 0.005, WOOD), // mullion
  ];
}

/** Ceiling and the wall behind the player (shown late; see NEAR_SHELL_K). */
function shellNear(): Part[] {
  const { halfW: W, back: B, front: F, h: H, wall: T } = ROOM;
  return [span(-W - T, W + T, H, H + 0.04, B - T, F + T, CEILING), span(-W - T, W + T, 0, H, F, F + T, WALL)];
}

/** Fridge, mattress, pillow, the child's head, the fan's foot, pole and motor. */
function props(): Part[] {
  const { x, z, w, d, h } = FRIDGE;
  const front = z + d / 2;
  const tilt = (-FAN.tiltDeg * Math.PI) / 180;
  /** A part in the fan head's frame: origin at the hub, +x the way the fan blows. */
  const hub = (ox: number, g: BufferGeometry, c: number, ry = 0, rz = 0): Part =>
    ({ g, m: at(FAN.x, FAN.h, FAN.z, 0, 0, tilt).multiply(at(ox, 0, 0, 0, ry, rz)), c });
  return [
    span(x - w / 2, x + w / 2, 0.06, h, z - d / 2, front, FRIDGE_C),
    span(x - w / 2 + 0.02, x + w / 2 - 0.02, 0, 0.06, z - d / 2 + 0.03, front - 0.04, SEAM), // plinth
    span(x - w / 2 + 0.01, x + w / 2 - 0.01, h * 0.64, h * 0.64 + 0.012, front, front + 0.006, SEAM), // door seam
    span(x + w / 2 - 0.07, x + w / 2 - 0.05, h * 0.3, h * 0.58, front, front + 0.03, SEAM), // handle
    span(MATTRESS.x - MATTRESS.w / 2, MATTRESS.x + MATTRESS.w / 2, 0, MATTRESS.h, MATTRESS.z - MATTRESS.d / 2, MATTRESS.z + MATTRESS.d / 2, SHEET),
    box(0.55, 0.09, 0.3, MATTRESS.x, MATTRESS.h + 0.045, PILLOW_Z - 0.02, PILLOW),
    { g: new SphereGeometry(0.085, 12, 8), m: at(MATTRESS.x, MATTRESS.h + 0.1, PILLOW_Z + 0.04), c: SKIN },
    { g: new CylinderGeometry(FAN.r, FAN.r, 0.03, 16), m: at(FAN.x, 0.015, FAN.z), c: FAN_DARK },
    { g: new CylinderGeometry(0.014, 0.014, FAN.h - 0.03, 8), m: at(FAN.x, FAN.h / 2, FAN.z), c: FAN_DARK },
    hub(-0.07, new CylinderGeometry(0.06, 0.05, 0.14, 12), FAN_BODY, 0, Math.PI / 2),
    hub(0.035, new TorusGeometry(0.2, 0.006, 6, 28), FAN_DARK, Math.PI / 2),
    hub(0.09, new TorusGeometry(0.2, 0.006, 6, 28), FAN_DARK, Math.PI / 2),
  ];
}

/** The light through the window: a prism from the window opening down to the floor, plus the patch it lights. */
function beamGeometry(): BufferGeometry {
  const { x0, x1, y0, y1 } = WINDOW;
  const B = ROOM.back;
  const run = 1 / Math.tan((BEAM_DEG * Math.PI) / 180);
  const f = 0.004; // just above the floor
  const w = (x: number, y: number): number[] => [x, y, B];
  const g = (x: number, y: number): number[] => [x, f, B + y * run];
  const quads = [
    [g(x0, y0), g(x1, y0), g(x1, y1), g(x0, y1)], // floor patch
    [w(x0, y0), w(x0, y1), g(x0, y1), g(x0, y0)],
    [w(x1, y0), w(x1, y1), g(x1, y1), g(x1, y0)],
    [w(x0, y1), w(x1, y1), g(x1, y1), g(x0, y1)],
    [w(x0, y0), w(x1, y0), g(x1, y0), g(x0, y0)],
  ];
  const pos: number[] = [];
  for (const [a, b, c, d] of quads) pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createDawnRoom(): Group {
  const root = named(new Group(), 'dawn-room');
  const mat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
  mat.name = 'room-mat';
  mat.emissive.set(0xffa860);
  mat.emissiveIntensity = 0;

  root.add(meshOf('room-shell', shellFar(), mat));
  root.add(meshOf('room-shell-near', shellNear(), mat));
  root.add(meshOf('room-props', props(), mat));

  // The child's blanket, its origin on the mattress so a y-scale is a breath.
  const blanket = meshOf('room-child-blanket', [
    box(0.62, 0.07, 0.98, 0, 0.035, 0, BLANKET),
    box(0.34, 0.06, 0.62, 0, 0.09, -0.1, BLANKET),
  ], mat);
  blanket.position.set(MATTRESS.x, MATTRESS.h, PILLOW_Z + 0.62);
  root.add(blanket);

  // Fan head frame at the hub, tilted down towards the child; the blades turn about its x axis.
  const head = named(new Group(), 'room-fan-head');
  head.position.set(FAN.x, FAN.h, FAN.z);
  head.rotation.z = (-FAN.tiltDeg * Math.PI) / 180;
  const blades: Part[] = [{ g: new SphereGeometry(0.03, 8, 6), m: at(0, 0, 0), c: FAN_BODY }];
  for (let i = 0; i < 3; i++) {
    blades.push({ g: new BoxGeometry(0.008, 0.16, 0.08), m: at(0, 0, 0, (i * 2 * Math.PI) / 3).multiply(at(0, 0.1, 0, 0, 0.35)), c: BLADE });
  }
  const spin = meshOf('room-fan-blades', blades, mat);
  spin.position.x = 0.062;
  head.add(spin);
  root.add(head);

  const led = named(new Mesh(new BoxGeometry(0.03, 0.012, 0.006), new MeshBasicMaterial({ color: 0x40ff70 })), 'room-fridge-led');
  led.position.set(FRIDGE.x - FRIDGE.w / 2 + 0.08, FRIDGE.h * 0.8, FRIDGE.z + FRIDGE.d / 2 + 0.004);
  root.add(led);

  // Sky behind the window: a fixed dawn gradient; the PlaySystem dims it via the material colour.
  const skyGeo = new PlaneGeometry(2.4, 2.0, 1, 4);
  const top = new Color(0x8fb4dc);
  const low = new Color(0xffb36b);
  const sc = new Color();
  const P = skyGeo.getAttribute('position');
  const skyCol = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) sc.copy(low).lerp(top, (P.getY(i) + 1) / 2).toArray(skyCol, i * 3);
  skyGeo.setAttribute('color', new BufferAttribute(skyCol, 3));
  const sky = named(new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true })), 'room-sky');
  sky.position.set(0, (WINDOW.y0 + WINDOW.y1) / 2, ROOM.back - 0.6);
  root.add(sky);

  const sun = named(new Mesh(new CircleGeometry(SUN.r, 24), new MeshBasicMaterial({ color: 0xffd27a })), 'room-sun');
  sun.position.set(SUN.x, SUN.y1, SUN.z);
  root.add(sun);

  const beamMat = new MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const beam = named(new Mesh(beamGeometry(), beamMat), 'room-sunbeam');
  beam.userData.iwsdkPreviewBounds = 'exclude';
  root.add(beam);
  return root;
}

export default createDawnRoom();
