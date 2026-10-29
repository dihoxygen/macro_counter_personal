import { describe, expect, it } from 'vitest';
import { initialAuthState, transition, type AuthState } from '../../../src/auth/authMachine';
import type { SessionState, SessionUser } from '../../../src/api/auth';

const alice = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  username: 'alice',
  role: 'user' as const,
};
const bob = { id: '6f1c2a4e-0000-4000-8000-000000000002', username: 'bob', role: 'owner' as const };

const signedIn = (user: SessionUser = alice): SessionState => ({
  state: 'signed_in',
  csrfToken: 't',
  deviceRemembered: false,
  user,
});
const setup = (step: 'password' | 'totp' | 'notice'): SessionState => ({
  state: 'setup',
  csrfToken: 't',
  deviceRemembered: false,
  setupStep: step,
});
const signedOut: SessionState = { state: 'signed_out', csrfToken: 't', deviceRemembered: false };
const pending: SessionState = { state: 'mfa', csrfToken: 't', deviceRemembered: false };

describe('authMachine', () => {
  it('starts loading', () => {
    expect(initialAuthState).toEqual({ kind: 'loading' });
  });

  describe('session responses', () => {
    it('signed_in → signed in, not expired', () => {
      expect(transition(initialAuthState, { type: 'session', session: signedIn() })).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: false,
      });
    });

    it('setup → the setup step', () => {
      expect(transition(initialAuthState, { type: 'session', session: setup('totp') })).toEqual({
        kind: 'setup',
        step: 'totp',
      });
    });

    it('setup without a step falls back to the password step', () => {
      expect(
        transition(initialAuthState, {
          type: 'session',
          session: { state: 'setup', csrfToken: 't', deviceRemembered: false },
        }),
      ).toEqual({
        kind: 'setup',
        step: 'password',
      });
    });

    it('signed_out while loading → signed out', () => {
      expect(transition(initialAuthState, { type: 'session', session: signedOut })).toEqual({
        kind: 'signed_out',
      });
    });

    it('signed_out while signed in (e.g. after the back/forward cache) → expired overlay, app kept', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: false };
      expect(transition(state, { type: 'session', session: signedOut })).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: true,
      });
    });

    it('signing back in as the same person clears the expiry', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: true };
      expect(transition(state, { type: 'session', session: signedIn() })).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: false,
      });
    });

    it('signing in as someone else over an expired session requires a reload', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: true };
      expect(transition(state, { type: 'session', session: signedIn(bob) })).toEqual({
        kind: 'reload',
      });
    });

    it('a signed-in response while signed in as someone else also reloads', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: false };
      expect(transition(state, { type: 'session', session: signedIn(bob) })).toEqual({
        kind: 'reload',
      });
    });

    it('setup over an expired session requires a reload', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: true };
      expect(transition(state, { type: 'session', session: setup('password') })).toEqual({
        kind: 'reload',
      });
    });

    it('moving through setup steps and finishing', () => {
      let state = transition(initialAuthState, { type: 'session', session: setup('password') });
      state = transition(state, { type: 'session', session: setup('totp') });
      expect(state).toEqual({ kind: 'setup', step: 'totp' });
      state = transition(state, { type: 'session', session: signedIn() });
      expect(state).toEqual({ kind: 'signed_in', user: alice, expired: false });
    });
  });

  describe('pending sign-in (004: the authenticator code on its own screen)', () => {
    it('mfa from signed out → the authenticator screen', () => {
      expect(transition({ kind: 'signed_out' }, { type: 'session', session: pending })).toEqual({
        kind: 'mfa',
      });
    });

    it('the right code → signed in', () => {
      expect(transition({ kind: 'mfa' }, { type: 'session', session: signedIn() })).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: false,
      });
    });

    it('the right code with only the notice left → setup at the notice', () => {
      expect(transition({ kind: 'mfa' }, { type: 'session', session: setup('notice') })).toEqual({
        kind: 'setup',
        step: 'notice',
      });
    });

    it('an expired pending sign-in → signed out with the timeout notice', () => {
      expect(transition({ kind: 'mfa' }, { type: 'session-expired' })).toEqual({
        kind: 'signed_out',
        notice: 'mfa_expired',
      });
    });

    it('too many wrong codes → signed out with its own notice', () => {
      expect(transition({ kind: 'mfa' }, { type: 'mfa-attempts-exceeded' })).toEqual({
        kind: 'signed_out',
        notice: 'mfa_attempts',
      });
    });

    it('mfa-attempts-exceeded outside the authenticator screen changes nothing', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: false };
      expect(transition(state, { type: 'mfa-attempts-exceeded' })).toBe(state);
    });

    it.each<AuthState>([
      { kind: 'signed_in', user: alice, expired: false },
      { kind: 'offline', user: alice },
    ])(
      'a pending sign-in reported over the app (back/forward cache) → expired overlay (%o)',
      (state) => {
        // The overlay runs its own password and code steps; nobody's data is replaced until a sign-in completes.
        expect(transition(state, { type: 'session', session: pending })).toEqual({
          kind: 'signed_in',
          user: alice,
          expired: true,
        });
      },
    );
  });

  describe('session-expired events', () => {
    it('signed in → expired overlay over the app', () => {
      expect(
        transition({ kind: 'signed_in', user: alice, expired: false }, { type: 'session-expired' }),
      ).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: true,
      });
    });

    it('when already expired → the very same state (no re-render, no request loop)', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: true };
      expect(transition(state, { type: 'session-expired' })).toBe(state);
    });

    it('during setup → back to sign-in with a notice', () => {
      expect(transition({ kind: 'setup', step: 'totp' }, { type: 'session-expired' })).toEqual({
        kind: 'signed_out',
        notice: 'expired',
      });
    });

    it('is ignored while loading or signed out', () => {
      expect(transition(initialAuthState, { type: 'session-expired' })).toEqual(initialAuthState);
      const out: AuthState = { kind: 'signed_out' };
      expect(transition(out, { type: 'session-expired' })).toBe(out);
    });
  });

  describe('offline launch (R9: the last signed-in account keeps working locally)', () => {
    it('unavailable at launch with a remembered account → offline with that account', () => {
      expect(transition(initialAuthState, { type: 'unavailable', account: alice })).toEqual({
        kind: 'offline',
        user: alice,
      });
    });

    it('back online and still signed in as the same person → signed in', () => {
      expect(
        transition({ kind: 'offline', user: alice }, { type: 'session', session: signedIn() }),
      ).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: false,
      });
    });

    it('back online as someone else → reload', () => {
      expect(
        transition({ kind: 'offline', user: alice }, { type: 'session', session: signedIn(bob) }),
      ).toEqual({
        kind: 'reload',
      });
    });

    it('back online but the session is gone → sign-in over the same app and data', () => {
      expect(
        transition({ kind: 'offline', user: alice }, { type: 'session', session: signedOut }),
      ).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: true,
      });
      expect(transition({ kind: 'offline', user: alice }, { type: 'session-expired' })).toEqual({
        kind: 'signed_in',
        user: alice,
        expired: true,
      });
    });

    it('back online in the middle of a setup elsewhere → reload', () => {
      expect(
        transition({ kind: 'offline', user: alice }, { type: 'session', session: setup('totp') }),
      ).toEqual({
        kind: 'reload',
      });
    });

    it('still unreachable → stays offline', () => {
      const state: AuthState = { kind: 'offline', user: alice };
      expect(transition(state, { type: 'unavailable', account: alice })).toBe(state);
    });
  });

  describe('unavailable', () => {
    it('while loading → sign-in screen saying sign-in is unavailable', () => {
      expect(transition(initialAuthState, { type: 'unavailable' })).toEqual({
        kind: 'signed_out',
        notice: 'unavailable',
      });
    });

    it('when already signed in → unchanged (local data keeps working)', () => {
      const state: AuthState = { kind: 'signed_in', user: alice, expired: false };
      expect(transition(state, { type: 'unavailable' })).toBe(state);
    });
  });

  it('a reload state stays a reload', () => {
    const state: AuthState = { kind: 'reload' };
    expect(transition(state, { type: 'session', session: signedIn() })).toBe(state);
    expect(transition(state, { type: 'session-expired' })).toBe(state);
  });
});
