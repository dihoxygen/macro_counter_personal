import { useState } from 'react';
import { FieldError } from '../shared/FormBits';

/** The one-time disclosure before anything leaves this device (FR-017, constitution VII Accountability). */
export function SyncNotice({ onAcknowledge }: { onAcknowledge: () => Promise<void> }) {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function turnOn() {
    setBusy(true);
    setError(undefined);
    try {
      await onAcknowledge();
    } catch {
      setError("Couldn't turn on sync. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <section className="app stack">
      <h1>Your log is now stored on the server</h1>
      <p>
        Your log, saved foods and goals are stored on the server, so they appear on every device you
        sign in on.
      </p>
      <p>The owner runs the server and can read this data.</p>
      <p>Photos are never stored.</p>
      <p>Earlier versions of entries, and deleted entries, are kept for 90 days.</p>
      <p>Removing your account deletes all of this. Ask the owner to remove it.</p>
      <FieldError message={error} />
      <button type="button" className="primary" onClick={turnOn} disabled={busy}>
        Turn on sync
      </button>
    </section>
  );
}
