import type { AuthApi } from '../api/auth';

/**
 * New accounts read the sync disclosure in the setup notice, so acknowledging it covers both (007 R7). If the second
 * call fails, nothing is lost: the sync notice simply shows after setup.
 */
export function withSyncNotice(auth: AuthApi, acknowledgeSync: (userId: string) => Promise<void>): AuthApi {
  return {
    ...auth,
    async acknowledgeNotice() {
      const session = await auth.acknowledgeNotice();
      if (session.user) await acknowledgeSync(session.user.id).catch(() => undefined);
      return session;
    },
  };
}
