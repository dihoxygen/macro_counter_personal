using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Data;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Auth;

public abstract record SignInOutcome
{
    /// <param name="ViaRememberedDevice">The password was right on a browser remembered for this account (004 R3).</param>
    public sealed record SignedIn(AppUser User, bool ViaRememberedDevice = false) : SignInOutcome;

    /// <summary>The password was right; the authenticator code is asked for next, on a pending sign-in (004 R1).</summary>
    /// <param name="ForgetDevice">The person unticked Remember User on a browser remembered for them (004 FR-016a).</param>
    public sealed record PasswordAccepted(AppUser User, bool ForgetDevice = false) : SignInOutcome;

    public sealed record SetupRequired(AppUser User, string Step) : SignInOutcome;

    /// <summary>One result for every cause, so a response never reveals which part was wrong (FR-006).</summary>
    public sealed record Failed : SignInOutcome
    {
        public static readonly Failed Instance = new();

        private Failed()
        {
        }
    }

    public sealed record Locked(TimeSpan RetryAfter) : SignInOutcome;

    /// <summary>A wrong authenticator code; the pending sign-in allows <paramref name="AttemptsLeft"/> more.</summary>
    public sealed record InvalidCode(int AttemptsLeft) : SignInOutcome;

    /// <summary>Too many wrong codes: the pending sign-in was ended; the person enters the password again.</summary>
    public sealed record PendingRevoked : SignInOutcome;
}

/// <summary>
/// Two-step sign-in (004 research R1, R2). Step 1 checks the password (or invite code) and runs exactly one
/// password-hash verification on every path, so timing does not reveal whether the account exists. Step 2 checks
/// the authenticator code. Wrong passwords and wrong codes count toward one lockout, and only a completed second
/// step resets it: a correct password alone resets nothing (threat T10).
/// </summary>
public sealed partial class SignInService(
    UserManager<AppUser> users,
    EncryptedUserStore store,
    IPasswordHasher<AppUser> hasher,
    IdentityDbContext db,
    IAuditLog audit,
    SignInThrottle throttle,
    PostgresTicketStore sessions,
    TrustedDeviceStore devices,
    IOptions<SecurityOptions> options,
    TimeProvider clock)
{
    private static string? s_dummyHash;

    /// <summary>
    /// Step 1: the username and password, or the invite code on first sign-in. <paramref name="rememberDevice"/> is
    /// null unless the person changed the Remember User box; <paramref name="deviceToken"/> is this browser's
    /// remembered-device token, if any. It is looked up only after a correct password, so failures take the same time.
    /// </summary>
    public async Task<SignInOutcome> VerifyPasswordAsync(string username, string password, bool? rememberDevice,
        string? deviceToken, IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var name = username.Trim().ToLowerInvariant();

        // Checked before looking the name up: a blocked unknown name and a blocked real one look the same.
        if (throttle.IsBlocked(name, out var retryAfter))
        {
            BurnOneHash();
            await audit.WriteAsync(AuditEvent.RateLimited, AuditOutcome.Failure, null, AuditReason.RateLimited, sourceIp, cancellationToken);
            return new SignInOutcome.Locked(retryAfter);
        }

        var outcome = await VerifyPasswordCheckedAsync(name, password, rememberDevice, deviceToken, now, sourceIp,
            cancellationToken);
        if (outcome is SignInOutcome.Failed) throttle.RecordFailure(name);
        // A remembered device stands in for the code, and setup without an authenticator has no second step to
        // protect. A pending sign-in resets nothing.
        else if (outcome is SignInOutcome.SignedIn or SignInOutcome.SetupRequired) throttle.RecordSuccess(name);
        return outcome;
    }

    /// <summary>
    /// Step 2: the authenticator code for a pending sign-in. On success the account is signed in, or continues to
    /// the notice step if that is all setup has left.
    /// </summary>
    public async Task<SignInOutcome> VerifyMfaAsync(AppUser user, string code, string sessionKey, IPAddress? sourceIp,
        CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var name = user.UserName!;

        if (throttle.IsBlocked(name, out var retryAfter))
        {
            await audit.WriteAsync(AuditEvent.RateLimited, AuditOutcome.Failure, null, AuditReason.RateLimited, sourceIp, cancellationToken);
            return new SignInOutcome.Locked(retryAfter);
        }
        if (user.LockoutEnd is { } lockedUntil && lockedUntil > now)
        {
            await audit.WriteAsync(AuditEvent.SignInLocked, AuditOutcome.Failure, user.Id, AuditReason.Locked, sourceIp, cancellationToken);
            return new SignInOutcome.Locked(lockedUntil - now);
        }

        if (!await CodeAccepted(user, code, now, cancellationToken))
        {
            await RecordFailure(user, now, AuditReason.InvalidCode, sourceIp, cancellationToken);
            throttle.RecordFailure(name);
            var left = options.Value.Totp.SetupMaxFailures - await sessions.IncrementSetupFailuresAsync(sessionKey, cancellationToken);
            if (left > 0) return new SignInOutcome.InvalidCode(left);
            await sessions.RemoveAsync(sessionKey, cancellationToken);
            return new SignInOutcome.PendingRevoked();
        }

        throttle.RecordSuccess(name);
        if (SetupSteps.Next(user) is { } step)
        {
            // Only the notice is left (the authenticator is enrolled): not signed in until it is acknowledged.
            user.AccessFailedCount = 0;
            user.LockoutEnd = null;
            await db.SaveChangesAsync(cancellationToken);
            return new SignInOutcome.SetupRequired(user, step);
        }
        return await Complete(user, now, null, sourceIp, cancellationToken);
    }

    /// <summary>Both factors are in: reset the counters and record the sign-in.</summary>
    private async Task<SignInOutcome> Complete(AppUser user, DateTimeOffset now, AuditReason? reason, IPAddress? sourceIp,
        CancellationToken cancellationToken)
    {
        user.AccessFailedCount = 0;
        user.LockoutEnd = null;
        user.LastSignInAt = now;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Success, user.Id, reason, sourceIp, cancellationToken);
        return new SignInOutcome.SignedIn(user, ViaRememberedDevice: reason == AuditReason.RememberedDevice);
    }

    private async Task<SignInOutcome> VerifyPasswordCheckedAsync(string name, string password, bool? rememberDevice,
        string? deviceToken, DateTimeOffset now, IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        var user = CanonicalUsername().IsMatch(name) ? await users.FindByNameAsync(name) : null;

        if (user is null)
        {
            BurnOneHash();
            return await Fail(null, AuditReason.BadCredentials);
        }

        if (user.LockoutEnd is { } lockedUntil && lockedUntil > now)
        {
            BurnOneHash();
            await audit.WriteAsync(AuditEvent.SignInLocked, AuditOutcome.Failure, user.Id, AuditReason.Locked, sourceIp, cancellationToken);
            return new SignInOutcome.Locked(lockedUntil - now);
        }

        if (user.DisabledAt is not null)
        {
            BurnOneHash();
            return await Fail(user.Id, AuditReason.AccountDisabled);
        }

        var step = SetupSteps.Next(user);
        return step is null
            ? await VerifyActive(user, password, rememberDevice, deviceToken, now, sourceIp, cancellationToken)
            : await VerifyDuringSetup(user, step, password, now, sourceIp, cancellationToken);

        async Task<SignInOutcome> Fail(Guid? userId, AuditReason reason)
        {
            await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, userId, reason, sourceIp, cancellationToken);
            return SignInOutcome.Failed.Instance;
        }
    }

    private async Task<SignInOutcome> VerifyActive(AppUser user, string password, bool? rememberDevice, string? deviceToken,
        DateTimeOffset now, IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        var hasKey = await store.GetAuthenticatorKeyAsync(user, cancellationToken) is not null;
        if (user.PasswordHash is null || !user.TwoFactorEnabled || !hasKey)
        {
            BurnOneHash();
            return await Incomplete(user, sourceIp, cancellationToken);
        }

        if (!VerifyPassword(user, password))
        {
            return await RecordFailure(user, now, AuditReason.BadCredentials, sourceIp, cancellationToken);
        }

        // Only after a correct password: the device lookup must not change how long a failure takes (004 R4).
        if (deviceToken is not null && await devices.FindValidAsync(deviceToken, cancellationToken) == user.Id)
        {
            // Untouched or ticked: the remembered browser stands in for the code. Unticked: forget it, ask for the code.
            if (rememberDevice != false) return await Complete(user, now, AuditReason.RememberedDevice, sourceIp, cancellationToken);
            return await Accepted(user, sourceIp, cancellationToken, forgetDevice: true);
        }
        return await Accepted(user, sourceIp, cancellationToken);
    }

    private async Task<SignInOutcome> VerifyDuringSetup(AppUser user, string step, string password, DateTimeOffset now,
        IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        if (user.SetupExpiresAt is not { } deadline || (user.PasswordHash is null && user.TempCodeHash is null))
        {
            BurnOneHash();
            return await Incomplete(user, sourceIp, cancellationToken);
        }
        if (deadline <= now)
        {
            BurnOneHash();
            await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, user.Id, AuditReason.SetupExpired, sourceIp, cancellationToken);
            return SignInOutcome.Failed.Instance;
        }

        if (user.PasswordHash is null)
        {
            // First sign-in: the invite code goes in the password field. It is high-entropy, so a fast hash is
            // enough; still run one slow hash so this path takes as long as the others.
            BurnOneHash();
            if (!CryptographicOperations.FixedTimeEquals(HashTemporaryCode(password), user.TempCodeHash))
            {
                return await RecordFailure(user, now, AuditReason.BadCredentials, sourceIp, cancellationToken);
            }
            return await SetupStarted(user, step, AuditReason.InviteCode, sourceIp, cancellationToken);
        }

        if (!VerifyPassword(user, password))
        {
            return await RecordFailure(user, now, AuditReason.BadCredentials, sourceIp, cancellationToken);
        }
        // Once the authenticator is enrolled it guards the rest of setup: the code is asked for on the next step,
        // otherwise the password alone would reach the notice and end in a full session (T126 review).
        return user.TwoFactorEnabled
            ? await Accepted(user, sourceIp, cancellationToken)
            : await SetupStarted(user, step, null, sourceIp, cancellationToken);
    }

    /// <summary>A correct password with an authenticator to ask for. Deliberately resets no failure counter (T10).</summary>
    private async Task<SignInOutcome> Accepted(AppUser user, IPAddress? sourceIp, CancellationToken cancellationToken,
        bool forgetDevice = false)
    {
        await db.SaveChangesAsync(cancellationToken); // a rehashed password, if any
        await audit.WriteAsync(AuditEvent.PasswordAccepted, AuditOutcome.Info, user.Id, null, sourceIp, cancellationToken);
        return new SignInOutcome.PasswordAccepted(user, forgetDevice);
    }

    /// <summary>Setup before any authenticator exists: there is no second step, so this sign-in is complete.</summary>
    private async Task<SignInOutcome> SetupStarted(AppUser user, string step, AuditReason? reason, IPAddress? sourceIp,
        CancellationToken cancellationToken)
    {
        user.AccessFailedCount = 0;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(AuditEvent.SetupStarted, AuditOutcome.Success, user.Id, reason, sourceIp, cancellationToken);
        return new SignInOutcome.SetupRequired(user, step);
    }

    /// <summary>The same normalization the owner's invite_user procedure hashes: no dashes or spaces, uppercase.</summary>
    public static byte[] HashTemporaryCode(string code)
    {
        var normalized = new string(code.Where(c => c is not ('-' or ' ')).ToArray()).ToUpperInvariant();
        return SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
    }

    /// <summary>A valid authenticator code that has not been used before (replay protection).</summary>
    private async Task<bool> CodeAccepted(AppUser user, string code, DateTimeOffset now, CancellationToken cancellationToken) =>
        await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, code)
        && await store.TryConsumeTotpAsync(user, code, now, cancellationToken);

    private bool VerifyPassword(AppUser user, string password)
    {
        var normalized = PasswordPolicy.Normalize(password);
        var result = hasher.VerifyHashedPassword(user, user.PasswordHash!, normalized);
        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = hasher.HashPassword(user, normalized);
        }
        return result != PasswordVerificationResult.Failed;
    }

    private async Task<SignInOutcome> RecordFailure(AppUser user, DateTimeOffset now, AuditReason reason, IPAddress? sourceIp,
        CancellationToken cancellationToken)
    {
        var settings = options.Value.SignIn;
        user.AccessFailedCount++;
        var lockedNow = user.AccessFailedCount >= settings.LockoutFailures;
        if (lockedNow)
        {
            user.LockoutEnd = now + settings.LockoutDuration;
            user.AccessFailedCount = 0;
        }
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, user.Id, reason, sourceIp, cancellationToken);
        // Audited when it starts: the name throttle usually refuses the next attempt before the lockout check runs,
        // and that refusal never names the account (FR-024).
        if (lockedNow)
        {
            await audit.WriteAsync(AuditEvent.SignInLocked, AuditOutcome.Failure, user.Id, AuditReason.Locked, sourceIp, cancellationToken);
        }
        return SignInOutcome.Failed.Instance;
    }

    private async Task<SignInOutcome> Incomplete(AppUser user, IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, user.Id, AuditReason.AccountIncomplete, sourceIp, cancellationToken);
        return SignInOutcome.Failed.Instance;
    }

    /// <summary>Spends one password verification on paths that would otherwise skip it (timing equalization).</summary>
    private void BurnOneHash()
    {
        var dummy = new AppUser();
        s_dummyHash ??= hasher.HashPassword(dummy, "timing-equalization-only");
        hasher.VerifyHashedPassword(dummy, s_dummyHash, "not-the-password");
    }

    [GeneratedRegex(IdentityDbContext.UsernamePattern)]
    private static partial Regex CanonicalUsername();
}
