import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../src/api/http';
import { SyncGate } from '../../src/features/sync/SyncGate';
import { fakeSync, renderWithServices } from './testServices';

const today = <p>Today</p>;

describe('SyncGate', () => {
  it('shows the notice before Today when it has not been acknowledged', async () => {
    const sync = fakeSync({ getState: vi.fn(async () => ({ noticeAcknowledged: false, revision: 0 })) });

    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });

    const notice = await screen.findByRole('heading', { name: /stored on the server/i });
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it('says what is stored, who can read it, and what never leaves the device', async () => {
    const sync = fakeSync({ getState: vi.fn(async () => ({ noticeAcknowledged: false, revision: 0 })) });

    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });

    await screen.findByRole('heading', { name: /stored on the server/i });
    const text = document.body.textContent;
    expect(text).toMatch(/log, saved foods and goals/i);
    expect(text).toMatch(/owner .*can read/i);
    expect(text).toMatch(/photos are never stored/i);
    expect(text).toMatch(/90 days/i);
    expect(text).toMatch(/removing .*account deletes/i);
  });

  it('turns sync on and carries on to Today', async () => {
    const user = userEvent.setup();
    const sync = fakeSync({ getState: vi.fn(async () => ({ noticeAcknowledged: false, revision: 0 })) });
    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });

    await user.click(await screen.findByRole('button', { name: /turn on sync/i }));

    expect(sync.acknowledgeNotice).toHaveBeenCalled();
    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(sync.start).toHaveBeenCalled();
  });

  it('stays on the notice and says so when turning on fails', async () => {
    const user = userEvent.setup();
    const sync = fakeSync({
      getState: vi.fn(async () => ({ noticeAcknowledged: false, revision: 0 })),
      acknowledgeNotice: vi.fn(async () => {
        throw new ApiError('network');
      }),
    });
    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });

    await user.click(await screen.findByRole('button', { name: /turn on sync/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it('goes straight to Today and starts syncing once acknowledged', async () => {
    const sync = fakeSync();

    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });

    expect(screen.getByText('Today')).toBeInTheDocument();
    await waitFor(() => expect(sync.start).toHaveBeenCalled());
  });

  it('never blocks logging while the state cannot be fetched', async () => {
    const sync = fakeSync({
      getState: vi.fn(async () => {
        throw new ApiError('network');
      }),
    });

    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });

    expect(screen.getByText('Today')).toBeInTheDocument();
    await waitFor(() => expect(sync.getState).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /turn on sync/i })).not.toBeInTheDocument();
  });

  it('shows the notice once the state can be fetched', async () => {
    let online = false;
    const sync = fakeSync({
      getState: vi.fn(async () => {
        if (!online) throw new ApiError('network');
        return { noticeAcknowledged: false, revision: 0 };
      }),
    });
    await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });
    await waitFor(() => expect(sync.getState).toHaveBeenCalled());

    online = true;
    window.dispatchEvent(new Event('online'));

    expect(await screen.findByRole('button', { name: /turn on sync/i })).toBeInTheDocument();
  });

  it('stops sync when it goes away', async () => {
    const sync = fakeSync();
    const { unmount } = await renderWithServices(<SyncGate>{today}</SyncGate>, { sync });
    await waitFor(() => expect(sync.start).toHaveBeenCalled());

    unmount();

    expect(sync.stop).toHaveBeenCalled();
  });
});
