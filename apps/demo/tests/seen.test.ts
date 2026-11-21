import { describe, expect, it } from 'vitest';
import { GUIDE_TOUR_KEY, isUnseen, markSeen, WELCOME_KEY } from '../src/seen.js';

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const failing = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('blocked');
  },
};

describe('seen: first-run introductions', () => {
  it('is unseen until it was marked', () => {
    const store = memoryStore();
    expect(isUnseen(WELCOME_KEY, store)).toBe(true);
    expect(isUnseen(WELCOME_KEY, store)).toBe(true);
    markSeen(WELCOME_KEY, store);
    expect(isUnseen(WELCOME_KEY, store)).toBe(false);
  });

  it('remembers the welcome and the tour separately', () => {
    const store = memoryStore();
    markSeen(WELCOME_KEY, store);
    expect(isUnseen(GUIDE_TOUR_KEY, store)).toBe(true);
  });

  it('stays quiet when storage is missing or blocked', () => {
    expect(isUnseen(WELCOME_KEY, null)).toBe(false);
    expect(isUnseen(WELCOME_KEY, failing)).toBe(false);
  });

  it('survives a failing write', () => {
    expect(() => markSeen(WELCOME_KEY, failing)).not.toThrow();
    expect(() => markSeen(WELCOME_KEY, null)).not.toThrow();
  });
});
