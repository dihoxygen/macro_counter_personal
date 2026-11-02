import { describe, expect, it } from 'vitest';
import { browserIntroSession } from '../../../src/data/introSession';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe('browserIntroSession', () => {
  it('has not played in a fresh session', () => {
    expect(browserIntroSession(memoryStorage()).hasPlayed()).toBe(false);
  });

  it('remembers that it played, under macro.introPlayed', () => {
    const storage = memoryStorage();
    const session = browserIntroSession(storage);
    session.markPlayed();
    expect(session.hasPlayed()).toBe(true);
    expect(storage.getItem('macro.introPlayed')).toBe('1');
    // A reload in the same tab builds a new adapter over the same storage (FR-010).
    expect(browserIntroSession(storage).hasPlayed()).toBe(true);
  });

  it('treats blocked storage as not played and never throws', () => {
    const session = browserIntroSession(throwingStorage());
    expect(session.hasPlayed()).toBe(false);
    expect(() => session.markPlayed()).not.toThrow();
  });

  it('defaults to window.sessionStorage', () => {
    window.sessionStorage.clear();
    browserIntroSession().markPlayed();
    expect(window.sessionStorage.getItem('macro.introPlayed')).toBe('1');
    window.sessionStorage.clear();
  });
});
