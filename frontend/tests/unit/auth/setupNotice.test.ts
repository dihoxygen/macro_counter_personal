import { describe, expect, it, vi } from 'vitest';
import type { AuthApi, SessionState } from '../../../src/api/auth';
import { withSyncNotice } from '../../../src/auth/setupNotice';

const session = { state: 'signed_in', user: { id: 'u1' } } as SessionState;
const auth = () => ({ acknowledgeNotice: vi.fn(async () => session) }) as unknown as AuthApi;

describe('withSyncNotice', () => {
  it('acknowledges both notices, in order', async () => {
    const order: string[] = [];
    const inner = {
      acknowledgeNotice: vi.fn(async () => {
        order.push('setup');
        return session;
      }),
    } as unknown as AuthApi;

    const result = await withSyncNotice(inner, async () => {
      order.push('sync');
    }).acknowledgeNotice();

    expect(order).toEqual(['setup', 'sync']);
    expect(result).toBe(session);
  });

  it('finishes setup even if the sync notice fails, so it can show later', async () => {
    const result = await withSyncNotice(auth(), async () => {
      throw new Error('offline');
    }).acknowledgeNotice();

    expect(result).toBe(session);
  });

  it('does not acknowledge sync when setup fails', async () => {
    const inner = {
      acknowledgeNotice: vi.fn(async () => {
        throw new Error('refused');
      }),
    } as unknown as AuthApi;
    const acknowledgeSync = vi.fn(async () => undefined);

    await expect(withSyncNotice(inner, acknowledgeSync).acknowledgeNotice()).rejects.toThrow('refused');

    expect(acknowledgeSync).not.toHaveBeenCalled();
  });
});
