const KEY = 'macro.introPlayed';

/** Whether the splash intro has already played in this browser session (feature 005, FR-010). */
export interface IntroSession {
  hasPlayed(): boolean;
  markPlayed(): void;
}

/**
 * Backed by sessionStorage: it survives reloads in the same tab, and a new tab or window starts fresh.
 * Blocked storage just means the intro can't be remembered, so errors never escape.
 */
export function browserIntroSession(storage?: Storage): IntroSession {
  const store = () => storage ?? window.sessionStorage;
  return {
    hasPlayed() {
      try {
        return store().getItem(KEY) === '1';
      } catch {
        return false;
      }
    },
    markPlayed() {
      try {
        store().setItem(KEY, '1');
      } catch {
        // Nothing to do: the intro plays again next load.
      }
    },
  };
}
