import { describe, expect, it } from 'vitest';
import { NO_PROGRESS, campaignNight, recordNight } from './campaign.js';
import { dailyNight } from './daily.js';
import { changeSource, pinchOn, startNight, tick, type NightState } from './night.js';
import {
  PROGRESS_KEY,
  SESSION_KEY,
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
} from './session.js';
import type { KeyValueStore } from './streak-store.js';

const TODAY = '2026-11-04';
const N3: Mode = { kind: 'night', n: 3 };
const SLOTS = 4;
const daily = (date: string, tier: 'easy' | 'standard' | 'hard') => startNight(dailyNight(date, tier));

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const blocked: KeyValueStore = {
  getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
};

/** Night 3, two game hours in: fridge + fan on, on the generator, one request served. */
function midNight3(): NightState {
  let s = startFor(N3, daily);
  s = pinchOn(s, 'fridge').state;
  s = pinchOn(s, 'fan').state;
  s = changeSource(s, 'generator', true).state;
  s = tick(s, 1.5);
  s = pinchOn(s, 'tv').state; // request at 1.5 h
  s = tick(s, 0.5);
  return s;
}

describe('snapshot / restore', () => {
  it('round-trips through JSON, resuming on the battery with nothing tripped', () => {
    const s = midNight3();
    const snap = JSON.parse(JSON.stringify(snapshot(N3, s, ['fan', 'tv', 'fridge']))) as unknown;
    const r = restore(snap, startFor(N3, daily), SLOTS)!;
    expect(r).not.toBeNull();
    expect(r.elapsedH).toBeCloseTo(2, 9);
    expect(r.fuelH).toBeCloseTo(2, 9);
    expect(r.power.on).toEqual(['fan', 'tv', 'fridge']);
    expect(r.power.source).toBe('battery');
    expect(r.power.tripped).toBe(false);
    expect(r.power.remainingWh).toBe(s.power.remainingWh);
    expect(r.requests.map((q) => q.status)).toEqual(s.requests.map((q) => q.status));
    expect(r.outcome.kind).toBe('playing');
  });

  it('keeps the board order the player left it in, dropping anything not on', () => {
    const s = midNight3();
    expect(snapshot(N3, s, ['tv', 'iron', 'fridge', 'fan']).on).toEqual(['tv', 'fridge', 'fan']);
  });

  it('resumed and uninterrupted nights end the same way', () => {
    let a = pinchOn(pinchOn(startFor(N3, daily), 'fridge').state, 'fan').state;
    a = tick(a, 3);
    const b = restore(JSON.parse(JSON.stringify(snapshot(N3, a, ['fridge', 'fan']))), startFor(N3, daily), SLOTS)!;
    expect(tick(b, 20)).toEqual(tick(a, 20));
  });

  const base = () => snapshot(N3, midNight3(), ['fridge', 'fan', 'tv']) as unknown as Record<string, unknown>;
  it.each<[string, (s: Record<string, unknown>) => void]>([
    ['wrong version', (s) => { s.v = 2; }],
    ['bad mode', (s) => { s.mode = { kind: 'night', n: 9 }; }],
    ['negative time', (s) => { s.elapsedH = -1; }],
    ['finished night', (s) => { s.elapsedH = 10; }],
    ['NaN battery', (s) => { s.remainingWh = Number.NaN; }],
    ['battery above usable', (s) => { s.remainingWh = 1e9; }],
    ['more fuel than the tank', (s) => { s.fuelH = 5; }],
    ['fridge off longer than the grace', (s) => { s.fridgeOffH = 2; }],
    ['fractional trips', (s) => { s.trips = 0.5; }],
    ['unknown appliance', (s) => { s.on = ['fridge', 'toaster']; }],
    ['duplicate appliance', (s) => { s.on = ['fan', 'fan']; }],
    ['more than the board holds', (s) => { s.on = ['fridge', 'fan', 'tv', 'laptop', 'pump']; }],
    ['over the inverter limit', (s) => { s.on = ['iron', 'fridge']; }],
    ['request count mismatch', (s) => { s.requests = ['served']; }],
    ['bad request status', (s) => { s.requests = ['done', 'pending']; }],
  ])('rejects a tampered snapshot: %s', (_n, mutate) => {
    const s = base();
    mutate(s);
    expect(restore(s, startFor(N3, daily), SLOTS)).toBeNull();
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 3, 'x', []]) expect(restore(v, startFor(N3, daily), SLOTS)).toBeNull();
  });
});

describe('chooseStart', () => {
  const won12 = recordNight(recordNight(NO_PROGRESS, 1, 3), 2, 1);
  const snap3 = { v: 1, mode: N3 };

  it('a first visit plays Night 1', () => {
    expect(chooseStart('', TODAY, NO_PROGRESS, null)).toEqual({
      mode: { kind: 'night', n: 1 }, resume: null, discard: false, countsForStreak: false,
    });
  });

  it('a returning player resumes the campaign night in progress', () => {
    const s = chooseStart('', TODAY, won12, snap3);
    expect(s.mode).toEqual(N3);
    expect(s.resume).toBe(snap3);
    expect(s.discard).toBe(false);
  });

  it('with nothing in progress, the first night not yet won', () => {
    expect(chooseStart('', TODAY, won12, null).mode).toEqual(N3);
  });

  it('?night=N plays an unlocked night; a locked one falls back', () => {
    expect(chooseStart('?night=2', TODAY, won12, null).mode).toEqual({ kind: 'night', n: 2 });
    expect(chooseStart('?night=5', TODAY, won12, null).mode).toEqual(N3);
    expect(chooseStart('?night=abc', TODAY, NO_PROGRESS, null).mode).toEqual({ kind: 'night', n: 1 });
  });

  it('?night=N for a different night discards the saved one', () => {
    const s = chooseStart('?night=1', TODAY, won12, snap3);
    expect(s.resume).toBeNull();
    expect(s.discard).toBe(true);
  });

  it('?fresh discards and never resumes', () => {
    const s = chooseStart('?fresh', TODAY, won12, snap3);
    expect(s.mode).toEqual(N3);
    expect(s.resume).toBeNull();
    expect(s.discard).toBe(true);
  });

  it('?daily is today at standard and counts for the streak; ?date replays do not', () => {
    expect(chooseStart('?daily', TODAY, NO_PROGRESS, null)).toMatchObject({
      mode: { kind: 'daily', date: TODAY, tier: 'standard' }, countsForStreak: true,
    });
    expect(chooseStart('?tier=hard', TODAY, NO_PROGRESS, null).mode).toEqual({ kind: 'daily', date: TODAY, tier: 'hard' });
    expect(chooseStart('?date=2026-11-01', TODAY, NO_PROGRESS, null).countsForStreak).toBe(false);
    expect(chooseStart('?date=2026-02-30', TODAY, NO_PROGRESS, null).mode).toEqual({ kind: 'daily', date: TODAY, tier: 'standard' });
  });

  it('a Daily resumes only the same date and tier', () => {
    const saved = { v: 1, mode: { kind: 'daily', date: TODAY, tier: 'hard' } };
    expect(chooseStart('?tier=hard', TODAY, NO_PROGRESS, saved).resume).toBe(saved);
    expect(chooseStart('?tier=easy', TODAY, NO_PROGRESS, saved).resume).toBeNull();
    expect(chooseStart('?tier=hard', '2026-11-05', NO_PROGRESS, saved).resume).toBeNull();
  });

  it('a garbage saved value is discarded, not resumed', () => {
    const s = chooseStart('', TODAY, NO_PROGRESS, { mode: 'night-3' });
    expect(s.resume).toBeNull();
    expect(s.discard).toBe(true);
  });
});

describe('startFor', () => {
  it('builds the campaign night with its generator and fuel', () => {
    const s = startFor(N3, daily);
    const c = campaignNight(3);
    expect(s.spec).toEqual(c.spec);
    expect(s.fuelH).toBe(4);
    expect(s.cfg.generator?.ratedW).toBe(1000);
  });
  it('Night 1 has no generator', () => {
    expect(startFor({ kind: 'night', n: 1 }, daily).cfg.generator).toBeUndefined();
  });
  it('delegates the Daily to the given builder', () => {
    expect(startFor({ kind: 'daily', date: TODAY, tier: 'easy' }, daily).spec).toEqual(dailyNight(TODAY, 'easy'));
  });
});

describe('storage', () => {
  it('progress round-trips; corrupt or blocked storage is no progress', () => {
    const m = memory();
    const p = recordNight(NO_PROGRESS, 1, 2);
    expect(saveProgress(m, p)).toBe(true);
    expect(loadProgress(m)).toEqual(p);
    m.data.set(PROGRESS_KEY, '{"stars":[9,0,0,0,0]}');
    expect(loadProgress(m)).toEqual(NO_PROGRESS);
    m.data.set(PROGRESS_KEY, '{oops');
    expect(loadProgress(m)).toEqual(NO_PROGRESS);
    expect(loadProgress(blocked)).toEqual(NO_PROGRESS);
    expect(saveProgress(blocked, p)).toBe(false);
    expect(loadProgress(null)).toEqual(NO_PROGRESS);
  });

  it('session save, load and clear', () => {
    const m = memory();
    const snap = snapshot(N3, midNight3(), ['fridge', 'fan', 'tv']);
    expect(saveSession(m, snap)).toBe(true);
    expect(loadSession(m)).toEqual(snap);
    expect(clearSession(m)).toBe(true);
    expect(loadSession(m)).toBeNull();
    m.data.set(SESSION_KEY, '{oops');
    expect(loadSession(m)).toBeNull();
    expect(loadSession(blocked)).toBeNull();
    expect(saveSession(blocked, snap)).toBe(false);
  });
});
