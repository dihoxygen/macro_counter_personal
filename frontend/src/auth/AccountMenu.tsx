import { useState } from 'react';
import { AuthError } from '../api/auth';
import { useServices } from '../app/services';
import { FieldError } from '../features/shared/FormBits';
import { useCurrentUser } from './currentUser';

/** Sign out here, or everywhere (FR-011). Local entries stay on the device, locked to this account. */
export function AccountMenu() {
  const { auth, reload, device } = useServices();
  const user = useCurrentUser();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /** The data stays on the device, locked to this account (FR-017); only the "who's here" marker goes. */
  async function forgetAndReload() {
    await device.clearActiveAccount();
    reload();
  }

  async function run(signOut: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await signOut();
      await forgetAndReload();
    } catch (e) {
      // A session that already ended is as good as signed out.
      if (e instanceof AuthError && e.code === 'unauthenticated') {
        await forgetAndReload();
        return;
      }
      setError("Couldn't sign out. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {user && (
        <p>
          Signed in as <strong>{user.username}</strong>
        </p>
      )}
      <p className="muted">
        Signing out keeps your entries on this device. Only you can see them after signing back in.
      </p>
      <FieldError message={error} />
      <div className="row">
        <button type="button" onClick={() => run(auth.signOut)} disabled={busy}>
          Sign out
        </button>
        <button type="button" onClick={() => run(auth.signOutEverywhere)} disabled={busy}>
          Sign out everywhere
        </button>
      </div>
    </div>
  );
}
