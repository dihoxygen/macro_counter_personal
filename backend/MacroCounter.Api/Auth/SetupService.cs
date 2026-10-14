using System.Net;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Data;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace MacroCounter.Api.Auth;

/// <summary>First-time setup steps, in order (data-model.md state machine).</summary>
public static class SetupSteps
{
    public const string Password = "password";
    public const string Totp = "totp";
    public const string Notice = "notice";

    /// <summary>The next step this account must complete, or null when setup is complete.</summary>
    public static string? Next(AppUser user) =>
        user.PasswordHash is null ? Password
        : !user.TwoFactorEnabled ? Totp
        : user.AiNoticeAckAt is null ? Notice
        : null;
}

public abstract record SetupResult
{
    /// <summary>The step succeeded. <paramref name="NextStep"/> is null when setup is now complete.</summary>
    public sealed record Advanced(string? NextStep) : SetupResult;

    public sealed record WrongStep(string Expected) : SetupResult;

    public sealed record PasswordRejected(IReadOnlyList<string> Reasons) : SetupResult;

    public sealed record BreachCheckUnavailable : SetupResult;

    public sealed record Enrollment(string SetupKey, string OtpauthUri) : SetupResult;

    public sealed record InvalidCode(int AttemptsLeft) : SetupResult;

    /// <summary>Too many wrong codes: the setup session was ended; the person signs in again.</summary>
    public sealed record SetupSessionRevoked : SetupResult;
}

/// <summary>Password → authenticator → "what is sent to Claude" notice (FR-004, research R3/R4).</summary>
public sealed class SetupService(
    UserManager<AppUser> users,
    EncryptedUserStore store,
    IPasswordHasher<AppUser> hasher,
    PasswordPolicy policy,
    IBreachedPasswordChecker breachChecker,
    IdentityDbContext db,
    PostgresTicketStore sessions,
    IAuditLog audit,
    IOptions<SecurityOptions> options,
    TimeProvider clock)
{
    private const string Issuer = "Macro Counter";

    public async Task<SetupResult> SetPasswordAsync(AppUser user, string newPassword, string sessionKey, IPAddress? sourceIp,
        CancellationToken cancellationToken)
    {
        if (SetupSteps.Next(user) != SetupSteps.Password) return Wrong(user);

        var normalized = PasswordPolicy.Normalize(newPassword);
        var reasons = policy.Check(newPassword, user.UserName!).ToList();
        if (reasons.Count == 0)
        {
            try
            {
                if (await breachChecker.IsBreachedAsync(normalized, cancellationToken)) reasons.Add(PasswordPolicy.Breached);
            }
            catch (BreachCheckUnavailableException)
            {
                await audit.WriteAsync(AuditEvent.PasswordRejected, AuditOutcome.Failure, user.Id,
                    AuditReason.BreachCheckUnavailable, sourceIp, cancellationToken);
                return new SetupResult.BreachCheckUnavailable();
            }
        }
        if (reasons.Count > 0)
        {
            await audit.WriteAsync(AuditEvent.PasswordRejected, AuditOutcome.Failure, user.Id, null, sourceIp, cancellationToken);
            return new SetupResult.PasswordRejected(reasons);
        }

        user.PasswordHash = hasher.HashPassword(user, normalized);
        user.TempCodeHash = null; // the temporary code is single-use (FR-008)
        user.SecurityStamp = NewStamp();
        await db.SaveChangesAsync(cancellationToken);
        // Other sessions end; this one follows the new stamp.
        await sessions.UpdateStampAsync(sessionKey, user.SecurityStamp, cancellationToken);
        await audit.WriteAsync(AuditEvent.PasswordSet, AuditOutcome.Success, user.Id, null, sourceIp, cancellationToken);
        return await Advance(user, cancellationToken);
    }

    public async Task<SetupResult> StartTotpAsync(AppUser user, CancellationToken cancellationToken)
    {
        if (SetupSteps.Next(user) != SetupSteps.Totp) return Wrong(user);

        var key = await store.GetAuthenticatorKeyAsync(user, cancellationToken);
        if (key is null)
        {
            key = users.GenerateNewAuthenticatorKey();
            await store.SetAuthenticatorKeyAsync(user, key, cancellationToken);
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                // A concurrent start (e.g. React running the effect twice) saved a key first: use that one.
                db.ChangeTracker.Clear();
                var current = await users.FindByIdAsync(user.Id.ToString());
                key = current is null ? null : await store.GetAuthenticatorKeyAsync(current, cancellationToken);
                if (key is null) throw;
            }
        }

        var grouped = string.Join(' ', key.Chunk(4).Select(chunk => new string(chunk)));
        var label = Uri.EscapeDataString($"{Issuer}:{user.UserName}").Replace("%3A", ":");
        var uri = $"otpauth://totp/{label}?secret={key}&issuer={Uri.EscapeDataString(Issuer)}&digits=6&period=30";
        return new SetupResult.Enrollment(grouped, uri);
    }

    public async Task<SetupResult> ConfirmTotpAsync(AppUser user, string code, string sessionKey, IPAddress? sourceIp,
        CancellationToken cancellationToken)
    {
        if (SetupSteps.Next(user) != SetupSteps.Totp) return Wrong(user);
        if (await store.GetAuthenticatorKeyAsync(user, cancellationToken) is null) return Wrong(user);

        var valid = await users.VerifyTwoFactorTokenAsync(user, TokenOptions.DefaultAuthenticatorProvider, code)
            && await store.TryConsumeTotpAsync(user, code, clock.GetUtcNow(), cancellationToken);
        if (!valid)
        {
            var failures = await sessions.IncrementSetupFailuresAsync(sessionKey, cancellationToken);
            var left = options.Value.Totp.SetupMaxFailures - failures;
            if (left > 0) return new SetupResult.InvalidCode(left);

            await sessions.RemoveAsync(sessionKey, cancellationToken);
            await audit.WriteAsync(AuditEvent.TotpFailed, AuditOutcome.Failure, user.Id, AuditReason.InvalidCode, sourceIp, cancellationToken);
            return new SetupResult.SetupSessionRevoked();
        }

        user.TwoFactorEnabled = true;
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(AuditEvent.TotpEnrolled, AuditOutcome.Success, user.Id, null, sourceIp, cancellationToken);
        return await Advance(user, cancellationToken);
    }

    public async Task<SetupResult> AcknowledgeNoticeAsync(AppUser user, IPAddress? sourceIp, CancellationToken cancellationToken)
    {
        if (SetupSteps.Next(user) != SetupSteps.Notice) return Wrong(user);

        user.AiNoticeAckAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        await audit.WriteAsync(AuditEvent.AiNoticeAcknowledged, AuditOutcome.Success, user.Id, null, sourceIp, cancellationToken);
        return await Advance(user, cancellationToken);
    }

    private async Task<SetupResult> Advance(AppUser user, CancellationToken cancellationToken)
    {
        var next = SetupSteps.Next(user);
        if (next is null)
        {
            user.SetupExpiresAt = null;
            await db.SaveChangesAsync(cancellationToken);
        }
        return new SetupResult.Advanced(next);
    }

    private static SetupResult.WrongStep Wrong(AppUser user) => new(SetupSteps.Next(user) ?? "complete");

    private static string NewStamp() => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(20));
}
