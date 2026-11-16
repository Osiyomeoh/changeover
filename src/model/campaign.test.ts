import { describe, expect, it } from 'vitest';
import { CATALOGUE, averageW } from './catalogue.js';
import { DAWN_HOUR, INVERTER } from './daily.js';
import {
  NIGHT_COUNT,
  NO_PROGRESS,
  campaignNight,
  isProgress,
  isUnlocked,
  nextNight,
  nightsWon,
  recordNight,
  type CampaignNight,
} from './campaign.js';
import { FRIDGE_GRACE_H, REQUEST_WINDOW_H, changeSource, pinchOff, pinchOn, startNight, tick, type NightState } from './night.js';
import { batteryDrawW, checkSwitchOn, formatHours, loadW, runtimeHours } from './power-model.js';

const NIGHTS = Array.from({ length: NIGHT_COUNT }, (_, i) => campaignNight(i + 1));
const DT = 1 / 60; // one game minute

interface Play {
  generator: boolean;
  /** 'always': fridge and fan on all night. 'budget': fan only while the battery can carry it to dawn,
   * and the fridge rests (within its grace) when even it alone cannot make it. */
  thrift: 'always' | 'budget';
}

/** A scripted player, stepping one game minute at a time through the pure model. */
function play(c: CampaignNight, p: Play): NightState {
  let s = startNight(c.spec, c.generatorW, c.fuelH);
  s = pinchOn(s, 'fridge').state;
  s = pinchOn(s, 'fan').state;
  if (p.generator && c.generatorW) s = changeSource(s, 'generator', true).state;
  const fridgeW = averageW(CATALOGUE.find((e) => e.id === 'fridge')!);
  const fanW = averageW(CATALOGUE.find((e) => e.id === 'fan')!);
  while (s.outcome.kind === 'playing') {
    // Serve any open request that fits, then switch it straight off.
    for (const r of s.requests) {
      if (r.status === 'open' && checkSwitchOn(s.cfg, s.power, r.applianceId).ok) {
        s = pinchOn(s, r.applianceId).state;
        s = pinchOff(s, r.applianceId);
      }
    }
    if (p.thrift === 'budget' && s.power.source === 'battery') {
      const left = s.spec.lengthH - s.elapsedH;
      const graceLeft = Math.max(0, FRIDGE_GRACE_H - 0.05 - s.fridgeOffH);
      const fridgeOk = s.power.remainingWh >= batteryDrawW(s.cfg, fridgeW) * (left - graceLeft);
      const fanOk = s.power.remainingWh >= batteryDrawW(s.cfg, fridgeW + fanW) * left;
      const on = s.power.on;
      if (fridgeOk && !on.includes('fridge')) s = pinchOn(s, 'fridge').state;
      if (!fridgeOk && on.includes('fridge')) s = pinchOff(s, 'fridge');
      if (fanOk && !s.power.on.includes('fan')) s = pinchOn(s, 'fan').state;
      if (!fanOk && s.power.on.includes('fan')) s = pinchOff(s, 'fan');
    }
    s = tick(s, DT);
  }
  return s;
}

describe('campaign nights', () => {
  it('five fixed nights, each ending at 6 am', () => {
    expect(NIGHTS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5]);
    for (const c of NIGHTS) expect((c.spec.outageHour + c.spec.lengthH) % 24).toBe(DAWN_HOUR);
    expect(NIGHTS.map((c) => c.spec.lengthH)).toEqual([8, 9, 10, 11, 11]);
  });

  it('battery sizes come from the margin rule and shrink relative to need', () => {
    expect(NIGHTS.map((c) => c.spec.batteryCapacityWh)).toEqual([5500, 5200, 2800, 2900, 2600]);
    const margins = NIGHTS.map((c) => c.margin);
    for (let i = 1; i < margins.length; i++) expect(margins[i]).toBeLessThan(margins[i - 1]);
  });

  it('is identical on every call (no randomness)', () => {
    for (let n = 1; n <= NIGHT_COUNT; n++) expect(campaignNight(n)).toEqual(campaignNight(n));
  });

  it('the generator arrives on Night 3', () => {
    expect(NIGHTS.map((c) => c.generatorW !== undefined)).toEqual([false, false, true, true, true]);
    expect(NIGHTS.map((c) => c.generatorW ?? 0)).toEqual([0, 0, 1000, 1000, 1000]);
    expect(NIGHTS.map((c) => c.fuelH)).toEqual([0, 0, 4, 3.5, 3]);
  });

  it('requests are in order, never overlap and close before dawn', () => {
    for (const c of NIGHTS) {
      const r = c.spec.requests;
      for (let i = 0; i < r.length; i++) {
        expect(r[i].atH + REQUEST_WINDOW_H).toBeLessThanOrEqual(c.spec.lengthH);
        if (i > 0) expect(r[i].atH).toBeGreaterThanOrEqual(r[i - 1].atH + REQUEST_WINDOW_H);
      }
    }
    expect(NIGHTS.map((c) => c.spec.requests.length)).toEqual([1, 3, 2, 3, 4]);
    expect(REQUEST_WINDOW_H).toBe(0.5); // README: "each for half an hour of game time"
  });

  it('every request fits the inverter alongside fridge and fan (none is a trap)', () => {
    for (const c of NIGHTS) {
      const s = pinchOn(pinchOn(startNight(c.spec), 'fridge').state, 'fan').state;
      for (const r of c.spec.requests) {
        expect(checkSwitchOn(s.cfg, s.power, r.applianceId), `${c.n} ${r.applianceId}`).toEqual({ ok: true });
      }
      expect(loadW(s.cfg, ['fridge', 'fan'])).toBeLessThan(INVERTER.continuousW);
    }
  });

  it('battery only, fridge and fan all night: Nights 1–2 reach dawn, Nights 3–5 spoil the fridge', () => {
    const out = NIGHTS.map((c) => play(c, { generator: false, thrift: 'always' }).outcome.kind);
    expect(out).toEqual(['won', 'won', 'lost', 'lost', 'lost']);
  });

  it('the battery clock at the start of each night, fridge and fan on (README numbers)', () => {
    const shown = NIGHTS.map((c) => {
      const s = startNight(c.spec, c.generatorW, c.fuelH);
      const w = loadW(s.cfg, ['fridge', 'fan']);
      return `${c.spec.batteryCapacityWh} Wh: ${formatHours(runtimeHours(s.cfg, s.power.remainingWh, w))} of ${c.spec.lengthH} h`;
    });
    expect(shown).toEqual([
      '5500 Wh: 12 h 54 m of 8 h',
      '5200 Wh: 12 h 12 m of 9 h',
      '2800 Wh: 6 h 34 m of 10 h',
      '2900 Wh: 6 h 48 m of 11 h',
      '2600 Wh: 6 h 6 m of 11 h',
    ]);
  });

  it('Nights 3–5 cannot be won without the generator, even dropping the fan and resting the fridge', () => {
    for (const c of NIGHTS.slice(2)) {
      const s = play(c, { generator: false, thrift: 'budget' });
      expect(s.outcome, `night ${c.n}`).toEqual({ kind: 'lost', reason: 'fridge-spoiled' });
    }
  });

  it('with the generator and a budget, every night is won', () => {
    const res = NIGHTS.map((c) => play(c, { generator: true, thrift: 'budget' }));
    for (const s of res) expect(s.outcome.kind).toBe('won');
    expect(res.map((s) => (s.outcome.kind === 'won' ? s.outcome.stars : 0))).toEqual([3, 3, 3, 3, 3]);
    // Nights 3–5 burn the whole tank: the fuel figure is not decorative.
    expect(res.slice(2).map((s) => s.fuelH)).toEqual([0, 0, 0]);
  });

  it('Nights 4–5: with fridge and fan on all night, the battery dies before dawn even after the whole tank', () => {
    for (const n of [4, 5]) {
      const s = play(campaignNight(n), { generator: true, thrift: 'always' });
      expect(s.power.remainingWh, `night ${n}`).toBe(0);
      expect(s.fridgeOffH, `night ${n}`).toBeGreaterThan(0);
    }
    // Night 3 is the gentle one: the whole tank plus the battery carry both.
    const s3 = play(campaignNight(3), { generator: true, thrift: 'always' });
    expect(s3.power.remainingWh).toBeGreaterThan(0);
    expect(s3.fridgeOffH).toBe(0);
  });

  it('rejects night numbers outside 1–5', () => {
    for (const n of [0, 6, 1.5, Number.NaN]) expect(() => campaignNight(n)).toThrow(RangeError);
  });
});

describe('campaign progress', () => {
  it('starts at Night 1 with only Night 1 open', () => {
    expect(nextNight(NO_PROGRESS)).toBe(1);
    expect([1, 2, 3, 4, 5].map((n) => isUnlocked(NO_PROGRESS, n))).toEqual([true, false, false, false, false]);
    expect(nightsWon(NO_PROGRESS)).toBe(0);
  });

  it('a win unlocks the next night; best stars are kept', () => {
    let p = recordNight(NO_PROGRESS, 1, 2);
    expect(nextNight(p)).toBe(2);
    expect(isUnlocked(p, 2)).toBe(true);
    expect(isUnlocked(p, 3)).toBe(false);
    p = recordNight(p, 1, 1);
    expect(p.stars[0]).toBe(2);
    p = recordNight(p, 1, 3);
    expect(p.stars[0]).toBe(3);
  });

  it('a loss (0 stars) changes nothing and returns the same object', () => {
    const p = recordNight(NO_PROGRESS, 1, 2);
    expect(recordNight(p, 2, 0)).toBe(p);
  });

  it('after all five, a returning player lands on Night 5', () => {
    let p = NO_PROGRESS;
    for (let n = 1; n <= 5; n++) p = recordNight(p, n, 1);
    expect(nextNight(p)).toBe(5);
    expect(nightsWon(p)).toBe(5);
  });

  it('does not mutate NO_PROGRESS', () => {
    recordNight(NO_PROGRESS, 3, 3);
    expect(NO_PROGRESS.stars).toEqual([0, 0, 0, 0, 0]);
  });

  it.each([
    ['null', null],
    ['short', { stars: [1, 0] }],
    ['four stars', { stars: [4, 0, 0, 0, 0] }],
    ['fraction', { stars: [1.5, 0, 0, 0, 0] }],
    ['string', { stars: ['1', 0, 0, 0, 0] }],
    ['negative', { stars: [-1, 0, 0, 0, 0] }],
  ])('rejects malformed progress (%s)', (_n, v) => {
    expect(isProgress(v)).toBe(false);
  });

  it('rejects bad arguments', () => {
    expect(() => recordNight(NO_PROGRESS, 6, 1)).toThrow(RangeError);
    expect(() => recordNight(NO_PROGRESS, 1, 4)).toThrow(RangeError);
  });
});
