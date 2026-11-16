/**
 * Which night a page load plays, and how an unfinished night survives a reload.
 * Pure apart from the storage handed in (see streak-store.ts for why storage
 * may be missing or throw).
 *
 * URL: no query → the campaign at the first night not yet won (or the night in
 * progress); ?night=N → campaign Night N if unlocked; ?daily, ?tier=, ?date= →
 * the Daily Outage; ?fresh → ignore and discard the saved night.
 *
 * A reload resumes on the battery with the changeover back at its safe rest
 * position: the interlock is held by the player's hands, and hands do not
 * survive a reload. Nothing is energised that the player has not just approved.
 */
import { CATALOGUE } from './catalogue.js';
import { NO_PROGRESS, campaignNight, isNightNumber, isProgress, isUnlocked, nextNight, type Progress } from './campaign.js';
import { INVERTER, TIERS, isValidDate, type Tier } from './daily.js';
import { FRIDGE_GRACE_H, startNight, type NightState, type RequestState } from './night.js';
import { loadW, usableWh } from './power-model.js';
import type { KeyValueStore } from './streak-store.js';

export const SESSION_KEY = 'changeover.session.v1';
export const PROGRESS_KEY = 'changeover.nights.v1';

export type Mode = { kind: 'night'; n: number } | { kind: 'daily'; date: string; tier: Tier };

export interface Snapshot {
  v: 1;
  mode: Mode;
  elapsedH: number;
  fridgeOffH: number;
  trips: number;
  backfeedRefusals: number;
  fuelH: number;
  remainingWh: number;
  /** Appliances on, in circuit order. */
  on: string[];
  requests: RequestState['status'][];
}

const STATUSES: readonly string[] = ['pending', 'open', 'served', 'expired'];
const IDS = new Set(CATALOGUE.map((c) => c.id));

export function sameMode(a: Mode, b: Mode): boolean {
  if (a.kind === 'night' && b.kind === 'night') return a.n === b.n;
  if (a.kind === 'daily' && b.kind === 'daily') return a.date === b.date && a.tier === b.tier;
  return false;
}

function isMode(v: unknown): v is Mode {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  if (m.kind === 'night') return typeof m.n === 'number' && isNightNumber(m.n);
  if (m.kind === 'daily') {
    return typeof m.date === 'string' && isValidDate(m.date) && (TIERS as readonly unknown[]).includes(m.tier);
  }
  return false;
}

/** Capture a night in play. `onInSlotOrder` is the board left to right. */
export function snapshot(mode: Mode, s: NightState, onInSlotOrder: readonly string[]): Snapshot {
  return {
    v: 1,
    mode,
    elapsedH: s.elapsedH,
    fridgeOffH: s.fridgeOffH,
    trips: s.trips,
    backfeedRefusals: s.backfeedRefusals,
    fuelH: s.fuelH,
    remainingWh: s.power.remainingWh,
    on: onInSlotOrder.filter((id) => s.power.on.includes(id)),
    requests: s.requests.map((r) => r.status),
  };
}

/**
 * Rebuild a night from a snapshot, or null if the snapshot does not belong to
 * `fresh` (the same night started anew) or fails any bound. `maxOn` is the
 * number of circuits on the board.
 */
export function restore(snap: unknown, fresh: NightState, maxOn: number): NightState | null {
  if (typeof snap !== 'object' || snap === null) return null;
  const s = snap as Record<string, unknown>;
  if (s.v !== 1 || !isMode(s.mode)) return null;
  const num = (k: string, lo: number, hi: number): number | null => {
    const x = s[k];
    return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : null;
  };
  const int = (k: string): number | null => {
    const x = num(k, 0, 100_000);
    return x !== null && Number.isInteger(x) ? x : null;
  };
  const elapsedH = num('elapsedH', 0, fresh.spec.lengthH);
  const fridgeOffH = num('fridgeOffH', 0, FRIDGE_GRACE_H);
  const fuelH = num('fuelH', 0, fresh.fuelH);
  const remainingWh = num('remainingWh', 0, usableWh(fresh.cfg.battery));
  const trips = int('trips');
  const backfeedRefusals = int('backfeedRefusals');
  if ([elapsedH, fridgeOffH, fuelH, remainingWh, trips, backfeedRefusals].some((x) => x === null)) return null;
  if (elapsedH! >= fresh.spec.lengthH) return null; // a finished night is not resumed
  if (fridgeOffH! > elapsedH! + 1e-9) return null;

  const on = s.on;
  if (!Array.isArray(on) || on.length > maxOn) return null;
  if (!on.every((id) => typeof id === 'string' && IDS.has(id))) return null;
  if (new Set(on).size !== on.length) return null;
  // Resumes on the battery, so the board must be within the inverter's limit.
  if (loadW(fresh.cfg, on as string[]) > INVERTER.continuousW) return null;

  const req = s.requests;
  if (!Array.isArray(req) || req.length !== fresh.requests.length) return null;
  if (!req.every((x) => typeof x === 'string' && STATUSES.includes(x))) return null;

  return {
    ...fresh,
    elapsedH: elapsedH!,
    fridgeOffH: fridgeOffH!,
    fuelH: fuelH!,
    trips: trips!,
    backfeedRefusals: backfeedRefusals!,
    power: { on: (on as string[]).slice(), remainingWh: remainingWh!, source: 'battery', tripped: false },
    requests: fresh.requests.map((r, i) => ({ ...r, status: req[i] as RequestState['status'] })),
  };
}

// ---------- choosing the night ----------

export interface Start {
  mode: Mode;
  /** The snapshot to resume, if any (still to be checked by `restore`). */
  resume: unknown;
  /** True if the saved night should be discarded. */
  discard: boolean;
  /** Today's Daily counts toward the streak; replays and the campaign do not. */
  countsForStreak: boolean;
}

export function chooseStart(search: string, today: string, progress: Progress, saved: unknown): Start {
  const q = new URLSearchParams(search);
  const fresh = q.has('fresh');
  const savedMode = typeof saved === 'object' && saved !== null ? (saved as { mode?: unknown }).mode : undefined;
  const pick = (mode: Mode, countsForStreak: boolean): Start => {
    const matches = !fresh && isMode(savedMode) && sameMode(savedMode, mode);
    return { mode, resume: matches ? saved : null, discard: fresh || (saved != null && !matches), countsForStreak };
  };

  if (q.has('daily') || q.has('tier') || q.has('date')) {
    const t = q.get('tier');
    const d = q.get('date');
    const tier = (TIERS as readonly string[]).includes(t ?? '') ? (t as Tier) : 'standard';
    const date = d && isValidDate(d) ? d : today;
    return pick({ kind: 'daily', date, tier }, date === today);
  }
  const asked = Number(q.get('night'));
  if (q.has('night') && isNightNumber(asked) && isUnlocked(progress, asked)) {
    return pick({ kind: 'night', n: asked }, false);
  }
  // Default: the campaign night in progress, else the first not yet won.
  if (!fresh && !q.has('night') && isMode(savedMode) && savedMode.kind === 'night' && isUnlocked(progress, savedMode.n)) {
    return pick(savedMode, false);
  }
  return pick({ kind: 'night', n: nextNight(progress) }, false);
}

/** The NightState a mode starts from. */
export function startFor(mode: Mode, dailySpec: (date: string, tier: Tier) => NightState): NightState {
  if (mode.kind === 'daily') return dailySpec(mode.date, mode.tier);
  const c = campaignNight(mode.n);
  return startNight(c.spec, c.generatorW, c.fuelH);
}

// ---------- storage ----------

function readJson(store: KeyValueStore | null, key: string): unknown {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore | null, key: string, v: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function loadProgress(store: KeyValueStore | null): Progress {
  const v = readJson(store, PROGRESS_KEY);
  return isProgress(v) ? { stars: v.stars.slice() } : NO_PROGRESS;
}

export function saveProgress(store: KeyValueStore | null, p: Progress): boolean {
  return writeJson(store, PROGRESS_KEY, p);
}

/** The raw saved night (validate with `restore`). */
export function loadSession(store: KeyValueStore | null): unknown {
  return readJson(store, SESSION_KEY);
}

export function saveSession(store: KeyValueStore | null, s: Snapshot): boolean {
  return writeJson(store, SESSION_KEY, s);
}

/** Forget the saved night (finished, or replaced). Writing a null keeps KeyValueStore minimal. */
export function clearSession(store: KeyValueStore | null): boolean {
  return writeJson(store, SESSION_KEY, null);
}

