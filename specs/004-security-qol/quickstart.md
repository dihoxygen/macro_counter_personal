# Quickstart: Validating Security Quality-of-Life Improvements

These scenarios prove the feature works end to end. Setup (local PostgreSQL, the `macro_app` role,
and running the API and frontend) is the same as
[003 quickstart](../003-auth-security-foundations/quickstart.md). The API shapes are in
[contracts/auth-api.yaml](./contracts/auth-api.yaml) and the screen text is in
[contracts/ui-flow.md](./contracts/ui-flow.md).

## Automated gate

```powershell
dotnet test backend                       # includes EndpointInventoryTests, now reading the 004 contract
cd frontend; npm test; npm run e2e        # Vitest + Playwright
```

Everything must be green. The new backend test classes are `MfaStepTests`,
`TrustedDeviceTests`, `SignInTimingTests` and the updated `SignInServiceTests`. The new e2e specs
are `mfa.spec.ts` and `remember-user.spec.ts`, and `first-sign-in.spec.ts` is updated.

## Manual scenarios

Issue a fresh invite with `select macro_admin.invite_user('alice');`, and keep an authenticator
app ready.

| # | Steps | Expected |
|---|-------|----------|
| 1 | Open the app. | The sign-in screen shows "Password (or Invite Code)" and an unticked "Remember User". It has no code field. |
| 2 | Enter `alice` and the invite code. | The "Set your password" screen appears. No authenticator screen is shown. |
| 3 | Type two different passwords. | "The passwords do not match." |
| 4 | Type matching valid passwords. | The authenticator setup screen appears. Scan it and confirm a code, then the notice, then Today. |
| 5 | Sign out. Sign in with `alice` and a **wrong** password. | "Username or password is incorrect." The authenticator screen is not shown. |
| 6 | Sign in with `nobody` and any password. | The same message, in about the same time. |
| 7 | Sign in with the right password. | The authenticator screen appears. A wrong code shows "That code is incorrect. Try again." The right code goes to Today. |
| 8 | Sign out. Enter the right password, wait more than 5 minutes on the authenticator screen, then enter a code. | Back to sign-in with "Your sign-in timed out…" |
| 9 | On the authenticator screen, choose "Use a different account". | The sign-in screen appears. In DevTools, the pending session cookie is gone. |
| 10 | Sign in with "Remember User" ticked and complete the code. Sign out. | Sign-in shows "Remember User" pre-ticked. The right password goes straight to Today with no code. |
| 11 | In a second browser profile, sign in as `alice`. | A code is asked for (this device is not remembered). |
| 12 | In profile 1, untick "Remember User" and sign in. | A code is asked for. On the next visit the box is unticked. |
| 12a | Remember `alice` again. Sign out, then sign in as a second account `bob` without touching the pre-ticked box. Sign out and sign in as `alice`. | `bob` is asked for a code. `alice` then still needs only the password. |
| 13 | Remember the device again. In profile 2, use "Sign out everywhere". Back in profile 1, sign in. | A code is asked for again. |
| 14 | Remember the device. Run `update macro.trusted_devices set expires_at = now() - interval '1 second';` as the owner. Sign in. | A code is asked for. |
| 15 | Get a wrong code 10 times, across password re-entries, within 15 minutes. | Locked: "Too many attempts. Try again later." |
| 16 | At a 360 px viewport (DevTools), repeat 1, 4 and 7. | No horizontal scroll. The checkbox and links are easy to tap. The code field opens the numeric keypad on a phone. |

## Audit check

```sql
select event_type, outcome, reason from macro_admin.recent_audit where username = 'alice' order by occurred_at;
```

The rows should include `setup_started/invite_code`, `password_accepted`, `sign_in` failures with
`bad_credentials` and `invalid_code`, `device_remembered`, `sign_in/remembered_device` and
`device_forgotten`. No row may contain a password, code or token.
