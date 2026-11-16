/**
 * Appliance catalogue for the game. Every figure is a *nameplate* wattage taken
 * from one public source; where the source gives a range we store the range and
 * the value the game uses, so the README can show both.
 *
 * Source VCE: Virginia Cooperative Extension pub. 2901-9014 (BSE-301NP),
 * "Estimating Appliance and Home Electronic Energy Use", Grisso, Walker, Ignosh,
 * Feb 26 2020. http://pubs.ext.vt.edu/2901/2901-9014/2901-9014.html
 *
 * Motor start-up: the same source says a motor draws "about three times more
 * current in starting the motor than when it is running smoothly"; we model
 * motor surge as 3 × running for motor loads only.
 */
import type { Appliance } from './power-model.js';

export const MOTOR_START_FACTOR = 3;

export interface CatalogueEntry {
  id: string;
  label: string;
  /** Range as printed in the source, watts. */
  sourceRangeW: readonly [number, number];
  /** Value the game uses (always inside the range). */
  runningW: number;
  motor: boolean;
  /** Fraction of time the appliance actually draws power (compressors cycle). 1 = always. */
  dutyCycle: number;
  source: 'VCE';
  note?: string;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  { id: 'fan', label: 'Ceiling fan', sourceRangeW: [65, 175], runningW: 65, motor: true, dutyCycle: 1, source: 'VCE' },
  { id: 'iron', label: 'Clothes iron', sourceRangeW: [1000, 1800], runningW: 1800, motor: false, dutyCycle: 1, source: 'VCE' },
  { id: 'tv', label: 'Flat-screen TV', sourceRangeW: [120, 120], runningW: 120, motor: false, dutyCycle: 1, source: 'VCE' },
  { id: 'laptop', label: 'Laptop', sourceRangeW: [50, 50], runningW: 50, motor: false, dutyCycle: 1, source: 'VCE' },
  {
    id: 'fridge', label: 'Fridge', sourceRangeW: [725, 725], runningW: 725, motor: true, dutyCycle: 1 / 3, source: 'VCE',
    note: 'Source: frost-free 16 cu ft; estimate running hours as plugged-in time ÷ 3.',
  },
  { id: 'pump', label: 'Water pump', sourceRangeW: [250, 1100], runningW: 750, motor: true, dutyCycle: 1, source: 'VCE', note: 'Source: deep well.' },
  { id: 'microwave', label: 'Microwave', sourceRangeW: [750, 1100], runningW: 1100, motor: false, dutyCycle: 1, source: 'VCE' },
  { id: 'kettle', label: 'Coffee maker', sourceRangeW: [900, 1200], runningW: 1000, motor: false, dutyCycle: 1, source: 'VCE' },
  // [FILL] lighting: VCE does not list bulbs; find a citable LED figure before adding.
];

/** Average draw over time (running watts × duty cycle). */
export function averageW(e: CatalogueEntry): number {
  return e.runningW * e.dutyCycle;
}

/** Convert to the power model's Appliance. Average draw drives energy; surge applies to motors. */
export function toAppliance(e: CatalogueEntry): Appliance {
  const runningW = averageW(e);
  return { id: e.id, runningW, surgeW: e.motor ? e.runningW * MOTOR_START_FACTOR : runningW };
}
