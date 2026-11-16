import { describe, expect, it } from 'vitest';
import { dailyNight, type NightSpec } from './daily.js';
import {
  FRIDGE_GRACE_H,
  REQUEST_WINDOW_H,
  changeSource,
  clockLabel,
  pinchOff,
  pinchOn,
  resetBreaker,
  startNight,
  tick,
  type NightState,
} from './night.js';

const SPEC: NightSpec = {
  date: '2026-11-18', tier: 'standard', seed: 1, outageHour: 20, lengthH: 10,
  batteryCapacityWh: 6000, requests: [{ atH: 2, applianceId: 'tv' }, { atH: 6, applianceId: 'laptop' }],
};

function withEssentials(s: NightState): NightState {
  s = pinchOn(s, 'fridge').state;
  return pinchOn(s, 'fan').state;
}

describe('night', () => {
  it('starts playing at the outage hour', () => {
    const s = startNight(SPEC);
    expect(s.outcome.kind).toBe('playing');
    expect(clockLabel(s)).toBe('20:00');
  });
  it('clock wraps past midnight', () => expect(clockLabel(tick(withEssentials(startNight(SPEC)), 4.5))).toBe('00:30'));
  it('keeping essentials on to dawn wins', () => {
    const s = tick(withEssentials(startNight(SPEC)), 10);
    expect(s.outcome.kind).toBe('won');
  });
  it('frame slicing does not change the result', () => {
    let a = withEssentials(startNight(SPEC));
    a = pinchOn(a, 'tv').state;
    for (let i = 0; i < 1000; i++) a = tick(a, 0.01);
    let b = withEssentials(startNight(SPEC));
    b = pinchOn(b, 'tv').state;
    b = tick(b, 10);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.power.remainingWh).toBeCloseTo(b.power.remainingWh, 6);
  });
  it('ticks after the end do nothing', () => {
    const s = tick(withEssentials(startNight(SPEC)), 10);
    expect(tick(s, 1)).toBe(s);
  });
  it('fridge off past the grace period loses', () => {
    const s = tick(pinchOn(startNight(SPEC), 'fan').state, FRIDGE_GRACE_H + 0.01);
    expect(s.outcome).toEqual({ kind: 'lost', reason: 'fridge-spoiled' });
  });
  it('fridge off within the grace period is forgiven', () => {
    let s = startNight(SPEC);
    s = tick(s, FRIDGE_GRACE_H * 0.9);
    s = tick(withEssentials(s), 10);
    expect(s.outcome.kind).toBe('won');
  });
  it('an empty battery mid-night counts the fridge as off only after the cut-off', () => {
    const small = { ...SPEC, batteryCapacityWh: 100 };
    let s = withEssentials(startNight(small)); // ~80 Wh usable at ~341 Wh/h → ~14 min
    s = tick(s, 0.5);
    expect(s.power.on).toEqual([]);
    expect(s.fridgeOffH).toBeGreaterThan(0.2);
    expect(s.fridgeOffH).toBeLessThan(0.5);
  });
  it('a request opens at its time and is served by switching it on', () => {
    let s = tick(withEssentials(startNight(SPEC)), 2.1);
    expect(s.requests[0].status).toBe('open');
    s = pinchOn(s, 'tv').state;
    expect(s.requests[0].status).toBe('served');
  });
  it('an appliance already on when the request opens serves it', () => {
    let s = pinchOn(withEssentials(startNight(SPEC)), 'tv').state;
    s = tick(s, 2.01);
    expect(s.requests[0].status).toBe('served');
  });
  it('an ignored request expires after the window', () => {
    const s = tick(withEssentials(startNight(SPEC)), 2 + REQUEST_WINDOW_H + 0.01);
    expect(s.requests[0].status).toBe('expired');
  });
  it('3 stars: survive, serve half, no trips', () => {
    let s = tick(withEssentials(startNight(SPEC)), 2.1);
    s = pinchOn(s, 'tv').state;
    s = tick(s, 10);
    expect(s.outcome).toEqual({ kind: 'won', stars: 3 });
  });
  it('a trip costs a star', () => {
    let s = tick(withEssentials(startNight(SPEC)), 0.1);
    s = pinchOn(s, 'iron').state; // 1,800 W > 1,500 W
    expect(s.trips).toBe(1);
    s = resetBreaker(s);
    s = withEssentials(s);
    s = tick(s, 2.0);
    s = pinchOn(s, 'tv').state;
    s = tick(s, 10);
    expect(s.outcome).toEqual({ kind: 'won', stars: 2 });
  });
  it('a trip drops every load until reset', () => {
    let s = pinchOn(withEssentials(startNight(SPEC)), 'iron').state;
    expect(s.power.on).toEqual([]);
    expect(s.power.tripped).toBe(true);
    expect(resetBreaker(s).power.tripped).toBe(false);
  });
  it('pinchOff turns one appliance off', () => {
    expect(pinchOff(withEssentials(startNight(SPEC)), 'fan').power.on).toEqual(['fridge']);
  });
  it('actions after the night ends are ignored', () => {
    const s = tick(withEssentials(startNight(SPEC)), 10);
    expect(pinchOff(s, 'fan')).toBe(s);
    expect(pinchOn(s, 'tv').state).toBe(s);
  });
  it('backfeed refusals are counted and change nothing', () => {
    const s = withEssentials(startNight(SPEC, 1000));
    const r = changeSource(s, 'generator', false);
    expect(r.refused).toBe('backfeed');
    expect(r.state.backfeedRefusals).toBe(1);
    expect(r.state.power.source).toBe('battery');
  });
  it('the generator saves the battery once isolated', () => {
    let s = withEssentials(startNight(SPEC, 1000, 8));
    s = changeSource(s, 'generator', true).state;
    s = tick(s, 5);
    expect(s.power.remainingWh).toBe(6000 * 0.8);
  });
  it('a real daily night is winnable with essentials only', () => {
    const s = tick(withEssentials(startNight(dailyNight('2026-11-18', 'hard'))), 24);
    expect(s.outcome.kind).toBe('won');
  });
  it('fuel burns only while the generator runs', () => {
    let s = withEssentials(startNight(SPEC, 1000, 2));
    s = tick(s, 1);
    expect(s.fuelH).toBe(2);
    s = changeSource(s, 'generator', true).state;
    s = tick(s, 0.5);
    expect(s.fuelH).toBeCloseTo(1.5, 9);
  });
  it('running out of fuel falls back to the battery at exactly the right time', () => {
    let s = withEssentials(startNight(SPEC, 1000, 2));
    s = changeSource(s, 'generator', true).state;
    s = tick(s, 3); // 2 h on generator, then 1 h on battery
    expect(s.power.source).toBe('battery');
    expect(s.fuelH).toBe(0);
    const oneHourWh = (725 / 3 + 65) / 0.9;
    expect(s.power.remainingWh).toBeCloseTo(6000 * 0.8 - oneHourWh, 6);
  });
  it('an empty tank refuses the generator', () => {
    const s = withEssentials(startNight(SPEC, 1000, 0));
    expect(changeSource(s, 'generator', true).refused).toBe('no-fuel');
  });
  it('the fuel fallback is frame-rate independent', () => {
    let a = changeSource(withEssentials(startNight(SPEC, 1000, 2)), 'generator', true).state;
    for (let i = 0; i < 400; i++) a = tick(a, 0.01);
    const b = tick(changeSource(withEssentials(startNight(SPEC, 1000, 2)), 'generator', true).state, 4);
    expect(a.power.remainingWh).toBeCloseTo(b.power.remainingWh, 6);
  });
});
