import type { UserData } from '../app/services';

/**
 * Stand-ins for the data repositories while nobody is signed in: every call fails. Local data is only
 * reachable through the signed-in account's own database (FR-017), which AuthGate opens.
 */
export function lockedRepositories(): Omit<UserData, 'close'> {
  const locked = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'then') return undefined; // not a promise
          return () => Promise.reject(new Error(`${name} is locked until someone signs in.`));
        },
      },
    );
  return {
    entries: locked('entries') as UserData['entries'],
    savedFoods: locked('savedFoods') as UserData['savedFoods'],
    goals: locked('goals') as UserData['goals'],
    log: locked('log') as UserData['log'],
  };
}
