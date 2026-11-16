/**
 * Daily Outage streak persistence. Pure apart from the storage handed in, so it
 * can be tested with blocked, empty and corrupted storage.
 *
 * Storage can be missing or throw on every access (private windows, blocked site
 * data, sandboxed previews). The game must play the same either way: a failed
 * load is "no streak yet" and a failed save is silently dropped.
 */
import { NO_STREAK, type Streak, isValidDate } from './daily.js';

export const STREAK_KEY = 'changeover.streak.v1';

/** The slice of the Web Storage API this module uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `globalThis.localStorage`, or null if reading it throws or it is absent. */
export function browserStore(): KeyValueStore | null {
  try {
    return (globalThis as { localStorage?: KeyValueStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

function isStreak(v: unknown): v is Streak {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  const intOk = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 100_000;
  const dateOk = s.lastWinDate === null || (typeof s.lastWinDate === 'string' && isValidDate(s.lastWinDate));
  return dateOk && intOk(s.count) && intOk(s.best) && (s.best as number) >= (s.count as number);
}

export function loadStreak(store: KeyValueStore | null): Streak {
  if (!store) return NO_STREAK;
  try {
    const raw = store.getItem(STREAK_KEY);
    if (raw === null) return NO_STREAK;
    const v: unknown = JSON.parse(raw);
    return isStreak(v) ? { lastWinDate: v.lastWinDate, count: v.count, best: v.best } : NO_STREAK;
  } catch {
    return NO_STREAK;
  }
}

/** Returns true if the write went through. */
export function saveStreak(store: KeyValueStore | null, s: Streak): boolean {
  if (!store) return false;
  try {
    store.setItem(STREAK_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
