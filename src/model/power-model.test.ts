import { describe, expect, it } from 'vitest';
import {
  batteryDrawW,
  checkSwitchOn,
  formatHours,
  freezerStep,
  hoursUntilThaw,
  initialPower,
  limits,
  loadW,
  resetTrip,
  runtimeHours,
  setSource,
  step,
  switchOff,
  switchOn,
  usableWh,
  validateConfig,
  type FreezerParams,
  type PowerConfig,
} from './power-model.js';

/**
 * Test fixture. Round numbers chosen to make the arithmetic checkable by hand.
 * These are NOT the game's appliance catalogue and are never shown to players.
 */
const CFG: PowerConfig = {
  appliances: [
    { id: 'fan', runningW: 60, surgeW: 60 },
    { id: 'lights', runningW: 30, surgeW: 30 },
    { id: 'freezer', runningW: 100, surgeW: 600 },
    { id: 'tv', runningW: 80, surgeW: 80 },
    { id: 'iron', runningW: 2000, surgeW: 2000 },
    { id: 'pump', runningW: 750, surgeW: 2500 },
  ],
  inverter: { continuousW: 1500, surgeW: 3000, efficiency: 0.9 },
  battery: { capacityWh: 2400, usableFraction: 0.8 },
  generator: { ratedW: 1000 },
};

const FREEZER: FreezerParams = { ambientC: 30, setpointC: -18, warmTauH: 20, coolTauH: 2 };

function on(...ids: string[]) {
  let s = initialPower(CFG);
  for (const id of ids) {
    const r = switchOn(CFG, s, id);
    expect(r.result.ok).toBe(true);
    s = r.state;
  }
  return s;
}

describe('validateConfig', () => {
  it('accepts the fixture', () => expect(() => validateConfig(CFG)).not.toThrow());
  it('rejects duplicate ids', () => {
    expect(() => validateConfig({ ...CFG, appliances: [CFG.appliances[0], CFG.appliances[0]] })).toThrow(/duplicate/);
  });
  it('rejects negative watts', () => {
    expect(() => validateConfig({ ...CFG, appliances: [{ id: 'x', runningW: -1, surgeW: 0 }] })).toThrow(RangeError);
  });
  it('rejects NaN watts', () => {
    expect(() => validateConfig({ ...CFG, appliances: [{ id: 'x', runningW: NaN, surgeW: 1 }] })).toThrow(RangeError);
  });
  it('rejects surge below running', () => {
    expect(() => validateConfig({ ...CFG, appliances: [{ id: 'x', runningW: 10, surgeW: 5 }] })).toThrow(/surgeW/);
  });
  it('rejects inverter surge below continuous', () => {
    expect(() => validateConfig({ ...CFG, inverter: { continuousW: 10, surgeW: 5, efficiency: 0.9 } })).toThrow();
  });
  it('rejects zero efficiency', () => {
    expect(() => validateConfig({ ...CFG, inverter: { ...CFG.inverter, efficiency: 0 } })).toThrow(/efficiency/);
  });
  it('rejects efficiency above 1', () => {
    expect(() => validateConfig({ ...CFG, inverter: { ...CFG.inverter, efficiency: 1.01 } })).toThrow(/efficiency/);
  });
  it('rejects usableFraction above 1', () => {
    expect(() => validateConfig({ ...CFG, battery: { capacityWh: 1, usableFraction: 1.5 } })).toThrow();
  });
  it('initialPower validates', () => {
    expect(() => initialPower({ ...CFG, battery: { capacityWh: -5, usableFraction: 1 } })).toThrow();
  });
});

describe('battery and load', () => {
  it('usable energy is capacity × usable fraction', () => expect(usableWh(CFG.battery)).toBe(1920));
  it('starts full, on battery, nothing on, not tripped', () => {
    expect(initialPower(CFG)).toEqual({ on: [], remainingWh: 1920, source: 'battery', tripped: false });
  });
  it('load sums running watts', () => expect(loadW(CFG, ['fan', 'lights', 'freezer'])).toBe(190));
  it('load ignores unknown ids', () => expect(loadW(CFG, ['fan', 'ghost'])).toBe(60));
  it('battery draw includes inverter loss', () => expect(batteryDrawW(CFG, 90)).toBeCloseTo(100, 10));
});

describe('runtime', () => {
  it('fan + lights + freezer: 1920 Wh × 0.9 / 190 W', () => {
    expect(runtimeHours(CFG, 1920, 190)).toBeCloseTo(1728 / 190, 10);
  });
  it('formats that as 9 h 5 m', () => expect(formatHours(runtimeHours(CFG, 1920, 190))).toBe('9 h 5 m'));
  it('zero load runs forever', () => expect(runtimeHours(CFG, 1920, 0)).toBe(Infinity));
  it('empty battery runs zero hours', () => expect(runtimeHours(CFG, 0, 100)).toBe(0));
  it('negative remaining clamps to zero', () => expect(runtimeHours(CFG, -10, 100)).toBe(0));
  it('halving the load doubles the runtime', () => {
    expect(runtimeHours(CFG, 1920, 50)).toBeCloseTo(2 * runtimeHours(CFG, 1920, 100), 10);
  });
});

describe('formatHours', () => {
  it('formats whole hours', () => expect(formatHours(2)).toBe('2 h 0 m'));
  it('rounds down, never overstating', () => expect(formatHours(1 + 59.9 / 60)).toBe('1 h 59 m'));
  it('survives float noise at exact minutes', () => expect(formatHours(0.1 * 3)).toBe('0 h 18 m'));
  it('formats infinity', () => expect(formatHours(Infinity)).toBe('∞'));
  it('rejects negatives', () => expect(() => formatHours(-1)).toThrow());
  it('rejects NaN', () => expect(() => formatHours(NaN)).toThrow());
});

describe('switching', () => {
  it('accepts a load within limits', () => expect(checkSwitchOn(CFG, initialPower(CFG), 'fan')).toEqual({ ok: true }));
  it('refuses unknown appliances without tripping', () => {
    const r = switchOn(CFG, initialPower(CFG), 'ghost');
    expect(r.result).toEqual({ ok: false, reason: 'unknown-appliance' });
    expect(r.state.tripped).toBe(false);
  });
  it('refuses switching on twice without tripping', () => {
    const r = switchOn(CFG, on('fan'), 'fan');
    expect(r.result).toEqual({ ok: false, reason: 'already-on' });
    expect(r.state.on).toEqual(['fan']);
  });
  it('the iron overloads the inverter: 2,000 W > 1,500 W', () => {
    expect(checkSwitchOn(CFG, initialPower(CFG), 'iron')).toEqual({
      ok: false, reason: 'overload', demandW: 2000, limitW: 1500,
    });
  });
  it('an overload trips everything off', () => {
    const r = switchOn(CFG, on('fan', 'freezer'), 'iron');
    expect(r.state.on).toEqual([]);
    expect(r.state.tripped).toBe(true);
  });
  it('overload counts the existing load', () => {
    const s = on('pump', 'freezer', 'tv', 'fan', 'lights'); // 1,020 W running
    const big = { ...CFG, appliances: [...CFG.appliances, { id: 'heater', runningW: 500, surgeW: 500 }] };
    expect(checkSwitchOn(big, s, 'heater')).toMatchObject({ reason: 'overload', demandW: 1520 });
  });
  it('a motor start-up surge trips even when the running load would fit', () => {
    // 970 W running + pump 750 W = 1,720 W sustained (fits 2,000 W); 970 + 2,500 W start-up = 3,470 W > 3,000 W.
    const cfg = { ...CFG, inverter: { continuousW: 2000, surgeW: 3000, efficiency: 0.9 } };
    const s = { ...initialPower(cfg), on: ['freezer', 'tv', 'fan', 'lights'] }; // 270 W
    const big = { ...cfg, appliances: [...cfg.appliances, { id: 'ac', runningW: 700, surgeW: 700 }] };
    const s2 = switchOn(big, s, 'ac').state; // 970 W
    expect(checkSwitchOn(big, s2, 'pump')).toEqual({ ok: false, reason: 'surge', demandW: 3470, limitW: 3000 });
  });
  it('freezer surge fits on an empty inverter', () => expect(checkSwitchOn(CFG, initialPower(CFG), 'freezer').ok).toBe(true));
  it('switchOff removes only that appliance', () => expect(switchOff(on('fan', 'lights'), 'fan').on).toEqual(['lights']));
  it('switchOff of an off appliance is a no-op', () => {
    const s = on('fan');
    expect(switchOff(s, 'tv')).toBe(s);
  });
  it('resetTrip clears the trip flag', () => {
    const tripped = switchOn(CFG, initialPower(CFG), 'iron').state;
    expect(resetTrip(tripped).tripped).toBe(false);
  });
  it('switching does not mutate the input state', () => {
    const s = on('fan');
    const before = JSON.stringify(s);
    switchOn(CFG, s, 'lights');
    switchOn(CFG, s, 'iron');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('step (time passing)', () => {
  it('drains battery by load / efficiency × hours', () => {
    expect(step(CFG, on('fan', 'lights'), 1).remainingWh).toBeCloseTo(1920 - 100, 10);
  });
  it('nothing on drains nothing', () => {
    const s = initialPower(CFG);
    expect(step(CFG, s, 5)).toBe(s);
  });
  it('step size does not change the total drain', () => {
    let a = on('fan', 'freezer');
    for (let i = 0; i < 60; i++) a = step(CFG, a, 1 / 60);
    const b = step(CFG, on('fan', 'freezer'), 1);
    expect(a.remainingWh).toBeCloseTo(b.remainingWh, 9);
  });
  it('running out drops every load (low-voltage cut-off)', () => {
    const s = step(CFG, on('fan', 'lights'), 100);
    expect(s.remainingWh).toBe(0);
    expect(s.on).toEqual([]);
  });
  it('the battery lasts exactly runtimeHours', () => {
    const h = runtimeHours(CFG, 1920, 190);
    const s = on('fan', 'lights', 'freezer');
    expect(step(CFG, s, h * 0.999).on.length).toBe(3);
    expect(step(CFG, s, h).on.length).toBe(0);
  });
  it('rejects negative time', () => expect(() => step(CFG, on('fan'), -1)).toThrow());
  it('generator does not drain the battery', () => {
    const g = setSource(CFG, on('fan'), 'generator', true).state;
    expect(step(CFG, g, 10).remainingWh).toBe(1920);
  });
});

describe('generator and backfeed', () => {
  it('refuses the generator when not isolated (backfeed)', () => {
    const s = on('fan');
    const r = setSource(CFG, s, 'generator', false);
    expect(r.refused).toBe('backfeed');
    expect(r.state).toBe(s);
  });
  it('accepts the generator once the interlock is energised', () => {
    const r = setSource(CFG, on('fan'), 'generator', true);
    expect(r.refused).toBeNull();
    expect(r.state.source).toBe('generator');
  });
  it('refuses with no generator configured', () => {
    const cfg = { ...CFG, generator: undefined };
    expect(setSource(cfg, initialPower(cfg), 'generator', true).refused).toBe('no-generator');
  });
  it('generator limits come from its rating', () => expect(limits(CFG, 'generator')).toEqual({ continuousW: 1000, surgeW: 1000 }));
  it('a load too big for the generator trips it on changeover', () => {
    const s = on('pump', 'fan', 'freezer', 'tv', 'lights'); // 1020 W > 1000 W
    const r = setSource(CFG, s, 'generator', true);
    expect(r.state.tripped).toBe(true);
    expect(r.state.on).toEqual([]);
  });
  it('going back to battery is always allowed', () => {
    const g = setSource(CFG, on('fan'), 'generator', true).state;
    expect(setSource(CFG, g, 'battery', false).state.source).toBe('battery');
  });
  it('a motor start-up surge trips a small generator', () => {
    const g = setSource(CFG, on('fan', 'lights'), 'generator', true).state; // 90 W
    // 90 + 750 = 840 W sustained fits 1,000 W; 90 + 2,500 = 2,590 W start-up does not.
    expect(checkSwitchOn(CFG, g, 'pump')).toEqual({ ok: false, reason: 'surge', demandW: 2590, limitW: 1000 });
  });
});

describe('freezer', () => {
  it('warms toward ambient when unpowered', () => {
    const t = freezerStep(FREEZER, -18, false, 20);
    expect(t).toBeCloseTo(30 + (-48) * Math.exp(-1), 10);
  });
  it('cools toward the setpoint when powered', () => {
    expect(freezerStep(FREEZER, 0, true, 100)).toBeCloseTo(-18, 6);
  });
  it('zero time changes nothing', () => expect(freezerStep(FREEZER, -10, false, 0)).toBe(-10));
  it('step size does not change the answer', () => {
    let t = -18;
    for (let i = 0; i < 100; i++) t = freezerStep(FREEZER, t, false, 0.06);
    expect(t).toBeCloseTo(freezerStep(FREEZER, -18, false, 6), 9);
  });
  it('hoursUntilThaw matches the step function', () => {
    const h = hoursUntilThaw(FREEZER, -18, -5);
    expect(freezerStep(FREEZER, -18, false, h)).toBeCloseTo(-5, 9);
  });
  it('already thawed is zero hours', () => expect(hoursUntilThaw(FREEZER, 0, -5)).toBe(0));
  it('never thaws in a room colder than the limit', () => {
    expect(hoursUntilThaw({ ...FREEZER, ambientC: -10 }, -18, -5)).toBe(Infinity);
  });
  it('rejects a non-positive time constant', () => {
    expect(() => freezerStep({ ...FREEZER, warmTauH: 0 }, 0, false, 1)).toThrow();
  });
});
