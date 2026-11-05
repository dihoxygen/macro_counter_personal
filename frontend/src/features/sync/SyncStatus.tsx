import { useState } from 'react';
import { useSyncStatus } from '../../sync/useSyncStatus';

/** Whether this device's changes have reached the server (FR-010): always a text label, never only a colour. */
export function SyncStatus() {
  const status = useSyncStatus();
  const [explaining, setExplaining] = useState(false);

  return (
    <div className="sync-status-wrap">
      <button
        type="button"
        className={`sync-status sync-status-${status.kind}`}
        aria-expanded={explaining}
        onClick={() => setExplaining((open) => !open)}
      >
        {status.label}
      </button>
      {explaining && (
        <p role="status" className="muted sync-status-explanation">
          {status.explanation}
        </p>
      )}
    </div>
  );
}
