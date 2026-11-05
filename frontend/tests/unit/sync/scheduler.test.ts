import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncScheduler, type SyncScheduler } from '../../../src/sync/scheduler';
import type { RoundOutcome } from '../../../src/sync/syncEngine';

let visibility: DocumentVisibilityState;
let online: boolean;
let outcome: RoundOutcome;
let runRound: ReturnType<typeof vi.fn<() => Promise<void>>>;
let scheduler: SyncScheduler;

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  online = true;
  outcome = { kind: 'ok' };
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  runRound = vi.fn<() => Promise<void>>(async () => undefined);
  scheduler = createSyncScheduler({ runRound, outcome: () => outcome });
});

afterEach(() => {
  scheduler.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('polling', () => {
  it('runs a round on start, then every 5 s', async () => {
    scheduler.start();
    await advance(0);
    expect(runRound).toHaveBeenCalledTimes(1);

    await advance(5_000);
    expect(runRound).toHaveBeenCalledTimes(2);

    await advance(5_000);
    expect(runRound).toHaveBeenCalledTimes(3);
  });

  it('does nothing before it is started', async () => {
    scheduler.notifyLocalChange();

    await advance(10_000);

    expect(runRound).not.toHaveBeenCalled();
  });

  it('does not poll while the tab is hidden', async () => {
    visibility = 'hidden';
    scheduler.start();

    await advance(20_000);

    expect(runRound).not.toHaveBeenCalled();
  });

  it('runs at once when the tab becomes visible', async () => {
    visibility = 'hidden';
    scheduler.start();
    await advance(1_000);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await advance(0);

    expect(runRound).toHaveBeenCalledTimes(1);
  });

  it('stops completely', async () => {
    scheduler.start();
    await advance(0);

    scheduler.stop();
    await advance(20_000);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await advance(1_000);

    expect(runRound).toHaveBeenCalledTimes(1);
  });
});

describe('local changes', () => {
  it('sync 500 ms after the last one', async () => {
    scheduler.start();
    await advance(0);
    runRound.mockClear();

    scheduler.notifyLocalChange();
    await advance(300);
    scheduler.notifyLocalChange();
    await advance(499);
    expect(runRound).not.toHaveBeenCalled();

    await advance(1);
    expect(runRound).toHaveBeenCalledTimes(1);
  });
});

describe('overlapping rounds', () => {
  it('never runs two at once', async () => {
    let finish!: () => void;
    runRound.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    scheduler.start();
    await advance(0);

    await advance(30_000);
    expect(runRound).toHaveBeenCalledTimes(1);

    finish();
  });

  it('runs again after a round if a change came in during it', async () => {
    let finish!: () => void;
    runRound.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    scheduler.start();
    await advance(0);

    scheduler.notifyLocalChange();
    await advance(500);
    finish();
    await advance(0);

    expect(runRound).toHaveBeenCalledTimes(2);
  });
});

describe('offline', () => {
  it('makes no requests', async () => {
    online = false;
    scheduler.start();

    scheduler.notifyLocalChange();
    await advance(20_000);

    expect(runRound).not.toHaveBeenCalled();
  });

  it('syncs as soon as the device reconnects', async () => {
    online = false;
    scheduler.start();
    await advance(1_000);

    online = true;
    window.dispatchEvent(new Event('online'));
    await advance(0);

    expect(runRound).toHaveBeenCalledTimes(1);
  });
});

describe('after a failure', () => {
  const delays = async () => {
    const seen: number[] = [];
    let last = Date.now();
    runRound.mockImplementation(async () => {
      seen.push(Date.now() - last);
      last = Date.now();
    });
    scheduler.start();
    for (let i = 0; i < 2_500 && seen.length < 7; i++) await advance(100);
    return seen.slice(1);
  };

  it('backs off to a minute', async () => {
    outcome = { kind: 'failing' };

    expect(await delays()).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('backs off on a network failure too', async () => {
    outcome = { kind: 'offline' };

    expect((await delays()).slice(0, 2)).toEqual([5_000, 10_000]);
  });

  it('honours Retry-After', async () => {
    outcome = { kind: 'failing', retryAfterSeconds: 30 };
    scheduler.start();
    await advance(0);
    runRound.mockClear();

    await advance(29_900);
    expect(runRound).not.toHaveBeenCalled();

    await advance(100);
    expect(runRound).toHaveBeenCalledTimes(1);
  });

  it('starts over after a local change', async () => {
    outcome = { kind: 'failing' };
    scheduler.start();
    await advance(0);
    await advance(5_000);
    await advance(10_000);
    runRound.mockClear();

    outcome = { kind: 'ok' };
    scheduler.notifyLocalChange();
    await advance(500);
    expect(runRound).toHaveBeenCalledTimes(1);

    await advance(5_000);
    expect(runRound).toHaveBeenCalledTimes(2);
  });

  it('starts over when the tab becomes visible', async () => {
    outcome = { kind: 'failing' };
    scheduler.start();
    await advance(0);
    await advance(5_000);
    runRound.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    await advance(0);
    expect(runRound).toHaveBeenCalledTimes(1);

    await advance(5_000);
    expect(runRound).toHaveBeenCalledTimes(2);
  });
});

describe('sessions and the notice', () => {
  it.each(['signed-out', 'off'] as const)('stops polling on %s', async (kind) => {
    outcome = { kind };
    scheduler.start();
    await advance(0);

    await advance(120_000);

    expect(runRound).toHaveBeenCalledTimes(1);
  });
});
