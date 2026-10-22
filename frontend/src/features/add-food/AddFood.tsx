import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { AddFoodPhoto } from './AddFoodPhoto';
import { AddFoodText } from './AddFoodText';
import { ManualEntryForm } from './ManualEntryForm';

type Mode = 'text' | 'photo' | 'manual';

const modes: { mode: Mode; label: string }[] = [
  { mode: 'text', label: 'Describe' },
  { mode: 'photo', label: 'Photo' },
  { mode: 'manual', label: 'Manual' },
];

/** The Add Food view: describe it, photograph it, or enter it by hand (FR-001, FR-002, FR-008). */
export function AddFood({ onDone }: { onDone: () => void }) {
  const services = useServices();
  const offline = services.aiBlockedReason === 'offline';
  const [aiAvailable, setAiAvailable] = useState(!offline);
  const [mode, setMode] = useState<Mode>(offline ? 'manual' : 'text');

  useEffect(() => {
    if (offline) return;
    let active = true;
    void services.getStatus().then((status) => {
      if (!active) return;
      setAiAvailable(status.aiAvailable);
      if (!status.aiAvailable) setMode('manual');
    });
    return () => {
      active = false;
    };
  }, [services, offline]);

  return (
    <div className="stack">
      {aiAvailable ? (
        <div className="row" role="group" aria-label="Entry method">
          {modes.map(({ mode: m, label }) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <p className="warning">
          {offline
            ? 'Sign in or reconnect to use AI lookup. You can still enter the food manually.'
            : 'AI lookup is unavailable right now. You can still enter the food manually.'}
        </p>
      )}
      {mode === 'text' && <AddFoodText onConfirmed={onDone} onManual={() => setMode('manual')} />}
      {mode === 'photo' && (
        <AddFoodPhoto
          onConfirmed={onDone}
          onText={() => setMode('text')}
          onManual={() => setMode('manual')}
        />
      )}
      {mode === 'manual' && <ManualEntryForm onSaved={onDone} />}
    </div>
  );
}
