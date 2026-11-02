import { afterEach, describe, expect, it } from 'vitest';
import type { SessionState } from '../../../src/api/auth';
import { noteSignIn, readRememberedUser } from '../../../src/auth/rememberedUser';

// 004 FR-003: the sign-in screen pre-ticks Remember User only for the account this browser was remembered for.

function signedIn(username: string, deviceRemembered: boolean): SessionState {
  return {
    state: 'signed_in',
    csrfToken: 't',
    deviceRemembered,
    user: { id: '6f1c2a4e-0000-4000-8000-000000000001', username, role: 'user' },
  };
}

describe('rememberedUser', () => {
  afterEach(() => localStorage.clear());

  it('records the account a sign-in remembered, normalized', () => {
    noteSignIn(signedIn('Carol', true));
    expect(readRememberedUser()).toBe('CAROL');
  });

  it('a later remembered account replaces the earlier one', () => {
    noteSignIn(signedIn('alice', true));
    noteSignIn(signedIn('carol', true));
    expect(readRememberedUser()).toBe('CAROL');
  });

  it('an account that is not remembered clears only its own record', () => {
    noteSignIn(signedIn('alice', true));
    noteSignIn(signedIn('bob', false));
    expect(readRememberedUser()).toBe('ALICE');
    noteSignIn(signedIn('alice', false));
    expect(readRememberedUser()).toBeUndefined();
  });

  it('ignores responses that are not a completed sign-in', () => {
    noteSignIn({ state: 'mfa', csrfToken: 't', deviceRemembered: true });
    expect(readRememberedUser()).toBeUndefined();
  });
});
