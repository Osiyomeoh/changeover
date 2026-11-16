/**
 * PlaySystem: one outage night, played with the hands.
 *
 *  - Appliance tokens rest in a tray. Pinch one, drop it on a circuit slot →
 *    it switches on (if the inverter accepts it). Lift it out → it switches off.
 *  - An overload or surge trips the inverter: every plugged token pops back
 *    to the tray and the panel says why, with the numbers.
 *  - Pinch the generator's pull-cord: refused (backfeed) unless the changeover
 *    board is isolated and thrown; otherwise the house runs on it until the
 *    fuel runs out.
 *  - A hand that loses tracking while holding a token returns it to the tray
 *    (never into a circuit).
 *  - Look and pinch (Glasses mode): look at a token and pinch to switch it onto
 *    a free circuit, or off if it is on; look at the cord and pinch to pull it.
 *    Gaze is a ray pointer and hand-grab objects refuse rays, so each token and
 *    the cord get a separate invisible look-target that follows them. On a
 *    device without eye tracking the hand ray does the looking.
 *  - Nights 1–5 run in order (./model/campaign.ts); ?daily plays the Daily
 *    Outage. An unfinished night is saved every few seconds and on page hide;
 *    a reload resumes it on the battery with the changeover at rest
 *    (./model/session.ts).
 *  - When a night ends a button appears on the right of the table: Next night
 *    after a win, Retry after a loss. Pinch it, or look at it and pinch.
 *
 * All rules live in ./model/night.ts (unit-tested). This file only maps hands
 * to model calls and model state to visuals.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  createSystem,
  Grabbed,
  GrabSystem,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneHandGrabbable,
  PlaneGeometry,
  RayInteractable,
  RingGeometry,
  SRGBColorSpace,
  VisibilityState,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { ChangeoverSystem } from './changeover-system.js';
import type { ResetReason } from './model/interlock.js';
import { GazeTarget, GeneratorCord, NextButton, PlayStatus, Token } from './changeover-components.js';
import {
  CORD_POS,
  LOOK_TARGET_M,
  NEXT_POS,
  PANEL_H,
  PANEL_POS,
  PANEL_TILT_X,
  PANEL_W,
  PARKED_POS,
  SLOT_COUNT,
  SLOT_SNAP_H,
  SLOT_SNAP_M,
  SLOT_Z,
  TOP_Y,
  trayPos,
  slotX,
} from './layout.js';
import { CATALOGUE } from './model/catalogue.js';
import { cuesFor, type Cue } from './model/cues.js';
import { Sfx } from './sfx.js';
import {
  BEAM_OPACITY,
  BREATH_HZ,
  DAWN_GLOW,
  FAN_TURNS_PER_S,
  FLAT_HIDE_K,
  NEAR_SHELL_K,
  ROOM_TINT0,
  ROOM_TINT1,
  SKY_NIGHT,
  SUN,
  growth,
  revealPose,
  sunrise,
  type RevealPose,
} from './dawn.js';
import { createDawnRoom } from './scene-assets/dawn-room.scene-asset.js';
import { GENERATOR_W, NIGHT_COUNT, campaignNight, nightsWon, recordNight, type Progress } from './model/campaign.js';
import { currentStreak, dailyNight, localDate, recordWin, type Streak, type Tier } from './model/daily.js';
import {
  chooseStart,
  clearSession,
  loadProgress,
  loadSession,
  restore,
  saveProgress,
  saveSession,
  snapshot,
  startFor,
  type Mode,
} from './model/session.js';
import { browserStore, loadStreak, saveStreak } from './model/streak-store.js';
import {
  changeSource,
  clockLabel,
  pinchOff,
  pinchOn,
  resetBreaker,
  startNight,
  tick,
  type NightState,
} from './model/night.js';
import { loadW, limits, runtimeHours, formatHours } from './model/power-model.js';

/** Game hours per real second: a 10-hour night takes 5 minutes. */
const DEFAULT_SPEED = 1 / 30;
const MODEL_HZ = 10;
const PANEL_HZ = 4;
/** Real seconds between saves of an unfinished night (it is also saved on page hide). */
const SAVE_EVERY_S = 2;
/**
 * Seconds a hand must stay tracked after it (re)appears before a pinch can pull
 * the cord, press the end-of-night button or commit a look-select. When tracking
 * returns mid-pinch the runtime reports a brand-new pinch; without this the cord
 * pulled twice in the emulator (scripts/emu-play.py, cord tracking-loss scenario).
 */
const ARM_S = 0.3;
const FUEL_H: Record<Tier, number> = { easy: 3, standard: 2, hard: 1 };

const TOKEN_ORDER = ['fridge', 'fan', 'tv', 'laptop', 'pump', 'microwave', 'kettle', 'iron'];

/** ?speed=N (1–600) speeds the clock up, for tests and demos. */
function speedParam(): number {
  const sp = Number(new URLSearchParams(globalThis.location?.search ?? '').get('speed'));
  return Number.isFinite(sp) && sp > 0 && sp <= 600 ? sp / 3600 : DEFAULT_SPEED;
}

function dailyStart(date: string, tier: Tier): NightState {
  return startNight(dailyNight(date, tier), GENERATOR_W, FUEL_H[tier]);
}

/** This page's address set to campaign Night n (keeping ?speed and ?fresh), so a reload lands there. */
function nightUrl(n: number): string | null {
  try {
    const u = new URL(globalThis.location.href);
    const keep = ['speed', 'fresh'].filter((k) => u.searchParams.has(k)).map((k) => [k, u.searchParams.get(k) ?? ''] as const);
    u.search = '';
    for (const [k, v] of keep) u.searchParams.set(k, v);
    u.searchParams.set('night', String(n));
    return u.toString();
  } catch {
    return null;
  }
}

type LookKind = 'token' | 'cord' | 'next';

/** Why the lever sprang back or was refused, by reset reason. `eyes`: this device tracks the eyes. */
const RESET_CAPTION: Record<ResetReason, (eyes: boolean) => string> = {
  'looked-away': () => 'You looked away, so the lever sprang back. Keep your eyes on the red isolator until the lever latches.',
  'isolator-released': (eyes) =>
    `The isolator was let go, so the lever sprang back. Hold it${eyes ? ' with a hand or your eyes' : ''} until the lever latches.`,
  'lever-released': () => 'The lever was let go before it latched. It sprang back to OFF.',
  'tracking-lost': (eyes) => `Lost track of a hand${eyes ? ' or your eyes' : ''} mid-throw. The lever sprang back to OFF.`,
  'not-isolated': (eyes) =>
    eyes
      ? 'Not isolated. Hold the red isolator first: pinch it, or just keep your eyes on it.'
      : 'Not isolated. Pinch and hold the red isolator with your other hand first.',
  'same-hand': (eyes) => `One hand cannot do both. Hold the isolator with your other hand${eyes ? ', or with your eyes' : ''}.`,
};
const SIDES = ['left', 'right'] as const;

interface TokenRec {
  entity: Entity;
  id: string;
  home: { x: number; y: number; z: number };
  mat: MeshStandardMaterial;
  holder: 'left' | 'right' | null;
}

export class PlaySystem extends createSystem({
  tokens: { required: [Token] },
  heldTokens: { required: [Token, Grabbed] },
  heldCord: { required: [GeneratorCord, Grabbed] },
  heldNext: { required: [NextButton, Grabbed] },
}) {
  private night!: NightState;
  private started = false;
  private speed = DEFAULT_SPEED;
  private streak: Streak = { lastWinDate: null, count: 0, best: 0 };
  private countsForStreak = false;
  private today = '';
  private acc = 0;
  private panelAcc = 1;
  private caption = '';
  private captionTone: 'info' | 'warn' | 'bad' | 'good' = 'info';
  private lineAlarmS = 0;
  private recs: TokenRec[] = [];
  private slots: (TokenRec | null)[] = new Array(SLOT_COUNT).fill(null);
  private grab: GrabSystem | undefined;
  private interlock: ChangeoverSystem | undefined;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private panelTex!: CanvasTexture;
  private statusEntity!: Entity;
  private windows: MeshStandardMaterial[] = [];
  private lineMat: MeshStandardMaterial | null = null;
  private genMat: MeshStandardMaterial | null = null;
  private slotMats: MeshStandardMaterial[] = [];
  private cord!: Entity;
  private mode: Mode = { kind: 'night', n: 1 };
  private title = '';
  private progress!: Progress;
  private resumed = false;
  /** True while beginNight resets the board, so a forced release never plugs in. */
  private resetting = false;
  private saveAcc = 0;
  private hasGenerator = true;
  private cordPos: { x: number; y: number; z: number } = CORD_POS;
  /** The generator model's meshes, hidden on nights without one. */
  private genArt: Object3D[] = [];
  private lookGeo!: BoxGeometry;
  private lookMat!: MeshBasicMaterial;
  private nextBtn!: Entity;
  private nextLook!: Entity;
  private nextCanvas!: HTMLCanvasElement;
  private nextTex!: CanvasTexture;
  /** The end-of-night button's label; '' while the night plays (button hidden). */
  private nextLabel = '';
  /** Look-targets, index-aligned with `recs`; the cord's is separate. */
  private looks: Entity[] = [];
  private cordLook!: Entity;
  private lookSelects = 0;
  /** One shared ring under whatever the player is looking at. */
  private lookRing!: Mesh;
  private lastLookSource = '';
  /** Per hand: the input source last seen, and when it appeared (-1: no source). */
  private handSrc: Record<'left' | 'right', XRInputSource | undefined> = { left: undefined, right: undefined };
  private handSince: Record<'left' | 'right', number> = { left: -1, right: -1 };
  private nowS = 0;
  /** One-shot pinches ignored because the hand had only just come back this night. */
  private regainedIgnored = 0;
  /** Interlock resets already explained, and whether look-to-hold has been explained this night. */
  private seenResets = 0;
  private eyesExplained = false;
  private wasEnergised = false;
  private sfx!: Sfx;
  /** The night as last heard: cues are the difference between this and `night`. */
  private heard!: NightState;
  private cueBuf: Cue[] = [];
  /** Cues played this night, and the most recent few (newest last), for the status mirror. */
  private cueCount = 0;
  private recentCues = '';
  /** The dawn reveal (src/dawn.ts): the room, the parts it drives, seconds since dawn (-1: none). */
  private room!: Object3D;
  private roomNear!: Object3D;
  private roomMat!: MeshStandardMaterial;
  private roomBlanket!: Object3D;
  private roomBlades!: Object3D;
  private roomLed!: Object3D;
  private roomSun!: Object3D;
  private roomSkyMat!: MeshBasicMaterial;
  private roomBeamMat!: MeshBasicMaterial;
  /** The diorama's flat and street, hidden once the room has grown out of them. */
  private flatArt: Object3D[] = [];
  private dawnT = -1;
  private dawnFridge = false;
  private dawnFan = false;
  private dawnPose: RevealPose = { k: 0, s: 0, x: 0, y: 0, z: 0 };

  init(): void {
    this.grab = this.world.getSystem(GrabSystem);
    this.interlock = this.world.getSystem(ChangeoverSystem);
    this.sfx = new Sfx();
    const store = browserStore();
    this.speed = speedParam();
    this.streak = loadStreak(store);
    this.progress = loadProgress(store);
    this.today = localDate(new Date());
    const start = chooseStart(globalThis.location?.search ?? '', this.today, this.progress, loadSession(store));
    if (start.discard) clearSession(store);
    this.countsForStreak = start.countsForStreak;

    this.buildSlots();
    this.buildTokens();
    this.buildCord();
    this.buildLookTargets();
    this.buildNext();
    this.buildPanel();
    this.buildRoom();
    this.beginNight(start.mode, start.resume);

    // Browsers hold audio until a user gesture: the Enter XR click, a key, or an XR select.
    const unlock = () => this.sfx.resume();
    const xr = this.renderer.xr;
    let session: XRSession | null = null;
    const onSessionStart = () => {
      session = xr.getSession();
      session?.addEventListener('select', unlock);
      session?.addEventListener('squeeze', unlock);
      unlock();
    };
    const onSessionEnd = () => {
      session?.removeEventListener('select', unlock);
      session?.removeEventListener('squeeze', unlock);
      session = null;
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    xr.addEventListener('sessionstart', onSessionStart);
    xr.addEventListener('sessionend', onSessionEnd);
    this.cleanupFuncs.push(
      () => document.removeEventListener('pointerdown', unlock),
      () => document.removeEventListener('keydown', unlock),
      () => xr.removeEventListener('sessionstart', onSessionStart),
      () => xr.removeEventListener('sessionend', onSessionEnd),
      onSessionEnd,
      () => this.sfx.dispose(),
    );

    const onHide = () => this.saveNow();
    const onVis = () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    };
    globalThis.addEventListener?.('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    this.cleanupFuncs.push(
      () => globalThis.removeEventListener?.('pagehide', onHide),
      () => document.removeEventListener('visibilitychange', onVis),
      this.queries.heldTokens.subscribe('qualify', (e) => this.onTokenGrab(e)),
      this.queries.heldTokens.subscribe('disqualify', (e) => this.onTokenRelease(e)),
      this.queries.heldCord.subscribe('qualify', (e) => this.onCordPull(e)),
      this.queries.heldNext.subscribe('qualify', (e) => {
        const side = this.grab?.getHolderHand(e) ?? null;
        if (side && !this.armed(side)) {
          this.grab?.forceRelease(e);
          this.regainedIgnored++;
          return;
        }
        this.grab?.forceRelease(e);
        this.onNext();
      }),
    );
  }

  /** Start `mode` afresh, or from `resume` if it is a valid save of that night. */
  private beginNight(mode: Mode, resume: unknown = null): void {
    this.mode = mode;
    this.title = mode.kind === 'night'
      ? `Night ${mode.n} of ${NIGHT_COUNT} · ${campaignNight(mode.n).title}`
      : `Daily Outage · ${mode.date} · ${mode.tier}`;
    const fresh = startFor(mode, dailyStart);
    const restored = resume ? restore(resume, fresh, SLOT_COUNT) : null;
    this.night = restored ?? fresh;
    this.heard = this.night; // a new or restored night starts silent
    this.cueCount = 0;
    this.recentCues = '';
    this.resumed = restored !== null;
    this.hasGenerator = this.night.cfg.generator !== undefined;
    this.cordPos = this.hasGenerator ? CORD_POS : PARKED_POS;
    for (const o of this.genArt) o.visible = this.hasGenerator;
    this.acc = 0;
    this.saveAcc = 0;
    this.lookSelects = 0;
    this.lastLookSource = '';
    this.regainedIgnored = 0;
    this.lineAlarmS = 0;
    this.eyesExplained = false;
    this.endReveal();

    this.resetting = true;
    for (const r of this.recs) {
      if (r.entity.hasComponent(Grabbed)) this.grab?.forceRelease(r.entity);
      r.holder = null;
      this.sendHome(r);
    }
    this.resetting = false;
    this.slots.fill(null);
    if (restored) {
      const on = restored.power.on;
      for (let i = 0; i < on.length; i++) {
        const r = this.recs.find((x) => x.id === on[i]);
        if (r) this.seat(r, i);
      }
    }
    this.started = restored !== null;
    this.showNext('');
    this.say(
      restored
        ? `Resumed at ${clockLabel(this.night)}, on the battery. The changeover is back at rest.`
        : mode.kind === 'night'
          ? campaignNight(mode.n).brief
          : 'Grid down. Put the FRIDGE on a circuit: pinch and drop it, or look at it and pinch.',
      'info',
    );
    this.panelAcc = 1;
  }

  /** Save the night in play (no-op before the first plug or after the outcome). */
  private saveNow(): void {
    if (!this.started || this.night.outcome.kind !== 'playing') return;
    const ids: string[] = [];
    for (const r of this.slots) if (r) ids.push(r.id);
    saveSession(browserStore(), snapshot(this.mode, this.night, ids));
  }

  /** Dawn or a spoiled fridge: record it, forget the save, offer the button. */
  private endNight(): void {
    const o = this.night.outcome;
    const store = browserStore();
    clearSession(store);
    if (o.kind === 'won') {
      this.startReveal();
      if (this.mode.kind === 'night') {
        const n = this.mode.n;
        this.progress = recordNight(this.progress, n, o.stars);
        saveProgress(store, this.progress);
        const last = n >= NIGHT_COUNT;
        this.say(
          last
            ? 'Dawn. All five nights won. Add ?daily to the address for the Daily Outage.'
            : `Dawn. Night ${n} won. Pinch NEXT NIGHT on the right.`,
          'good',
        );
        this.showNext(last ? 'Play again' : 'Next night');
      } else {
        this.say('Dawn. You kept the fridge cold all night.', 'good');
        if (this.countsForStreak) {
          this.streak = recordWin(this.streak, this.mode.date);
          saveStreak(store, this.streak);
        }
        this.showNext('Play again');
      }
    } else if (o.kind === 'lost') {
      this.say('The fridge was off too long. The stock spoiled. Pinch RETRY on the right.', 'bad');
      this.showNext('Retry');
    }
  }

  private onNext(): void {
    if (!this.nextLabel) return;
    const m = this.mode;
    if (this.night.outcome.kind === 'won' && m.kind === 'night' && m.n < NIGHT_COUNT) {
      const next: Mode = { kind: 'night', n: m.n + 1 };
      const url = nightUrl(next.n);
      try {
        if (url) globalThis.history?.replaceState(null, '', url);
      } catch {
        // A sandboxed frame may refuse; a reload then resumes via the save instead.
      }
      this.beginNight(next);
    } else this.beginNight(m);
  }

  // ---------- construction ----------

  private buildSlots(): void {
    const g = new Group();
    for (let i = 0; i < SLOT_COUNT; i++) {
      const mat = new MeshStandardMaterial({ color: 0x30383e, emissive: 0x000000, roughness: 0.7 });
      const pad = new Mesh(new BoxGeometry(0.075, 0.006, 0.075), mat);
      pad.name = `circuit-${i + 1}`;
      pad.position.set(slotX(i), TOP_Y + 0.003, SLOT_Z);
      g.add(pad);
      this.slotMats.push(mat);
    }
    g.name = 'circuits';
    this.world.createTransformEntity(g);
  }

  private tokenShape(id: string, mat: MeshStandardMaterial): Object3D {
    const g = new Group();
    const add = (geo: BoxGeometry | CylinderGeometry, y: number, x = 0, rx = 0) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, 0);
      m.rotation.x = rx;
      g.add(m);
    };
    switch (id) {
      case 'fridge': add(new BoxGeometry(0.035, 0.06, 0.035), 0.03); break;
      case 'fan':
        add(new CylinderGeometry(0.004, 0.004, 0.05, 6), 0.025);
        add(new CylinderGeometry(0.022, 0.022, 0.004, 12), 0.052, 0, Math.PI / 2);
        break;
      case 'tv': add(new BoxGeometry(0.055, 0.035, 0.006), 0.025); add(new BoxGeometry(0.02, 0.008, 0.02), 0.004); break;
      case 'laptop': add(new BoxGeometry(0.045, 0.004, 0.032), 0.002); add(new BoxGeometry(0.045, 0.03, 0.003), 0.017, 0, -0.3); break;
      case 'pump': add(new CylinderGeometry(0.016, 0.016, 0.035, 10), 0.0175); break;
      case 'microwave': add(new BoxGeometry(0.05, 0.03, 0.035), 0.015); break;
      case 'kettle': add(new CylinderGeometry(0.014, 0.018, 0.04, 10), 0.02); break;
      case 'iron': add(new BoxGeometry(0.05, 0.018, 0.026), 0.009); add(new BoxGeometry(0.03, 0.01, 0.008), 0.025); break;
      default: add(new BoxGeometry(0.04, 0.04, 0.04), 0.02);
    }
    return g;
  }

  private label(text: string): Mesh {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(12,14,18,0.85)';
    x.fillRect(0, 0, 256, 64);
    x.fillStyle = '#f2efe6';
    x.font = 'bold 34px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 128, 34);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(0.07, 0.0175), new MeshBasicMaterial({ map: tex, transparent: true }));
    m.rotation.x = -0.5; // tilted up toward a seated viewer
    return m;
  }

  private buildTokens(): void {
    const colours: Record<string, number> = {
      fridge: 0xe8eef2, fan: 0x6fb1d6, tv: 0x2a2e33, laptop: 0x9aa0a6,
      pump: 0x3d73c4, microwave: 0xd9d2c5, kettle: 0xc94f3d, iron: 0xe0a030,
    };
    const collider = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const n = TOKEN_ORDER.length;
    for (let i = 0; i < n; i++) {
      const id = TOKEN_ORDER[i];
      const entry = CATALOGUE.find((c) => c.id === id);
      if (!entry) continue;
      const mat = new MeshStandardMaterial({ color: colours[id] ?? 0xcccccc, emissive: 0x000000, roughness: 0.6 });
      // Collider ~2× the visual (hands-only guidance: forgiving targets).
      const root = new Mesh(new BoxGeometry(0.07, 0.075, 0.07), collider);
      root.name = `token-${id}`;
      const shape = this.tokenShape(id, mat);
      shape.position.y = -0.03;
      root.add(shape);
      const lab = this.label(entry.label.replace('Flat-screen ', ''));
      lab.position.set(0, 0.035, 0.0); // floats just above the token
      root.add(lab);
      const t = trayPos(i);
      const home = { x: t.x, y: TOP_Y + 0.03, z: t.z };
      const e = this.world.createTransformEntity(root);
      e.object3D!.position.set(home.x, home.y, home.z);
      e.addComponent(Token, { applianceId: id, slot: -1 });
      e.addComponent(OneHandGrabbable, { rotate: false, translate: true });
      this.recs.push({ entity: e, id, home, mat, holder: null });
    }
  }

  private buildCord(): void {
    const handle = new Mesh(
      new BoxGeometry(0.03, 0.012, 0.012),
      new MeshStandardMaterial({ color: 0xd8d0b0, roughness: 0.5 }),
    );
    const hit = new Mesh(new BoxGeometry(0.07, 0.07, 0.07), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.add(handle);
    hit.name = 'generator-cord';
    const lab = this.label('Start generator');
    lab.scale.setScalar(1.1);
    lab.position.set(0, 0.03, 0.02);
    lab.rotation.x = -0.4;
    hit.add(lab);
    this.cord = this.world.createTransformEntity(hit);
    this.cord.object3D!.position.set(this.cordPos.x, this.cordPos.y, this.cordPos.z);
    this.cord.addComponent(GeneratorCord);
    this.cord.addComponent(OneHandGrabbable, { rotate: false, translate: false });
  }

  /** An invisible gaze/ray target; pinching while it is hovered calls onLook. */
  private makeLook(name: string, kind: LookKind, index: number): Entity {
    const m = new Mesh(this.lookGeo, this.lookMat);
    m.name = name;
    const e = this.world.createTransformEntity(m);
    e.addComponent(GazeTarget, { kind, index });
    e.addComponent(RayInteractable);
    // Act on pointerdown (pinch start) so the source is known: 'gaze' for eye
    // gaze, otherwise the hand/controller ray or the desktop mouse.
    const onDown = (ev: { pointerId: number; pointerState?: { source?: string }; pointerType?: string }) => {
      const source = ev.pointerState?.source ?? ev.pointerType ?? 'unknown';
      // Hand ray: capture the pointer until the pinch is released. A select moves
      // this target out from under the ray, and IWSDK 1.0.1's MultiPointer drops a
      // release that lands on nothing (processButtonLifecycle returns early), which
      // left the ray stuck mid-select and swallowed the next pinch. While captured,
      // the release still lands on this target. Gaze has its own pointer and is unaffected.
      if (source === 'ray') {
        (m as unknown as { setPointerCapture(id: number): void }).setPointerCapture(ev.pointerId);
      }
      this.onLook(kind, index, source);
    };
    m.addEventListener('pointerdown', onDown as never);
    this.cleanupFuncs.push(() => m.removeEventListener('pointerdown', onDown as never));
    return e;
  }

  private buildLookTargets(): void {
    this.lookGeo = new BoxGeometry(LOOK_TARGET_M, LOOK_TARGET_M, LOOK_TARGET_M);
    this.lookMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < this.recs.length; i++) {
      const e = this.makeLook(`look-${this.recs[i].id}`, 'token', i);
      e.object3D!.position.copy(this.recs[i].entity.object3D!.position);
      this.looks.push(e);
    }
    this.cordLook = this.makeLook('look-cord', 'cord', -1);
    this.cordLook.object3D!.position.set(this.cordPos.x, this.cordPos.y, this.cordPos.z);

    this.lookRing = new Mesh(
      new RingGeometry(0.042, 0.05, 40),
      new MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.lookRing.name = 'look-ring';
    this.lookRing.rotation.x = -Math.PI / 2;
    this.lookRing.visible = false;
    this.world.createTransformEntity(this.lookRing);
  }

  /** The end-of-night button: a plate on the right of the table, parked out of reach while a night plays. */
  private buildNext(): void {
    this.nextCanvas = document.createElement('canvas');
    this.nextCanvas.width = 256;
    this.nextCanvas.height = 96;
    this.nextTex = new CanvasTexture(this.nextCanvas);
    this.nextTex.colorSpace = SRGBColorSpace;
    const plate = new Mesh(new PlaneGeometry(0.1, 0.0375), new MeshBasicMaterial({ map: this.nextTex }));
    plate.rotation.x = -0.5; // tilted up toward a seated viewer, like the token labels
    const hit = new Mesh(new BoxGeometry(0.07, 0.07, 0.07), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.name = 'next-button';
    hit.add(plate);
    this.nextBtn = this.world.createTransformEntity(hit);
    this.nextBtn.addComponent(NextButton);
    this.nextBtn.addComponent(OneHandGrabbable, { rotate: false, translate: false });
    this.nextLook = this.makeLook('look-next', 'next', -1);
    this.placeNext();
  }

  private showNext(label: string): void {
    this.nextLabel = label;
    if (label) {
      const c = this.nextCanvas.getContext('2d')!;
      c.fillStyle = label === 'Retry' ? '#7a2a20' : '#1f6b3a';
      c.fillRect(0, 0, 256, 96);
      c.fillStyle = '#f2efe6';
      c.font = 'bold 44px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label === 'Next night' ? 'Next night ▸' : label, 128, 50);
      this.nextTex.needsUpdate = true;
    }
    this.placeNext();
  }

  private placeNext(): void {
    const p = this.nextLabel ? NEXT_POS : PARKED_POS;
    this.nextBtn.object3D!.position.set(p.x, p.y, p.z);
    this.nextBtn.object3D!.visible = this.nextLabel !== '';
    this.nextLook.object3D!.position.set(p.x, p.y, p.z);
  }

  private buildPanel(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = Math.round((1024 * PANEL_H) / PANEL_W);
    this.ctx = this.canvas.getContext('2d')!;
    this.panelTex = new CanvasTexture(this.canvas);
    this.panelTex.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(PANEL_W, PANEL_H), new MeshBasicMaterial({ map: this.panelTex }));
    mesh.name = 'status-panel';
    const e = this.world.createTransformEntity(mesh);
    const o = e.object3D!;
    o.position.set(PANEL_POS.x, PANEL_POS.y, PANEL_POS.z);
    o.rotation.order = 'YXZ';
    o.rotation.y = Math.atan2(-PANEL_POS.x, -PANEL_POS.z);
    o.rotation.x = PANEL_TILT_X;
    e.addComponent(PlayStatus);
    this.statusEntity = e;
  }

  /** The room the flat grows into at dawn; hidden until a night is won. */
  private buildRoom(): void {
    const room = createDawnRoom();
    room.visible = false;
    this.world.createTransformEntity(room);
    this.room = room;
    const part = (name: string): Object3D => {
      const o = room.getObjectByName(name);
      if (!o) throw new Error(`dawn-room: no part named ${name}`);
      return o;
    };
    this.roomNear = part('room-shell-near');
    this.roomMat = (part('room-shell') as Mesh).material as MeshStandardMaterial;
    this.roomBlanket = part('room-child-blanket');
    this.roomBlades = part('room-fan-blades');
    this.roomLed = part('room-fridge-led');
    this.roomSun = part('room-sun');
    this.roomSkyMat = (part('room-sky') as Mesh).material as MeshBasicMaterial;
    this.roomBeamMat = (part('room-sunbeam') as Mesh).material as MeshBasicMaterial;
  }

  /** A night is won: the room grows out of the flat. What was on at dawn is what runs in it. */
  private startReveal(): void {
    this.dawnT = 0;
    this.dawnFridge = this.night.power.on.includes('fridge');
    this.dawnFan = this.night.power.on.includes('fan');
    this.roomLed.visible = this.dawnFridge;
    this.roomBlades.rotation.x = 0;
  }

  private endReveal(): void {
    this.dawnT = -1;
    this.room.visible = false;
    for (const o of this.flatArt) o.visible = true;
  }

  /** Grow the room around the player (src/dawn.ts revealPose), then bring the sun up. */
  private updateReveal(dt: number): void {
    if (this.dawnT < 0) return;
    this.dawnT += dt;
    const t = this.dawnT;
    const p = revealPose(t, this.dawnPose);
    this.room.visible = p.k > 0;
    this.room.position.set(p.x, p.y, p.z);
    this.room.scale.setScalar(p.s);
    this.roomNear.visible = p.k >= NEAR_SHELL_K;
    const flatShown = p.k < FLAT_HIDE_K;
    for (const o of this.flatArt) o.visible = flatShown;
    const u = sunrise(t);
    this.roomSun.position.y = SUN.y0 + (SUN.y1 - SUN.y0) * u;
    this.roomMat.color.setRGB(
      ROOM_TINT0[0] + (ROOM_TINT1[0] - ROOM_TINT0[0]) * u,
      ROOM_TINT0[1] + (ROOM_TINT1[1] - ROOM_TINT0[1]) * u,
      ROOM_TINT0[2] + (ROOM_TINT1[2] - ROOM_TINT0[2]) * u,
    );
    this.roomMat.emissiveIntensity = DAWN_GLOW * u;
    this.roomSkyMat.color.setRGB(SKY_NIGHT[0] + (1 - SKY_NIGHT[0]) * u, SKY_NIGHT[1] + (1 - SKY_NIGHT[1]) * u, SKY_NIGHT[2] + (1 - SKY_NIGHT[2]) * u);
    this.roomBeamMat.opacity = BEAM_OPACITY * u;
    if (this.dawnFan) this.roomBlades.rotation.x = (this.roomBlades.rotation.x + dt * FAN_TURNS_PER_S * Math.PI * 2) % (Math.PI * 2);
    this.roomBlanket.scale.y = 1 + 0.07 * Math.sin(t * BREATH_HZ * Math.PI * 2);
  }

  private findSetMaterials(): void {
    if (this.lineMat) return;
    const scene = this.world.scene;
    scene.traverse((o) => {
      if (o.name === 'flat' || o.name === 'street-pole' || o.name === 'street-line') this.flatArt.push(o);
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (m.name.startsWith('window-')) {
        const mat = (m.material as MeshStandardMaterial).clone();
        m.material = mat;
        this.windows.push(mat);
      } else if (m.name === 'street-line') {
        this.lineMat = (m.material as MeshStandardMaterial).clone();
        m.material = this.lineMat;
      } else if (m.name === 'generator') {
        this.genMat = (m.material as MeshStandardMaterial).clone();
        m.material = this.genMat;
        this.genArt.push(m);
      } else if (m.name === 'generator-tank') this.genArt.push(m);
    });
    for (const o of this.genArt) o.visible = this.hasGenerator;
  }

  // ---------- interaction ----------

  private rec(e: Entity): TokenRec | undefined {
    for (const r of this.recs) if (r.entity === e) return r;
    return undefined;
  }

  private onTokenGrab(e: Entity): void {
    const r = this.rec(e);
    if (!r) return;
    r.holder = this.grab?.getHolderHand(e) ?? null;
    const slot = e.getValue(Token, 'slot') ?? -1;
    if (slot >= 0) {
      this.slots[slot] = null;
      e.setValue(Token, 'slot', -1);
      this.night = pinchOff(this.night, r.id);
      this.panelAcc = 1;
    }
  }

  private sendHome(r: TokenRec): void {
    const slot = r.entity.getValue(Token, 'slot') ?? -1;
    if (slot >= 0) this.slots[slot] = null;
    r.entity.setValue(Token, 'slot', -1);
    r.entity.object3D!.position.set(r.home.x, r.home.y, r.home.z);
  }

  private onTokenRelease(e: Entity): void {
    const r = this.rec(e);
    if (!r) return;
    const hand = r.holder;
    r.holder = null;
    if (this.resetting) return this.sendHome(r);
    // Tracking lost while holding → back to the tray, never into a circuit.
    if (hand && !this.input.xr.isPrimary('hand', hand) && !this.input.xr.isPrimary('controller', hand)) {
      this.sendHome(r);
      this.say('Hand lost — token returned to the tray.', 'warn');
      return;
    }
    if (this.night.outcome.kind !== 'playing') return this.sendHome(r);

    const p = e.object3D!.position;
    let best = -1;
    let bestD = SLOT_SNAP_M;
    if (p.y - TOP_Y <= SLOT_SNAP_H) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (this.slots[i]) continue;
        const d = Math.hypot(p.x - slotX(i), p.z - SLOT_Z);
        if (d <= bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0) return this.sendHome(r);
    this.plugInto(r, best);
  }

  /** Put `r` in circuit `slot` (the model already has it on). */
  private seat(r: TokenRec, slot: number): void {
    this.slots[slot] = r;
    r.entity.setValue(Token, 'slot', slot);
    r.entity.object3D!.position.set(slotX(slot), TOP_Y + 0.036, SLOT_Z);
  }

  /** Try to switch `r` on in circuit `slot` (free). Sends it home on refusal. */
  private plugInto(r: TokenRec, slot: number): void {
    if (this.night.power.tripped) this.night = resetBreaker(this.night);
    const res = pinchOn(this.night, r.id);
    this.night = res.state;
    if (res.result.ok) {
      this.seat(r, slot);
      if (!this.started) {
        this.started = true;
        this.say(
          r.id === 'fridge'
            ? 'Fridge on. The clock runs until 6 am. Every watt costs battery.'
            : `${this.labelOf(r.id)} on. The clock is running: put the FRIDGE on too.`,
          'info',
        );
      } else this.say(`${this.labelOf(r.id)} on.`, 'good');
    } else if (res.result.reason === 'overload' || res.result.reason === 'surge') {
      const what = res.result.reason === 'overload' ? 'Overload' : 'Start-up surge';
      this.say(`${what}: ${fmtW(res.result.demandW)} > ${fmtW(res.result.limitW)} limit. Tripped.`, 'bad');
      this.sendHome(r);
      this.night = resetBreaker(this.night);
    } else this.sendHome(r);
    this.panelAcc = 1;
  }

  /** Look-and-pinch on a token or the cord. */
  private onLook(kind: LookKind, index: number, source: string): void {
    // The pinch that commits a look may come from either hand: wait for both to settle.
    if (this.handJustReturned()) {
      this.regainedIgnored++;
      return;
    }
    this.lookSelects++;
    this.lastLookSource = source;
    this.panelAcc = 1;
    if (kind === 'next') return this.onNext();
    if (kind === 'cord') return this.pullCord();
    const r = this.recs[index];
    if (!r || r.holder || r.entity.hasComponent(Grabbed)) return;
    if (this.night.outcome.kind !== 'playing') return;
    const slot = r.entity.getValue(Token, 'slot') ?? -1;
    if (slot >= 0) {
      this.night = pinchOff(this.night, r.id);
      this.sendHome(r);
      this.say(`${this.labelOf(r.id)} off.`, 'info');
      return;
    }
    const free = this.slots.indexOf(null);
    if (free < 0) {
      this.say(`All ${SLOT_COUNT} circuits are in use. Look at one and pinch to switch it off.`, 'warn');
      return;
    }
    this.plugInto(r, free);
  }

  private onCordPull(e: Entity): void {
    const side = this.grab?.getHolderHand(e) ?? null;
    this.grab?.forceRelease(e);
    if (side && !this.armed(side)) {
      this.regainedIgnored++;
      return;
    }
    this.pullCord();
  }

  /** Track when each hand's (or controller's) input source appeared. */
  private watchHands(time: number): void {
    this.nowS = time;
    for (const side of SIDES) {
      const src = this.input.xr.getPrimaryInputSource(side);
      if (src === this.handSrc[side]) continue;
      this.handSrc[side] = src;
      this.handSince[side] = src ? time : -1;
    }
  }

  /** True once `side` has been tracked for ARM_S without a break. */
  private armed(side: 'left' | 'right'): boolean {
    const t = this.handSince[side];
    return t >= 0 && this.nowS - t >= ARM_S;
  }

  private handJustReturned(): boolean {
    for (const side of SIDES) {
      const t = this.handSince[side];
      if (t >= 0 && this.nowS - t < ARM_S) return true;
    }
    return false;
  }

  private pullCord(): void {
    if (this.night.outcome.kind !== 'playing') return;
    const energised = this.interlock?.energised ?? false;
    const r = changeSource(this.night, 'generator', energised);
    this.night = r.state;
    if (r.refused === 'backfeed') {
      this.lineAlarmS = 3;
      this.say('Refused: not isolated. The generator would backfeed the street line and could kill a line worker. Isolate, then throw the changeover.', 'bad');
    } else if (r.refused === 'no-fuel') {
      this.say('Generator: out of fuel.', 'warn');
    } else if (this.night.power.source === 'generator') {
      if (this.night.power.tripped) {
        this.say(`Generator overloaded (${fmtW(GENERATOR_W)} max). Tripped.`, 'bad');
        this.night = resetBreaker(this.night);
      } else this.say('Generator running. The battery rests.', 'good');
    }
    this.panelAcc = 1;
  }

  private labelOf(id: string): string {
    return CATALOGUE.find((c) => c.id === id)?.label ?? id;
  }

  private say(text: string, tone: PlaySystem['captionTone']): void {
    this.caption = text;
    this.captionTone = tone;
  }

  // ---------- frame ----------

  /** Say why each throw sprang back, and explain look-to-hold the first time the eyes take hold. */
  private explainInterlock(): void {
    const ix = this.interlock;
    if (!ix) return;
    const live = this.night.outcome.kind === 'playing';
    if (ix.resets !== this.seenResets) {
      this.seenResets = ix.resets;
      const reason = ix.lastReset;
      if (live && reason) this.say(RESET_CAPTION[reason](ix.eyesSeen), 'warn');
    }
    if (live && ix.eyesHolding && !ix.energised && !this.eyesExplained) {
      this.eyesExplained = true;
      this.say('Your eyes hold the isolator. Now throw the lever. Look away and the power stays off.', 'info');
    }
    if (live && ix.energised && !this.wasEnergised) {
      this.say(
        this.hasGenerator
          ? 'Changeover latched: the house is off the street line. Now pull the generator cord.'
          : 'Changeover latched: the house is off the street line.',
        'good',
      );
    }
    this.wasEnergised = ix.energised;
  }

  update(delta: number, time: number): void {
    this.watchHands(time);
    this.explainInterlock();
    this.findSetMaterials();
    const dt = Math.min(delta, 0.25);

    const vis = this.world.visibilityState.peek();
    // The clock runs only while the player is in the headset and the app has focus:
    // outside XR (incl. a resumed night before re-entering), hidden or blurred, it waits.
    const paused = vis !== VisibilityState.Visible;
    if (this.started && !paused && this.night.outcome.kind === 'playing') {
      this.acc += dt;
      if (this.acc >= 1 / MODEL_HZ) {
        const before = this.night;
        this.night = tick(this.night, this.acc * this.speed);
        this.acc = 0;
        if (before.power.source === 'generator' && this.night.power.source === 'battery') {
          this.say('Generator out of fuel — back on the battery.', 'warn');
        }
        if (before.power.on.length > 0 && this.night.power.on.length === 0 && this.night.power.remainingWh <= 0) {
          this.say('Battery empty. The flat is dark.', 'bad');
        }
        if (this.night.outcome.kind !== 'playing') this.endNight();
      }
      this.saveAcc += dt;
      if (this.saveAcc >= SAVE_EVERY_S) {
        this.saveAcc = 0;
        this.saveNow();
      }
    }

    this.listen(paused);

    // Any plugged token the model no longer powers (trip, empty battery) pops out.
    for (let i = 0; i < SLOT_COUNT; i++) {
      const r = this.slots[i];
      if (r && !this.night.power.on.includes(r.id)) this.sendHome(r);
    }
    // Keep resting tokens put when not held.
    for (const r of this.recs) {
      if (r.holder || r.entity.hasComponent(Grabbed)) continue;
      const slot = r.entity.getValue(Token, 'slot') ?? -1;
      if (slot < 0) r.entity.object3D!.position.set(r.home.x, r.home.y, r.home.z);
    }
    this.cord.object3D!.position.set(this.cordPos.x, this.cordPos.y, this.cordPos.z);
    this.cordLook.object3D!.position.set(this.cordPos.x, this.cordPos.y, this.cordPos.z);
    this.placeNext();
    for (let i = 0; i < this.looks.length; i++) {
      this.looks[i].object3D!.position.copy(this.recs[i].entity.object3D!.position);
    }

    this.updateVisuals(dt);
    this.updateReveal(paused ? 0 : dt);

    this.panelAcc += dt;
    if (this.panelAcc >= 1 / PANEL_HZ) {
      this.panelAcc = 0;
      this.drawPanel();
      this.mirrorStatus();
    }
  }

  /** Play the cues for whatever changed since last frame (hand, look, cord or clock), and set the beds. */
  private listen(paused: boolean): void {
    if (this.heard !== this.night) {
      const cues = cuesFor(this.heard, this.night, this.cueBuf);
      for (let i = 0; i < cues.length; i++) {
        this.sfx.play(cues[i]);
        this.cueCount++;
        // Rare (a handful per night), so building this string is not a per-frame cost.
        const tail = this.recentCues ? `${this.recentCues},${cues[i]}` : cues[i];
        this.recentCues = tail.split(',').slice(-6).join(',');
      }
      this.heard = this.night;
    }
    const live = this.started && !paused && this.night.outcome.kind === 'playing';
    // At dawn the fridge you kept on keeps humming in the room; the generator stops.
    const dawnHum = this.dawnT >= 0 && this.dawnFridge && !paused;
    this.sfx.setBeds((live && this.night.power.on.includes('fridge')) || dawnHum, live && this.night.power.source === 'generator');
  }

  private updateVisuals(dt: number): void {
    const powered = this.night.power.on.length > 0;
    const gen = this.night.power.source === 'generator';
    for (let i = 0; i < this.windows.length; i++) {
      this.windows[i].emissive.setHex(powered ? (gen ? 0xffd27a : 0xffe2a8) : 0x000000);
      this.windows[i].emissiveIntensity = powered ? 1 : 0;
    }
    for (let i = 0; i < SLOT_COUNT; i++) this.slotMats[i].emissive.setHex(this.slots[i] ? 0x1f6b3a : 0x000000);
    if (this.genMat) this.genMat.emissive.setHex(gen ? 0x2f7a3f : 0x000000);
    if (this.lineMat) {
      this.lineAlarmS = Math.max(0, this.lineAlarmS - dt);
      this.lineMat.emissive.setHex(this.lineAlarmS > 0 && Math.floor(this.lineAlarmS * 4) % 2 === 0 ? 0xff2a1a : 0x000000);
    }
    // Open requests pulse their token.
    for (const r of this.recs) {
      let open = false;
      for (const q of this.night.requests) if (q.status === 'open' && q.applianceId === r.id) open = true;
      r.mat.emissive.setHex(open && Math.floor(performance.now() / 400) % 2 === 0 ? 0x6a4a10 : 0x000000);
    }
    // The ring sits on the table under the looked-at token, or round the cord.
    let ringAt: Object3D | null = null;
    for (let i = 0; i < this.looks.length; i++) if (this.looks[i].hasComponent(Hovered)) ringAt = this.looks[i].object3D!;
    if (this.cordLook.hasComponent(Hovered)) ringAt = this.cordLook.object3D!;
    if (this.nextLook.hasComponent(Hovered)) ringAt = this.nextLook.object3D!;
    this.lookRing.visible = ringAt !== null;
    if (ringAt) {
      const onTable = ringAt !== this.cordLook.object3D && ringAt !== this.nextLook.object3D;
      this.lookRing.position.set(ringAt.position.x, onTable ? TOP_Y + 0.002 : ringAt.position.y - 0.03, ringAt.position.z);
    }
  }

  private drawPanel(): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const n = this.night;
    c.fillStyle = '#0f1216';
    c.fillRect(0, 0, W, H);
    c.textBaseline = 'top';

    // Two columns on a 1024 × 366 strip. Left: date, clock, battery, stars.
    // Right: load, runtime/fuel, request, caption.
    const RX = 500;
    c.fillStyle = '#8b949e';
    c.font = '28px system-ui, sans-serif';
    c.fillText(this.title, 28, 16);

    c.fillStyle = '#f2efe6';
    c.font = 'bold 88px system-ui, sans-serif';
    c.fillText(clockLabel(n), 28, 52);
    c.font = '28px system-ui, sans-serif';
    c.fillStyle = '#8b949e';
    c.fillText('dawn 06:00', 300, 104);

    // Battery bar.
    const usable = n.cfg.battery.capacityWh * n.cfg.battery.usableFraction;
    const frac = usable > 0 ? Math.max(0, n.power.remainingWh / usable) : 0;
    c.fillStyle = '#262c33';
    c.fillRect(28, 160, 440, 56);
    c.fillStyle = frac > 0.3 ? '#3fbf5f' : frac > 0.12 ? '#e0b030' : '#e0503a';
    c.fillRect(28, 160, 440 * frac, 56);
    c.fillStyle = '#f2efe6';
    c.font = 'bold 36px system-ui, sans-serif';
    c.fillText(`Battery ${Math.round(frac * 100)}%`, 44, 170);

    if (n.outcome.kind === 'won') {
      c.fillStyle = '#7ee09a';
      c.font = 'bold 60px system-ui, sans-serif';
      c.fillText('★'.repeat(n.outcome.stars) + '☆'.repeat(3 - n.outcome.stars), 28, 240);
    }
    c.fillStyle = '#e0b030';
    c.font = 'bold 32px system-ui, sans-serif';
    if (this.mode.kind === 'night') {
      c.fillText(`Nights won ${nightsWon(this.progress)}/${NIGHT_COUNT}`, 240, 256);
    } else {
      const streakNow = currentStreak(this.streak, this.today);
      if (streakNow > 0) c.fillText(`Streak ${streakNow} · best ${this.streak.best}`, 240, 256);
    }

    const load = loadW(n.cfg, n.power.on);
    const lim = limits(n.cfg, n.power.source).continuousW;
    c.font = '32px system-ui, sans-serif';
    c.fillStyle = load > lim * 0.85 ? '#e0b030' : '#f2efe6';
    c.fillText(`Load ${fmtW(load)} / ${fmtW(lim)} ${n.power.source === 'generator' ? 'generator' : 'inverter'}`, RX, 16);
    c.fillStyle = '#f2efe6';
    if (n.power.source === 'generator') {
      c.fillText(`Generator fuel ${formatHours(n.fuelH)}`, RX, 58);
    } else if (load === 0 && this.hasGenerator) {
      c.fillText(`Nothing on · fuel ${formatHours(n.fuelH)}`, RX, 58);
    } else {
      const left = runtimeHours(n.cfg, n.power.remainingWh, load);
      c.fillText(load > 0 ? `Battery lasts ${formatHours(left)} here` : 'Nothing on', RX, 58);
    }

    let req = '';
    for (const q of n.requests) {
      if (q.status === 'open') {
        const closeMin = Math.max(0, Math.round((q.atH + 0.5 - n.elapsedH) * 60));
        req = `Wants ${this.labelOf(q.applianceId)} · ${closeMin} min`;
      }
    }
    const served = n.requests.filter((q) => q.status === 'served').length;
    c.fillStyle = req ? '#f0c060' : '#8b949e';
    c.fillText(req || `Requests ${served}/${n.requests.length} · trips ${n.trips}`, RX, 100);

    // Caption.
    c.fillStyle = { info: '#cfd8e3', warn: '#f0c060', bad: '#ff7a66', good: '#7ee09a' }[this.captionTone];
    c.font = 'bold 32px system-ui, sans-serif';
    wrap(c, this.caption, RX, 152, W - RX - 24, 40, 5);
    this.panelTex.needsUpdate = true;
  }

  private mirrorStatus(): void {
    const s = this.statusEntity;
    const n = this.night;
    s.setValue(PlayStatus, 'started', this.started);
    s.setValue(PlayStatus, 'clock', clockLabel(n));
    s.setValue(PlayStatus, 'elapsedH', n.elapsedH);
    s.setValue(PlayStatus, 'remainingWh', n.power.remainingWh);
    s.setValue(PlayStatus, 'loadW', loadW(n.cfg, n.power.on));
    s.setValue(PlayStatus, 'source', n.power.source);
    s.setValue(PlayStatus, 'fuelH', n.fuelH);
    s.setValue(PlayStatus, 'on', n.power.on.join(','));
    s.setValue(PlayStatus, 'trips', n.trips);
    s.setValue(PlayStatus, 'backfeedRefusals', n.backfeedRefusals);
    s.setValue(PlayStatus, 'outcome', n.outcome.kind);
    s.setValue(PlayStatus, 'stars', n.outcome.kind === 'won' ? n.outcome.stars : 0);
    s.setValue(PlayStatus, 'caption', this.caption);
    s.setValue(PlayStatus, 'streak', currentStreak(this.streak, this.today));
    s.setValue(PlayStatus, 'streakBest', this.streak.best);
    s.setValue(PlayStatus, 'lookSelects', this.lookSelects);
    s.setValue(PlayStatus, 'lastLookSource', this.lastLookSource);
    s.setValue(PlayStatus, 'mode', this.mode.kind);
    s.setValue(PlayStatus, 'night', this.mode.kind === 'night' ? this.mode.n : 0);
    s.setValue(PlayStatus, 'resumed', this.resumed);
    s.setValue(PlayStatus, 'progress', this.progress.stars.join(','));
    s.setValue(PlayStatus, 'hasGenerator', this.hasGenerator);
    s.setValue(PlayStatus, 'nextLabel', this.nextLabel);
    s.setValue(PlayStatus, 'audio', this.sfx.state);
    s.setValue(PlayStatus, 'cues', this.cueCount);
    s.setValue(PlayStatus, 'recentCues', this.recentCues);
    s.setValue(PlayStatus, 'regainedIgnored', this.regainedIgnored);
    s.setValue(PlayStatus, 'reveal', this.dawnT < 0 ? -1 : growth(this.dawnT));
    s.setValue(PlayStatus, 'revealOn', this.dawnT < 0 ? '' : this.dawnFridge ? (this.dawnFan ? 'fridge,fan' : 'fridge') : this.dawnFan ? 'fan' : '');
  }
}

function fmtW(w: number): string {
  return `${Math.round(w).toLocaleString('en-US')} W`;
}

function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number): void {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > maxW && line) {
      c.fillText(line, x, y + n * lineH);
      if (++n >= maxLines) return;
      line = w;
    } else line = t;
  }
  if (line) c.fillText(line, x, y + n * lineH);
}
