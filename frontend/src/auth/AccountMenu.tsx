import { useEffect, useState } from 'react';
import { AuthError } from '../api/auth';
import { useServices } from '../app/services';
import { exportFileName } from '../data/exportData';
import { FieldError } from '../features/shared/FormBits';
import { ChangePasswordForm } from './ChangePasswordForm';
import { useCurrentUser } from './currentUser';

type SignOut = () => Promise<void>;

const unsyncedMessage = (count: number) =>
  `${count} ${count === 1 ? "change hasn't" : "changes haven't"} synced yet. They'll stay on this device and sync the next time you sign in here.`;

/** Sign out here, or everywhere (FR-011), and take a copy of your data (007 FR-036). Local entries stay on the device, locked to this account. */
export function AccountMenu() {
  const { auth, reload, device, sync, exportData, downloadFile, now } = useServices();
  const user = useCurrentUser();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [unsynced, setUnsynced] = useState<{ count: number; online: boolean; signOut: SignOut } | undefined>();
  const [mayBeIncomplete, setMayBeIncomplete] = useState(false);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    let active = true;
    void sync.isComplete().then((complete) => {
      if (active) setMayBeIncomplete(!complete);
    });
    return () => {
      active = false;
    };
  }, [sync]);

  /** The data stays on the device, locked to this account (FR-017); only the "who's here" marker goes. */
  async function forgetAndReload() {
    await device.clearActiveAccount();
    reload();
  }

  async function run(signOut: SignOut) {
    setBusy(true);
    setError(undefined);
    setUnsynced(undefined);
    try {
      // A request that lands after the session ends would raise the expired-session sign-in over the reload.
      await sync.drain();
      await signOut();
      await forgetAndReload();
    } catch (e) {
      // A session that already ended is as good as signed out.
      if (e instanceof AuthError && e.code === 'unauthenticated') {
        await forgetAndReload();
        return;
      }
      sync.resume();
      setError("Couldn't sign out. Check your connection and try again.");
      setBusy(false);
    }
  }

  /** Unsynced changes are safe, but the person should know they are leaving them here (007 FR-011). */
  async function askThenRun(signOut: SignOut) {
    const count = await sync.pendingCount();
    if (count > 0) setUnsynced({ count, online: sync.snapshot().online, signOut });
    else await run(signOut);
  }

  async function exportMyData() {
    setBusy(true);
    setError(undefined);
    setExported(false);
    try {
      const file = await exportData();
      downloadFile(exportFileName(now()), JSON.stringify(file, null, 2));
      setExported(true);
    } catch {
      setError("Couldn't export your data. Try again.");
    } finally {
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
      {unsynced ? (
        <div className="stack">
          <p>{unsyncedMessage(unsynced.count)}</p>
          {unsynced.online ? null : <p>You're offline, so you'll need to reconnect before you can sign out.</p>}
          <div className="row">
            <button type="button" onClick={() => run(unsynced.signOut)} disabled={busy}>
              Sign out anyway
            </button>
            <button type="button" onClick={() => setUnsynced(undefined)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button type="button" onClick={() => askThenRun(auth.signOut)} disabled={busy}>
            Sign out
          </button>
          <button type="button" onClick={() => askThenRun(auth.signOutEverywhere)} disabled={busy}>
            Sign out everywhere
          </button>
        </div>
      )}
      <section className="stack">
        <p className="muted">
          Download a copy of your log, history, saved foods and goals. The file holds your food log, so keep it somewhere
          safe.
        </p>
        {mayBeIncomplete && <p>Some changes haven't synced, so this export may be incomplete.</p>}
        <div className="row">
          <button type="button" onClick={exportMyData} disabled={busy}>
            Export my data
          </button>
        </div>
        {exported && <p role="status">Your data was downloaded.</p>}
      </section>
      <ChangePasswordForm />
    </div>
  );
}
