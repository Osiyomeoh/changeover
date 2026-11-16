import { describe, expect, it } from 'vitest';
import { CATALOGUE, toAppliance } from './catalogue.js';
import {
  DAWN_HOUR,
  INVERTER,
  NO_STREAK,
  REQUIRED,
  TIERS,
  USABLE_FRACTION,
  currentStreak,
  dailyNight,
  hashString,
  isValidDate,
  localDate,
  minimumUsableWh,
  mulberry32,
  recordWin,
} from './daily.js';
import { initialPower, step, switchOn, type PowerConfig } from './power-model.js';

function allDates(year: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const YEAR = allDates(2027);

function configFor(capacityWh: number): PowerConfig {
  return {
    appliances: CATALOGUE.map(toAppliance),
    inverter: INVERTER,
    battery: { capacityWh, usableFraction: USABLE_FRACTION },
  };
}

describe('PRNG and hash', () => {
  it('hash is stable', () => expect(hashString('changeover:2026-11-18')).toBe(hashString('changeover:2026-11-18')));
  it('hash differs for adjacent dates', () => expect(hashString('a:2026-11-18')).not.toBe(hashString('a:2026-11-19')));
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('mulberry32 stays in [0, 1) and is roughly uniform', () => {
    const r = mulberry32(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
      buckets[Math.floor(x * 10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 10_000)).toBeLessThan(500);
  });
});

describe('dates', () => {
  it('accepts a real date', () => expect(isValidDate('2026-11-18')).toBe(true));
  it('accepts a leap day', () => expect(isValidDate('2028-02-29')).toBe(true));
  it('rejects Feb 30', () => expect(isValidDate('2026-02-30')).toBe(false));
  it('rejects a non-leap Feb 29', () => expect(isValidDate('2027-02-29')).toBe(false));
  it('rejects junk', () => expect(isValidDate('18/11/2026')).toBe(false));
  it('localDate formats with zero padding', () => expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05'));
  it('dailyNight rejects a bad date', () => expect(() => dailyNight('2026-13-01', 'easy')).toThrow());
});

describe('dailyNight', () => {
  it('same date and tier → identical night', () => {
    expect(dailyNight('2026-11-18', 'standard')).toEqual(dailyNight('2026-11-18', 'standard'));
  });
  it('tiers share the night shape', () => {
    const [e, s] = [dailyNight('2026-11-18', 'easy'), dailyNight('2026-11-18', 'standard')];
    expect(e.outageHour).toBe(s.outageHour);
    expect(e.seed).toBe(s.seed);
  });
  it('the nights vary across a year', () => {
    const shapes = new Set(YEAR.map((d) => JSON.stringify(dailyNight(d, 'standard').requests)));
    expect(shapes.size).toBeGreaterThan(300);
  });
  it('outage starts 19:00–22:00 and ends at dawn', () => {
    for (const d of YEAR) {
      const n = dailyNight(d, 'easy');
      expect(n.outageHour).toBeGreaterThanOrEqual(19);
      expect(n.outageHour).toBeLessThanOrEqual(22);
      expect(n.lengthH).toBe(24 - n.outageHour + DAWN_HOUR);
    }
  });
  it('requests fall inside the night, in order, never at the same time', () => {
    for (const d of YEAR) for (const t of TIERS) {
      const r = dailyNight(d, t).requests;
      const len = dailyNight(d, t).lengthH;
      for (let i = 0; i < r.length; i++) {
        expect(r[i].atH).toBeGreaterThan(0);
        expect(r[i].atH).toBeLessThan(len);
        if (i > 0) expect(r[i].atH).toBeGreaterThan(r[i - 1].atH);
      }
    }
  });
  it('requests are never a required load and always in the catalogue', () => {
    const ids = new Set(CATALOGUE.map((c) => c.id));
    for (const d of YEAR) for (const r of dailyNight(d, 'hard').requests) {
      expect(ids.has(r.applianceId)).toBe(true);
      expect(REQUIRED).not.toContain(r.applianceId);
    }
  });
  it('harder tiers have a smaller battery and more requests', () => {
    for (const d of YEAR) {
      const [e, s, h] = TIERS.map((t) => dailyNight(d, t));
      expect(e.batteryCapacityWh).toBeGreaterThan(s.batteryCapacityWh);
      expect(s.batteryCapacityWh).toBeGreaterThan(h.batteryCapacityWh);
      expect(h.requests.length).toBeGreaterThan(e.requests.length);
    }
  });
  it('every night of the year is winnable at every tier (required loads reach dawn)', () => {
    let checked = 0;
    for (const d of YEAR) for (const t of TIERS) {
      const n = dailyNight(d, t);
      const cfg = configFor(n.batteryCapacityWh);
      let s = initialPower(cfg);
      for (const id of REQUIRED) {
        const r = switchOn(cfg, s, id);
        expect(r.result.ok).toBe(true);
        s = r.state;
      }
      s = step(cfg, s, n.lengthH);
      expect(s.on.length).toBe(REQUIRED.length);
      checked++;
    }
    expect(checked).toBe(365 * 3);
  });
  it('hard is tight: under 10% spare over the minimum (after rounding up to 100 Wh)', () => {
    for (const d of YEAR) {
      const n = dailyNight(d, 'hard');
      const spare = (n.batteryCapacityWh * USABLE_FRACTION) / minimumUsableWh(n.lengthH);
      expect(spare).toBeGreaterThan(1);
      expect(spare).toBeLessThan(1.1 + 100 * USABLE_FRACTION / minimumUsableWh(n.lengthH));
    }
  });
});

describe('streak', () => {
  it('first win starts at 1', () => expect(recordWin(NO_STREAK, '2026-11-01')).toEqual({ lastWinDate: '2026-11-01', count: 1, best: 1 }));
  it('consecutive days extend', () => {
    const s = recordWin(recordWin(recordWin(NO_STREAK, '2026-11-01'), '2026-11-02'), '2026-11-03');
    expect(s.count).toBe(3);
    expect(s.best).toBe(3);
  });
  it('a second win the same day changes nothing', () => {
    const s = recordWin(NO_STREAK, '2026-11-01');
    expect(recordWin(s, '2026-11-01')).toBe(s);
  });
  it('a gap restarts at 1 and keeps best', () => {
    const s = recordWin(recordWin(recordWin(NO_STREAK, '2026-11-01'), '2026-11-02'), '2026-11-05');
    expect(s).toEqual({ lastWinDate: '2026-11-05', count: 1, best: 2 });
  });
  it('crosses month and year boundaries', () => {
    expect(recordWin(recordWin(NO_STREAK, '2026-12-31'), '2027-01-01').count).toBe(2);
    expect(recordWin(recordWin(NO_STREAK, '2028-02-28'), '2028-02-29').count).toBe(2);
  });
  it('a clock going backwards is ignored', () => {
    const s = recordWin(NO_STREAK, '2026-11-05');
    expect(recordWin(s, '2026-11-04')).toBe(s);
  });
  it('currentStreak is alive today and tomorrow, dead after', () => {
    const s = recordWin(recordWin(NO_STREAK, '2026-11-01'), '2026-11-02');
    expect(currentStreak(s, '2026-11-02')).toBe(2);
    expect(currentStreak(s, '2026-11-03')).toBe(2);
    expect(currentStreak(s, '2026-11-04')).toBe(0);
  });
  it('no wins → 0', () => expect(currentStreak(NO_STREAK, '2026-11-01')).toBe(0));
  it('rejects a bad date', () => expect(() => recordWin(NO_STREAK, 'nope')).toThrow());
});
