# UI Contract: Sign-in Screens

These are user-visible strings and behaviours that component and e2e tests assert. They are
written as exact text, so tests can match them. API shapes are in [auth-api.yaml](./auth-api.yaml).

## Sign-in screen (`SignInScreen`)

| Element | Contract |
|---------|----------|
| Username | `autocomplete=username`, max 64 |
| Password | Label exactly **"Password (or Invite Code)"**, `autocomplete=current-password`, max 128 |
| Remember | Checkbox labelled exactly **"Remember User"**, below the password field. Initially ticked only when `session.deviceRemembered` is true. `rememberDevice` is sent only if the person changed the box (any change event) during this sign-in, with its final value; otherwise it is omitted. |
| Authenticator field | **Absent** |
| Submit | "Sign in", disabled until username and password are both non-empty |
| Failure (401) | "Username or password is incorrect." The password is cleared and the username kept. |
| Rate limited (429) | "Too many attempts. Try again later." (unchanged) |
| Notice after an MFA timeout | "Your sign-in timed out. Enter your password again." |

## Authenticator screen (`MfaScreen`, new)

| Element | Contract |
|---------|----------|
| Heading | "Enter your authenticator code" |
| Help text | "Open your authenticator app and enter the 6-digit code for Macro Counter." |
| Code field | Label "Authenticator code", `inputMode=numeric`, `autocomplete=one-time-code`, 6 digits, focused on show, non-digits stripped |
| Submit | "Verify", disabled until 6 digits are entered |
| Wrong code (400) | "That code is incorrect. Try again." The field is cleared. When `attemptsLeft ≤ 2`, "*n* attempts left." is added. |
| 5th wrong code (400, `attemptsLeft: 0`) | The server has ended the pending sign-in. Back to the sign-in screen with "Too many incorrect codes. Enter your password again." |
| 401 | Back to the sign-in screen with the MFA-timeout notice |
| 429 | "Too many attempts. Try again later." The screen stays; "Use a different account" goes back. |
| Back | A link or button **"Use a different account"**. It calls sign-out, then shows the sign-in screen. |

## First sign-in (`SetupFlow`, copy changes only)

| Step | Contract |
|------|----------|
| Password | Heading "Set your password". Fields "New password" and "Confirm new password". A mismatch shows "The passwords do not match." and nothing is sent. |
| Authenticator setup | Shown right after the password is saved. QR code, setup key, and a 6-digit confirm field (unchanged). |
| Notice | "What is sent to Claude" (unchanged) |
| Wording | The words "temporary code" do not appear anywhere in the UI. A test greps the built strings. |

## Layout (all screens)

- Usable at a width of 360 px with no horizontal scroll.
- Every control, including the checkbox and its label, has a touch target of at least 44 × 44 px.
- Keyboard: Enter submits. Tab order is username → password → Remember User → Sign in.
