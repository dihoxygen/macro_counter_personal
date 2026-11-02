import type { SessionState } from '../api/auth';

/**
 * Which account this browser was last remembered for, so Remember User pre-ticks only for that username (006
 * FR-003). The server stays the authority: the box is pre-ticked only while it also reports a remembered device.
 * Browser storage can be missing or blocked; then the box simply starts unticked.
 */
const KEY = 'mc.rememberedUser';

export function normalizeUsername(username: string): string {
  return username.trim().toUpperCase();
}

export function readRememberedUser(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records the outcome of a completed sign-in. On these responses `deviceRemembered` is about the account that
 * signed in (unlike GET /auth/session, where it is about any account), so only they update the record.
 */
export function noteSignIn(session: SessionState): void {
  if (session.state !== 'signed_in' || !session.user) return;
  const username = normalizeUsername(session.user.username);
  try {
    if (session.deviceRemembered) localStorage.setItem(KEY, username);
    else if (localStorage.getItem(KEY) === username) localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the box will start unticked, which is safe.
  }
}
