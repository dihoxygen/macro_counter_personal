export type ChangedType = 'entry' | 'food' | 'goal' | 'version';

export type ChangesListener = (types: ReadonlySet<ChangedType>) => void;

export interface Changes {
  subscribe(listener: ChangesListener): () => void;
  emit(types: ReadonlySet<ChangedType>): void;
}

/** Tells open screens that changes from another device arrived, so they reload without a remount (FR-005). */
export function createChanges(): Changes {
  const listeners = new Set<ChangesListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(types) {
      for (const listener of listeners) listener(types);
    },
  };
}
