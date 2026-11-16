/**
 * Nights 1–5: the fixed sequence every player gets, in order, with no
 * randomness. Each night adds one idea:
 *
 *  1. Pinch loads on and keep the fridge cold until dawn. Battery to spare.
 *  2. The flat asks for things (requests). The battery is smaller.
 *  3. The battery alone cannot reach dawn: the generator, and so the two-hand
 *     changeover, is needed to finish.
 *  4. Battery plus fuel no longer cover fridge and fan all night: something must give.
 *  5. Longest night, least battery and fuel, four requests.
 *
 * Battery sizes use the same rule as the Daily Outage: a multiple ("margin") of
 * the usable energy the fridge and fan need from outage to dawn. Every night is
 * proven winnable, and Nights 3–5 proven to need the generator, by the
 * scripted plays in campaign.test.ts.
 *
 * Progress is the best star count per night; a night unlocks once the one
 * before it has been won. Pure; storage lives in session.ts.
 */
import { DAWN_HOUR, USABLE_FRACTION, hashString, minimumUsableWh, type NightSpec, type Request, type Tier } from './daily.js';

export const NIGHT_COUNT = 5;
/** Generator rating (W). A game parameter for the fictional flat. */
export const GENERATOR_W = 1000;

export interface CampaignNight {
  /** 1-based night number. */
  n: number;
  title: string;
  /** The line shown when the night starts. */
  brief: string;
  spec: NightSpec;
  /** Battery size as a multiple of what fridge + fan need until dawn. */
  margin: number;
  /** Undefined on nights without a generator. */
  generatorW: number | undefined;
  /** Generator run time in the tank, game hours. */
  fuelH: number;
}

interface NightDef {
  title: string;
  brief: string;
  tier: Tier;
  outageHour: number;
  margin: number;
  fuelH: number;
  requests: Request[];
}

const DEFS: readonly NightDef[] = [
  {
    title: 'First night',
    brief: 'Grid down. Put the FRIDGE on a circuit: pinch and drop it, or look at it and pinch.',
    tier: 'easy', outageHour: 22, margin: 1.6, fuelH: 0,
    requests: [{ atH: 1, applianceId: 'laptop' }],
  },
  {
    title: 'Requests',
    brief: 'The flat will ask for things. Each one costs battery. Fridge first.',
    tier: 'easy', outageHour: 21, margin: 1.35, fuelH: 0,
    requests: [
      { atH: 1, applianceId: 'tv' },
      { atH: 3.5, applianceId: 'kettle' },
      { atH: 6, applianceId: 'pump' },
    ],
  },
  {
    title: 'The generator',
    brief: 'The battery will not last until 6 am. You need the generator: isolate, then throw the changeover.',
    tier: 'standard', outageHour: 20, margin: 0.65, fuelH: 4,
    requests: [
      { atH: 1.5, applianceId: 'tv' },
      { atH: 6, applianceId: 'kettle' },
    ],
  },
  {
    title: 'Not enough for everything',
    brief: 'Battery and fuel will not carry everything. The fridge first, then what the flat asks for.',
    tier: 'standard', outageHour: 19, margin: 0.6, fuelH: 3.5,
    requests: [
      { atH: 1, applianceId: 'microwave' },
      { atH: 4, applianceId: 'laptop' },
      { atH: 8, applianceId: 'pump' },
    ],
  },
  {
    title: 'The long night',
    brief: 'Eleven hours, the smallest battery, three hours of fuel. The fridge may be off one hour in total.',
    tier: 'hard', outageHour: 19, margin: 0.55, fuelH: 3,
    requests: [
      { atH: 0.75, applianceId: 'tv' },
      { atH: 3, applianceId: 'kettle' },
      { atH: 6.5, applianceId: 'laptop' },
      { atH: 9, applianceId: 'microwave' },
    ],
  },
];

/** Battery capacity (Wh, rounded up to 100) giving `margin` × the fridge-and-fan need. */
export function batteryForMargin(lengthH: number, margin: number): number {
  return Math.ceil((minimumUsableWh(lengthH) * margin) / USABLE_FRACTION / 100) * 100;
}

export function isNightNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= NIGHT_COUNT;
}

export function campaignNight(n: number): CampaignNight {
  if (!isNightNumber(n)) throw new RangeError(`no night ${n}`);
  const d = DEFS[n - 1];
  const lengthH = 24 - d.outageHour + DAWN_HOUR;
  const spec: NightSpec = {
    date: '', // not a dated night; only the Daily Outage carries a date
    tier: d.tier,
    seed: hashString(`changeover:night-${n}`),
    outageHour: d.outageHour,
    lengthH,
    batteryCapacityWh: batteryForMargin(lengthH, d.margin),
    requests: d.requests.map((r) => ({ ...r })),
  };
  return {
    n,
    title: d.title,
    brief: d.brief,
    spec,
    margin: d.margin,
    generatorW: d.fuelH > 0 ? GENERATOR_W : undefined,
    fuelH: d.fuelH,
  };
}

// ---------- progress ----------

export interface Progress {
  /** Best stars per night, index n - 1. 0 = not yet won. */
  stars: number[];
}

export const NO_PROGRESS: Progress = { stars: new Array<number>(NIGHT_COUNT).fill(0) };

export function isProgress(v: unknown): v is Progress {
  if (typeof v !== 'object' || v === null) return false;
  const s = (v as Record<string, unknown>).stars;
  return (
    Array.isArray(s) &&
    s.length === NIGHT_COUNT &&
    s.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 3)
  );
}

/** Keep the best result per night; a loss changes nothing. */
export function recordNight(p: Progress, n: number, stars: number): Progress {
  if (!isNightNumber(n)) throw new RangeError(`no night ${n}`);
  if (!Number.isInteger(stars) || stars < 0 || stars > 3) throw new RangeError(`bad stars ${stars}`);
  if (stars <= p.stars[n - 1]) return p;
  const next = p.stars.slice();
  next[n - 1] = stars;
  return { stars: next };
}

export function isUnlocked(p: Progress, n: number): boolean {
  return isNightNumber(n) && (n === 1 || p.stars[n - 2] > 0);
}

/** Where a returning player starts: the first night not yet won, else the last. */
export function nextNight(p: Progress): number {
  const i = p.stars.findIndex((s) => s === 0);
  return i < 0 ? NIGHT_COUNT : i + 1;
}

export function nightsWon(p: Progress): number {
  return p.stars.filter((s) => s > 0).length;
}
