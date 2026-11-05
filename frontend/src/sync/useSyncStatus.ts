import { useEffect, useState, useSyncExternalStore } from 'react';
import { useServices } from '../app/services';
import type { SyncSnapshot } from './syncService';

/** A round must run this long before it shows, so fast rounds do not flicker (contracts/ui-sync.md). */
const SHOW_SYNCING_AFTER_MS = 1_000;

export type SyncStatusKind = 'off' | 'offline' | 'failing' | 'syncing' | 'pending' | 'synced';

export interface SyncStatusView {
  kind: SyncStatusKind;
  label: string;
  explanation: string;
}

const noun = (count: number) => (count === 1 ? 'change' : 'changes');

function statusFor(snapshot: SyncSnapshot, slowRound: boolean): SyncStatusView {
  const { started, online, outcome, pending, quarantined } = snapshot;
  const base = ((): SyncStatusView => {
    if (!started || outcome.kind === 'off') {
      return { kind: 'off', label: 'Sync off', explanation: 'Your log is only on this device until sync is turned on.' };
    }
    if (!online || outcome.kind === 'offline') {
      return {
        kind: 'offline',
        label: 'Offline: will sync later',
        explanation: 'You can keep logging. Changes sync when you reconnect.',
      };
    }
    if (outcome.kind === 'failing') {
      return {
        kind: 'failing',
        label: 'Sync problem, retrying',
        explanation: 'Your changes are safe on this device. Sync keeps trying.',
      };
    }
    if (slowRound) return { kind: 'syncing', label: 'Syncing…', explanation: 'Sending and receiving changes.' };
    if (pending > 0) {
      return {
        kind: 'pending',
        label: `${pending} not synced`,
        explanation: `${pending} ${noun(pending)} waiting to sync.`,
      };
    }
    return { kind: 'synced', label: 'Synced', explanation: 'This device is up to date.' };
  })();
  if (quarantined === 0) return base;
  return {
    ...base,
    label: `${base.label} · ${quarantined} can't sync`,
    explanation: `${base.explanation} ${quarantined} ${noun(quarantined)} can't sync and will stay on this device.`,
  };
}

export function useSyncStatus(): SyncStatusView {
  const { sync } = useServices();
  const snapshot = useSyncExternalStore(sync.subscribe, sync.snapshot);
  const [slowRound, setSlowRound] = useState(false);

  useEffect(() => {
    if (!snapshot.running) return undefined;
    const timer = setTimeout(() => setSlowRound(true), SHOW_SYNCING_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlowRound(false);
    };
  }, [snapshot.running]);

  return statusFor(snapshot, slowRound);
}
