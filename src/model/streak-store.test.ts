import { afterEach, describe, expect, it } from 'vitest';
import { NO_STREAK, recordWin } from './daily.js';
import { type KeyValueStore, STREAK_KEY, browserStore, loadStreak, saveStreak } from './streak-store.js';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const blocked: KeyValueStore = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
};

describe('streak store', () => {
  it('round-trips a streak', () => {
    const m = memory();
    const s = recordWin(recordWin(NO_STREAK, '2026-11-03'), '2026-11-04');
    expect(saveStreak(m, s)).toBe(true);
    expect(loadStreak(m)).toEqual({ lastWinDate: '2026-11-04', count: 2, best: 2 });
  });

  it('empty storage is no streak', () => {
    expect(loadStreak(memory())).toEqual(NO_STREAK);
  });

  it('no storage at all: load is no streak, save reports failure', () => {
    expect(loadStreak(null)).toEqual(NO_STREAK);
    expect(saveStreak(null, NO_STREAK)).toBe(false);
  });

  it('storage that throws on every call never throws out', () => {
    expect(loadStreak(blocked)).toEqual(NO_STREAK);
    expect(saveStreak(blocked, NO_STREAK)).toBe(false);
  });

  it('quota exceeded on save is reported, not thrown', () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(saveStreak(full, NO_STREAK)).toBe(false);
  });

  it.each([
    ['not JSON', '{oops'],
    ['null', 'null'],
    ['array', '[1,2]'],
    ['bad date', '{"lastWinDate":"2026-13-40","count":1,"best":1}'],
    ['negative', '{"lastWinDate":null,"count":-1,"best":0}'],
    ['fraction', '{"lastWinDate":null,"count":1.5,"best":2}'],
    ['best below count', '{"lastWinDate":"2026-11-04","count":3,"best":2}'],
    ['string count', '{"lastWinDate":"2026-11-04","count":"3","best":3}'],
  ])('corrupted value (%s) loads as no streak', (_n, raw) => {
    const m = memory();
    m.data.set(STREAK_KEY, raw);
    expect(loadStreak(m)).toEqual(NO_STREAK);
  });

  it('drops unknown fields', () => {
    const m = memory();
    m.data.set(STREAK_KEY, '{"lastWinDate":"2026-11-04","count":1,"best":4,"x":"<script>"}');
    expect(loadStreak(m)).toEqual({ lastWinDate: '2026-11-04', count: 1, best: 4 });
  });

  describe('browserStore', () => {
    const g = globalThis as Record<string, unknown>;
    afterEach(() => {
      delete g.localStorage;
    });

    it('is null when localStorage is absent (node)', () => {
      expect(browserStore()).toBeNull();
    });

    it('is null when reading localStorage throws', () => {
      Object.defineProperty(g, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
      expect(browserStore()).toBeNull();
    });
  });
});
