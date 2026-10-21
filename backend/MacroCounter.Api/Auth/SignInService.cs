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
    public sealed record SignedIn(AppUser User) : SignInOutcome;

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
}

/// <summary>
/// Checks username, password and authenticator code together in one request (research R4). Every path runs
/// exactly one password-hash verification so timing does not reveal whether the account exists.
/// </summary>
public sealed partial class SignInService(
    UserManager<AppUser> users,
    EncryptedUserStore store,
    IPasswordHasher<AppUser> hasher,
    IdentityDbContext db,
    IAuditLog audit,
    SignInThrottle throttle,
    IOptions<SecurityOptions> options,
    TimeProvider clock)
{
    private static string? s_dummyHash;

    public async Task<SignInOutcome> SignInAsync(string username, string password, string? code, IPAddress? sourceIp,
        CancellationToken cancellationToken)
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

        var outcome = await SignInCheckedAsync(name, password, code, now, sourceIp, cancellationToken);
        if (outcome is SignInOutcome.Failed) throttle.RecordFailure(name);
        else if (outcome is SignInOutcome.SignedIn or SignInOutcome.SetupRequired) throttle.RecordSuccess(name);
        return outcome;
    }

    private async Task<SignInOutcome> SignInCheckedAsync(string name, string password, string? code, DateTimeOffset now,
        IPAddress? sourceIp, CancellationToken cancellationToken)
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
            ? await SignInActive(user, password, code, now, sourceIp, cancellationToken)
            : await SignInDuringSetup(user, step, password, code, now, sourceIp, cancellationToken);

        async Task<SignInOutcome> Fail(Guid? userId, AuditReason reason)
        {
            await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, userId, reason, sourceIp, cancellationToken);
            return SignInOutcome.Failed.Instance;
        }
    }

    private async Task<SignInOutcome> SignInActive(AppUser user, string password, string? code, DateTimeOffset now,
        IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        var hasKey = await store.GetAuthenticatorKeyAsync(user, cancellationToken) is not null;
        if (user.PasswordHash is null || !user.TwoFactorEnabled || !hasKey)
        {
            BurnOneHash();
            return await Incomplete(user, sourceIp, cancellationToken);
        }

        var passwordOk = VerifyPassword(user, password);
        if (passwordOk && await CodeAccepted(user, code, now, cancellationToken))
        {
            user.AccessFailedCount = 0;
            user.LockoutEnd = null;
            user.LastSignInAt = now;
            await db.SaveChangesAsync(cancellationToken);
            await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Success, user.Id, null, sourceIp, cancellationToken);
            return new SignInOutcome.SignedIn(user);
        }

        return await RecordFailure(user, now, sourceIp, cancellationToken);
    }

    private async Task<SignInOutcome> SignInDuringSetup(AppUser user, string step, string password, string? code,
        DateTimeOffset now, IPAddress? sourceIp, CancellationToken cancellationToken)
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

        bool ok;
        if (user.PasswordHash is null)
        {
            // First sign-in: the temporary code goes in the password field. It is high-entropy, so a fast hash
            // is enough; still run one slow hash so this path takes as long as the others.
            BurnOneHash();
            ok = CryptographicOperations.FixedTimeEquals(HashTemporaryCode(password), user.TempCodeHash);
        }
        else
        {
            ok = VerifyPassword(user, password);
            // Once the authenticator is confirmed it guards the rest of setup too; otherwise the password alone
            // would reach the notice step, and acknowledging it ends in a full session.
            if (ok && user.TwoFactorEnabled) ok = await CodeAccepted(user, code, now, cancellationToken);
        }

        if (!ok) return await RecordFailure(user, now, sourceIp, cancellationToken);

        user.AccessFailedCount = 0;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(AuditEvent.SetupStarted, AuditOutcome.Success, user.Id, null, sourceIp, cancellationToken);
        return new SignInOutcome.SetupRequired(user, step);
    }

    /// <summary>The same normalization the owner's invite_user procedure hashes: no dashes or spaces, uppercase.</summary>
    public static byte[] HashTemporaryCode(string code)
    {
        var normalized = new string(code.Where(c => c is not ('-' or ' ')).ToArray()).ToUpperInvariant();
        return SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
    }

    /// <summary>A valid authenticator code that has not been used before (replay protection).</summary>
    private async Task<bool> CodeAccepted(AppUser user, string? code, DateTimeOffset now, CancellationToken cancellationToken) =>
        code is not null
        && await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, code)
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

    private async Task<SignInOutcome> RecordFailure(AppUser user, DateTimeOffset now, IPAddress? sourceIp,
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
        await audit.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, user.Id, AuditReason.BadCredentials, sourceIp, cancellationToken);
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
