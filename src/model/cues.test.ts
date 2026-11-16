import { describe, expect, it } from 'vitest';
import { campaignNight } from './campaign.js';
import { LOW_BATTERY_FRACTION, cuesFor, type Cue } from './cues.js';
import { changeSource, pinchOff, pinchOn, startNight, tick, type NightState } from './night.js';
import { usableWh } from './power-model.js';

/** Night 3: generator with 4 h of fuel; requests tv at 1.5 h and kettle at 6 h. */
const n3 = (): NightState => {
  const c = campaignNight(3);
  return startNight(c.spec, c.generatorW, c.fuelH);
};
const on = (s: NightState, ...ids: string[]) => ids.reduce((x, id) => pinchOn(x, id).state, s);

describe('cuesFor', () => {
  it('no change, or a different night, is silent', () => {
    const s = n3();
    expect(cuesFor(s, s)).toEqual([]);
    const c1 = campaignNight(1);
    expect(cuesFor(s, on(startNight(c1.spec), 'fridge'))).toEqual([]);
  });

  it('switching on and off', () => {
    const a = n3();
    const b = on(a, 'fridge');
    expect(cuesFor(a, b)).toEqual(['plug']);
    expect(cuesFor(b, pinchOff(b, 'fridge'))).toEqual(['unplug']);
  });

  it('an overload trips (one cue, not an unplug per appliance)', () => {
    const a = on(n3(), 'fridge', 'fan');
    const b = on(a, 'iron');
    expect(b.power.on).toEqual([]);
    expect(cuesFor(a, b)).toEqual(['trip']);
  });

  it('the generator: refused without the changeover, starts with it, stops when the fuel runs out', () => {
    const a = on(n3(), 'fridge');
    expect(cuesFor(a, changeSource(a, 'generator', false).state)).toEqual(['refused']);
    const b = changeSource(a, 'generator', true).state;
    expect(cuesFor(a, b)).toEqual(['gen-start']);
    const c = tick(b, 4.01); // the tank holds 4 h; the TV request opened and closed meanwhile
    expect(cuesFor(b, c)).toEqual(['gen-stop', 'missed']);
  });

  it('requests: opening, served, missed', () => {
    const a = on(n3(), 'fridge');
    const b = tick(a, 1.5);
    expect(cuesFor(a, b)).toEqual(['request']);
    const served = on(b, 'tv');
    expect(cuesFor(b, served)).toEqual(['plug', 'served']);
    expect(cuesFor(b, tick(b, 0.5))).toEqual(['missed']);
  });

  it('the battery warns once at the low mark, then dies', () => {
    let s = on(n3(), 'fridge', 'fan');
    const low = usableWh(s.cfg.battery) * LOW_BATTERY_FRACTION;
    const heard: Cue[] = [];
    let warnedAtWh = -1;
    while (s.power.remainingWh > 0) {
      const next = tick(s, 1 / 60);
      for (const c of cuesFor(s, next)) {
        heard.push(c);
        if (c === 'battery-low') warnedAtWh = next.power.remainingWh;
      }
      s = next;
    }
    expect(heard.filter((c) => c === 'battery-low')).toHaveLength(1);
    expect(heard.filter((c) => c === 'battery-dead')).toHaveLength(1);
    expect(heard).not.toContain('unplug'); // the lights going out is not a switch-off
    expect(warnedAtWh).toBeLessThanOrEqual(low);
    expect(warnedAtWh).toBeGreaterThan(0);
  });

  it('dawn and a spoiled fridge', () => {
    const c1 = campaignNight(1);
    const a = on(startNight(c1.spec), 'fridge');
    expect(cuesFor(a, tick(a, c1.spec.lengthH))).toContain('dawn');
    const b = on(startNight(c1.spec), 'fan'); // fridge never on
    // Night 1's laptop request opens at 1 h, just before the fridge passes its 1 h grace.
    expect(cuesFor(b, tick(b, 1.1))).toEqual(['request', 'spoiled']);
  });

  it('reuses the array it is given', () => {
    const out: Cue[] = ['dawn'];
    const a = n3();
    expect(cuesFor(a, on(a, 'fan'), out)).toBe(out);
    expect(out).toEqual(['plug']);
  });
});
