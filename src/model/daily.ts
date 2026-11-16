/**
 * Daily Outage: one night per calendar date, identical for every player, at
 * three difficulty tiers. Pure and deterministic; see daily.test.ts.
 *
 * The household figures here (battery size, inverter) are game parameters for
 * a fictional flat, not claims about real equipment. Appliance draws come from
 * the cited catalogue.
 */
import { CATALOGUE, averageW } from './catalogue.js';

export type Tier = 'easy' | 'standard' | 'hard';
export const TIERS: readonly Tier[] = ['easy', 'standard', 'hard'];

/** Energy margin over the bare minimum the required loads need until dawn. */
const MARGIN: Record<Tier, number> = { easy: 1.6, standard: 1.25, hard: 1.08 };
const REQUESTS: Record<Tier, number> = { easy: 2, standard: 3, hard: 4 };

export const DAWN_HOUR = 6;
export const INVERTER = { continuousW: 1500, surgeW: 3000, efficiency: 0.9 } as const;
export const USABLE_FRACTION = 0.8;
/** Loads that must stay on all night to win. */
export const REQUIRED: readonly string[] = ['fridge', 'fan'];

export interface Request {
  /** Hours after the outage starts. */
  atH: number;
  applianceId: string;
}

export interface NightSpec {
  date: string;
  tier: Tier;
  seed: number;
  /** Clock hour the grid drops (24 h). */
  outageHour: number;
  /** Hours from the outage until dawn. */
  lengthH: number;
  batteryCapacityWh: number;
  requests: Request[];
}

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validates a calendar date string 'YYYY-MM-DD' (rejects 2026-02-30). */
export function isValidDate(d: string): boolean {
  const m = DATE_RE.exec(d);
  if (!m) return false;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, da));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
}

/** The player's local calendar date, which is what "today's night" means. */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function requiredLoadW(): number {
  let w = 0;
  for (const id of REQUIRED) {
    const e = CATALOGUE.find((c) => c.id === id);
    if (!e) throw new Error(`required appliance ${id} missing from catalogue`);
    w += averageW(e);
  }
  return w;
}

/** Usable Wh needed to carry only the required loads from outage to dawn. */
export function minimumUsableWh(lengthH: number): number {
  return (requiredLoadW() * lengthH) / INVERTER.efficiency;
}

export function dailyNight(date: string, tier: Tier): NightSpec {
  if (!isValidDate(date)) throw new RangeError(`bad date ${date}`);
  // Seed from the date only, so all three tiers share the same night shape.
  const seed = hashString(`changeover:${date}`);
  const rnd = mulberry32(seed);
  const outageHour = 19 + Math.floor(rnd() * 4); // 19:00–22:00
  const lengthH = 24 - outageHour + DAWN_HOUR;

  // Requests: optional appliances someone in the flat asks for, at distinct times.
  const optional = CATALOGUE.filter((c) => !REQUIRED.includes(c.id)).map((c) => c.id);
  const requests: Request[] = [];
  const n = REQUESTS[tier];
  for (let i = 0; i < n; i++) {
    const applianceId = optional[Math.floor(rnd() * optional.length)];
    // Spread across the night in n equal slots so requests never collide.
    const atH = Math.round(((i + 0.2 + rnd() * 0.6) * lengthH) / n * 4) / 4;
    requests.push({ atH, applianceId });
  }

  const needUsable = minimumUsableWh(lengthH) * MARGIN[tier];
  const batteryCapacityWh = Math.ceil(needUsable / USABLE_FRACTION / 100) * 100;
  return { date, tier, seed, outageHour, lengthH, batteryCapacityWh, requests };
}

export interface Streak {
  lastWinDate: string | null;
  count: number;
  best: number;
}

export const NO_STREAK: Streak = { lastWinDate: null, count: 0, best: 0 };

function dayNumber(d: string): number {
  const m = DATE_RE.exec(d)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/**
 * Record a win on `date`. Consecutive days extend the streak, a gap restarts it
 * at 1, and a second win on the same day changes nothing. Losses do not break a
 * streak; only a missed day does (checked by `currentStreak`).
 */
export function recordWin(s: Streak, date: string): Streak {
  if (!isValidDate(date)) throw new RangeError(`bad date ${date}`);
  if (s.lastWinDate === date) return s;
  if (s.lastWinDate && dayNumber(date) < dayNumber(s.lastWinDate)) return s; // clock went backwards
  const consecutive = s.lastWinDate !== null && dayNumber(date) - dayNumber(s.lastWinDate) === 1;
  const count = consecutive ? s.count + 1 : 1;
  return { lastWinDate: date, count, best: Math.max(s.best, count) };
}

/** The streak as it stands today: alive if the last win was today or yesterday. */
export function currentStreak(s: Streak, today: string): number {
  if (!s.lastWinDate || !isValidDate(today)) return 0;
  const gap = dayNumber(today) - dayNumber(s.lastWinDate);
  return gap === 0 || gap === 1 ? s.count : 0;
}
