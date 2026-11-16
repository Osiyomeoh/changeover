import { describe, expect, it } from 'vitest';
import { CATALOGUE, MOTOR_START_FACTOR, averageW, toAppliance } from './catalogue.js';
import { validateConfig } from './power-model.js';

describe('catalogue', () => {
  it('ids are unique', () => expect(new Set(CATALOGUE.map((e) => e.id)).size).toBe(CATALOGUE.length));
  for (const e of CATALOGUE) {
    it(`${e.id}: used value lies inside the source range`, () => {
      expect(e.runningW).toBeGreaterThanOrEqual(e.sourceRangeW[0]);
      expect(e.runningW).toBeLessThanOrEqual(e.sourceRangeW[1]);
    });
    it(`${e.id}: duty cycle in (0, 1]`, () => {
      expect(e.dutyCycle).toBeGreaterThan(0);
      expect(e.dutyCycle).toBeLessThanOrEqual(1);
    });
  }
  it('fridge averages a third of nameplate', () => {
    const f = CATALOGUE.find((e) => e.id === 'fridge')!;
    expect(averageW(f)).toBeCloseTo(725 / 3, 10);
  });
  it('motors surge at the start factor, others do not', () => {
    const pump = toAppliance(CATALOGUE.find((e) => e.id === 'pump')!);
    const iron = toAppliance(CATALOGUE.find((e) => e.id === 'iron')!);
    expect(pump.surgeW).toBe(750 * MOTOR_START_FACTOR);
    expect(iron.surgeW).toBe(iron.runningW);
  });
  it('the whole catalogue is a valid power config', () => {
    expect(() => validateConfig({
      appliances: CATALOGUE.map(toAppliance),
      inverter: { continuousW: 1500, surgeW: 3000, efficiency: 0.9 },
      battery: { capacityWh: 2400, usableFraction: 0.8 },
    })).not.toThrow();
  });
});
