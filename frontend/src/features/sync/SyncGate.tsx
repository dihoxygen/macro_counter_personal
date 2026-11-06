import { useEffect, useState, type ReactNode } from 'react';
import { useServices } from '../../app/services';
import { SyncNotice } from './SyncNotice';

/**
 * Starts sync once the notice is acknowledged, and shows the notice when it is not (FR-017). Until the state can be
 * fetched the app simply works on local data: this never blocks logging.
 */
export function SyncGate({ children }: { children: ReactNode }) {
  const { sync } = useServices();
  const [needsNotice, setNeedsNotice] = useState(false);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const { noticeAcknowledged } = await sync.getState();
        if (!active) return;
        window.removeEventListener('online', check);
        if (noticeAcknowledged) sync.start();
        else setNeedsNotice(true);
      } catch {
        // Offline, or the server is away: the next reconnect tries again.
      }
    }

    window.addEventListener('online', check);
    void check();
    return () => {
      active = false;
      window.removeEventListener('online', check);
      sync.stop();
    };
  }, [sync]);

  async function acknowledge() {
    await sync.acknowledgeNotice();
    setNeedsNotice(false);
    sync.start();
  }

  return needsNotice ? <SyncNotice onAcknowledge={acknowledge} /> : children;
}
