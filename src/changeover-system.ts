/**
 * The changeover interlock on a board on the table.
 *
 * Each grabbable part is an invisible-ish *proxy* (collider bigger than the
 * visual, per Meta hands-only guidance). The proxy follows the pinching hand;
 * the pure model in ./model/interlock.ts decides how far the visible lever is
 * actually allowed to move. On release or tracking loss the proxy snaps back
 * to the lever's applied position.
 *
 * Look-to-hold: on a device with eye tracking the eyes can hold the isolator
 * instead of a hand (./model/look-hold.ts decides when they hold). The eye
 * ray is read from the raw tracked eye pose, not from Hovered: IWSDK's gaze
 * pointer stops hovering while a hand is near-grabbing (its
 * suppressWhenDirectPointerActive default), which is exactly when the other
 * hand is on the lever.
 */
import {
  BoxGeometry,
  createSystem,
  Quaternion,
  Vector3,
  Grabbed,
  GrabSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneHandGrabbable,
  type Entity,
} from '@iwsdk/core';
import { InterlockStatus, SwitchPart } from './changeover-components.js';
import {
  initialInterlock,
  stepInterlock,
  type Hand,
  type InterlockInput,
  type InterlockState,
  type ResetReason,
} from './model/interlock.js';
import { angleToDeg, initialLookHold, LOOK_HOLD_DEFAULTS, stepLookHold } from './model/look-hold.js';
import { BOARD, BOARD_H, BOARD_W, ISOLATOR_X, LEVER_SPAN, LEVER_X, LEVER_Y0, PROXY_Z, TOP_Y } from './layout.js';

/** World centre of the isolator knob's front face: where the eyes must rest. */
const ISO_FACE = { x: BOARD.x + ISOLATOR_X, y: BOARD.y, z: BOARD.z + 0.05 } as const;
const EYE_HOLD_GLOW = 0x5fd4ff; // the look ring's colour in PlaySystem

export class ChangeoverSystem extends createSystem({
  parts: { required: [SwitchPart] },
}) {
  private model: InterlockState = initialInterlock();
  private input$: InterlockInput = {
    isolatorHolder: null,
    leverHolder: null,
    requestedTravel: 0,
    tracked: { left: false, right: false, eyes: false },
  };
  private look = initialLookHold();
  private eyesAngle = NaN;
  private eyePos = new Vector3();
  private eyeQuat = new Quaternion();
  private eyeDir = new Vector3();
  private isoMat!: MeshStandardMaterial;
  private board!: Group;
  private leverKnob!: Mesh;
  private leverProxy!: Entity;
  private isolatorProxy!: Entity;
  private leverMat!: MeshStandardMaterial;
  private grab: GrabSystem | undefined;

  /** True once the changeover has latched ON (house isolated from the street line). */
  get energised(): boolean {
    return this.model.energised;
  }

  /** Counts refused or reset throws, so the HUD can explain each one. */
  get resets(): number {
    return this.model.resets;
  }

  get lastReset(): ResetReason | null {
    return this.model.lastReset;
  }

  /** The device is giving a tracked eye pose this frame. */
  get eyesTracked(): boolean {
    return this.input$.tracked.eyes === true;
  }

  /** A tracked eye pose has been seen since load: this device tracks the eyes. */
  get eyesSeen(): boolean {
    return this.eyesSeen$;
  }
  private eyesSeen$ = false;

  /** The eyes hold the isolator right now. */
  get eyesHolding(): boolean {
    return this.look.holding;
  }

  init(): void {
    this.grab = this.world.getSystem(GrabSystem);

    // Static board (plain Object3D children of one transform entity).
    this.board = new Group();
    const plate = new Mesh(
      new BoxGeometry(BOARD_W, BOARD_H, 0.02),
      new MeshStandardMaterial({ color: 0x2b3a42, roughness: 0.8 }),
    );
    this.board.add(plate);

    this.isoMat = new MeshStandardMaterial({ color: 0xd8432e, emissive: EYE_HOLD_GLOW, emissiveIntensity: 0 });
    const isolatorKnob = new Mesh(new BoxGeometry(0.05, 0.07, 0.04), this.isoMat);
    isolatorKnob.position.set(ISOLATOR_X, 0, 0.03);
    this.board.add(isolatorKnob);

    this.leverMat = new MeshStandardMaterial({ color: 0x9aa4a8 });
    this.leverKnob = new Mesh(new BoxGeometry(0.05, 0.03, 0.05), this.leverMat);
    this.leverKnob.position.set(LEVER_X, LEVER_Y0, 0.035);
    this.board.add(this.leverKnob);

    // Post from the table top up to the bottom of the board.
    const postH = BOARD.y - BOARD_H / 2 - TOP_Y;
    const post = new Mesh(
      new BoxGeometry(0.03, postH, 0.03),
      new MeshStandardMaterial({ color: 0x1d262b, roughness: 0.9 }),
    );
    post.position.set(0, -BOARD_H / 2 - postH / 2, -0.01);
    this.board.add(post);

    const boardEntity = this.world.createTransformEntity(this.board);
    boardEntity.object3D!.position.set(BOARD.x, BOARD.y, BOARD.z);

    // Grabbable proxies — colliders ~2x the visual, faintly visible in the spike.
    const proxyMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.isolatorProxy = this.makeProxy('isolator', proxyMat, ISOLATOR_X, 0);
    this.leverProxy = this.makeProxy('lever', proxyMat, LEVER_X, LEVER_Y0);
    this.leverProxy.addComponent(InterlockStatus);
  }

  private makeProxy(role: string, mat: MeshBasicMaterial, x: number, y: number): Entity {
    const mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), mat);
    mesh.name = `${role}-proxy`;
    const e = this.world.createTransformEntity(mesh);
    e.object3D!.position.set(BOARD.x + x, BOARD.y + y, BOARD.z + PROXY_Z);
    e.addComponent(SwitchPart, { role });
    e.addComponent(OneHandGrabbable, { rotate: false, translate: role === 'lever' });
    return e;
  }

  private holder(e: Entity): Hand | null {
    if (!e.hasComponent(Grabbed)) return null;
    return this.grab?.getHolderHand(e) ?? null;
  }

  /** Angle from the tracked eye ray to the isolator, in degrees; NaN without a tracked eye pose. */
  private eyeAngle(): number {
    const xr = this.input.xr;
    if (!xr.gazeEnabled || xr.xrOrigin.gazeOrigin !== 'tracked') return NaN;
    const eye = xr.xrOrigin.eyeSpace;
    eye.getWorldPosition(this.eyePos);
    eye.getWorldQuaternion(this.eyeQuat);
    this.eyeDir.set(0, 0, -1).applyQuaternion(this.eyeQuat);
    return angleToDeg(this.eyePos, this.eyeDir, ISO_FACE);
  }

  update(delta: number): void {
    const xr = this.input.xr;
    const inp = this.input$;
    inp.tracked.left = xr.isPrimary('hand', 'left');
    inp.tracked.right = xr.isPrimary('hand', 'right');
    this.eyesAngle = this.eyeAngle();
    inp.tracked.eyes = !Number.isNaN(this.eyesAngle);
    if (inp.tracked.eyes) this.eyesSeen$ = true;
    const eyesHold = stepLookHold(this.look, { tracked: inp.tracked.eyes, angleDeg: this.eyesAngle, dt: delta });

    // A hand on the isolator wins when a throw starts. Mid-throw, whoever
    // started it must finish it: the eyes stay the holder while they hold.
    const handIso = this.holder(this.isolatorProxy);
    const keepEyes = this.model.phase === 'throwing' && this.model.isolatorHolder === 'eyes' && eyesHold;
    inp.isolatorHolder = keepEyes ? 'eyes' : (handIso ?? (eyesHold ? 'eyes' : null));
    inp.leverHolder = this.holder(this.leverProxy);

    const proxyY = this.leverProxy.object3D!.position.y - (BOARD.y + LEVER_Y0);
    inp.requestedTravel = proxyY / LEVER_SPAN;

    const prev = this.model;
    this.model = stepInterlock(prev, inp);
    const m = this.model;

    // Visible lever shows only the travel the model allows.
    this.leverKnob.position.y = LEVER_Y0 + m.travel * LEVER_SPAN;
    this.leverMat.color.setHex(m.energised ? 0x3fbf5f : m.phase === 'throwing' ? 0xe0b030 : 0x9aa4a8);

    // A refused or reset throw drops the lever out of the hand and snaps the proxy home.
    const aborted = m.resets !== prev.resets;
    if (aborted && this.leverProxy.hasComponent(Grabbed)) this.grab?.forceRelease(this.leverProxy);
    if (!this.leverProxy.hasComponent(Grabbed) || aborted) {
      this.leverProxy.object3D!.position.set(
        BOARD.x + LEVER_X,
        BOARD.y + LEVER_Y0 + m.travel * LEVER_SPAN,
        BOARD.z + PROXY_Z,
      );
    }
    // The isolator glows while the eyes rest on it, full once they hold it.
    this.isoMat.emissiveIntensity = m.energised
      ? 0
      : this.look.holding
        ? 0.9
        : 0.45 * Math.min(1, this.look.onS / LOOK_HOLD_DEFAULTS.acquireS);
    // Isolator proxy never moves.
    this.isolatorProxy.object3D!.position.set(BOARD.x + ISOLATOR_X, BOARD.y, BOARD.z + PROXY_Z);

    const s = this.leverProxy;
    s.setValue(InterlockStatus, 'phase', m.phase);
    s.setValue(InterlockStatus, 'travel', m.travel);
    s.setValue(InterlockStatus, 'energised', m.energised);
    s.setValue(InterlockStatus, 'lastReset', m.lastReset ?? '');
    s.setValue(InterlockStatus, 'isolatorHolder', inp.isolatorHolder ?? '');
    s.setValue(InterlockStatus, 'leverHolder', inp.leverHolder ?? '');
    s.setValue(InterlockStatus, 'leftTracked', inp.tracked.left);
    s.setValue(InterlockStatus, 'rightTracked', inp.tracked.right);
    s.setValue(InterlockStatus, 'eyesTracked', inp.tracked.eyes === true);
    s.setValue(InterlockStatus, 'eyesHolding', this.look.holding);
    s.setValue(InterlockStatus, 'eyesAngle', Number.isNaN(this.eyesAngle) ? -1 : this.eyesAngle);
    s.setValue(InterlockStatus, 'resets', m.resets);
  }
}
