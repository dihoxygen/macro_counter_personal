using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace MacroCounter.Api.Auth;

/// <summary>
/// Remember User (004 research R3): a browser that skips only the authenticator step for one account. The cookie
/// carries a 256-bit random token wrapped by Data Protection; the database keeps only its SHA-256. A device is
/// honoured only before its fixed expiry and while the user's security stamp is unchanged, so every path that
/// rotates the stamp (password change, sign out everywhere, owner reset, disable, revoke) ends it too.
/// There is no update statement: the app role cannot update this table, so an expiry can never be extended.
/// </summary>
public sealed class TrustedDeviceStore(
    NpgsqlDataSource dataSource,
    IDataProtectionProvider dataProtection,
    IAuditLog audit,
    IOptions<SecurityOptions> options,
    TimeProvider clock)
{
    public const string DeviceCookie = "__Host-mc_device";

    private readonly IDataProtector _protector = dataProtection.CreateProtector("MacroCounter.DeviceToken.v1");

    /// <summary>The token in this request's device cookie, or null when it is missing or not one of ours.</summary>
    public string? ReadToken(HttpContext context)
    {
        if (!context.Request.Cookies.TryGetValue(DeviceCookie, out var value) || string.IsNullOrEmpty(value)) return null;
        try
        {
            return _protector.Unprotect(value);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>The account this token remembers, if it is still valid; a stale row is deleted.</summary>
    public async Task<Guid?> FindValidAsync(string token, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            select d.user_id, d.expires_at > $2 and d.security_stamp = u.security_stamp and u.disabled_at is null
            from macro.trusted_devices d join macro.users u on u.id = d.user_id
            where d.token_hash = $1
            """);
        command.Parameters.Add(new() { Value = Hash(token) });
        command.Parameters.Add(new() { Value = clock.GetUtcNow() });
        Guid userId;
        bool valid;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken)) return null;
            userId = reader.GetGuid(0);
            valid = reader.GetBoolean(1);
        }
        if (valid) return userId;
        await DeleteAsync(token, cancellationToken);
        return null;
    }

    /// <summary>Remembers this browser for the user, replacing whatever device this browser held before.</summary>
    public async Task RememberAsync(HttpContext context, AppUser user, CancellationToken cancellationToken)
    {
        if (ReadToken(context) is { } previous) await DeleteAsync(previous, cancellationToken);

        var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        var now = clock.GetUtcNow();
        var expires = now + options.Value.Session.RememberDeviceLifetime;
        await using (var command = dataSource.CreateCommand("""
            insert into macro.trusted_devices (token_hash, user_id, security_stamp, created_at, expires_at)
            select $1, u.id, u.security_stamp, $3, $4 from macro.users u where u.id = $2
            """))
        {
            command.Parameters.Add(new() { Value = Hash(token) });
            command.Parameters.Add(new() { Value = user.Id });
            command.Parameters.Add(new() { Value = now });
            command.Parameters.Add(new() { Value = expires });
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        context.Response.Cookies.Append(DeviceCookie, _protector.Protect(token), CookieOptions(expires));
        await audit.WriteAsync(AuditEvent.DeviceRemembered, AuditOutcome.Success, user.Id, null,
            context.Connection.RemoteIpAddress, cancellationToken);
    }

    /// <summary>The person unticked Remember User on this browser (004 FR-016a).</summary>
    public async Task ForgetAsync(HttpContext context, string token, Guid userId, CancellationToken cancellationToken)
    {
        await DeleteAsync(token, cancellationToken);
        context.Response.Cookies.Delete(DeviceCookie, CookieOptions(expires: null));
        await audit.WriteAsync(AuditEvent.DeviceForgotten, AuditOutcome.Success, userId, null,
            context.Connection.RemoteIpAddress, cancellationToken);
    }

    /// <summary>Sign out everywhere or a password change: no browser stays remembered for this user (004 FR-018).</summary>
    public async Task ForgetAllForUserAsync(HttpContext context, Guid userId, CancellationToken cancellationToken)
    {
        int removed;
        await using (var command = dataSource.CreateCommand("delete from macro.trusted_devices where user_id = $1"))
        {
            command.Parameters.Add(new() { Value = userId });
            removed = await command.ExecuteNonQueryAsync(cancellationToken);
        }
        context.Response.Cookies.Delete(DeviceCookie, CookieOptions(expires: null));
        if (removed > 0)
        {
            await audit.WriteAsync(AuditEvent.DeviceForgotten, AuditOutcome.Success, userId, null,
                context.Connection.RemoteIpAddress, cancellationToken);
        }
    }

    private async Task DeleteAsync(string token, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("delete from macro.trusted_devices where token_hash = $1");
        command.Parameters.Add(new() { Value = Hash(token) });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static byte[] Hash(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));

    /// <summary>The same attributes as the session cookie: HttpOnly, Secure, SameSite=Strict, host-only, Path=/.</summary>
    private static CookieOptions CookieOptions(DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Path = "/",
        Expires = expires,
        IsEssential = true,
    };
}
