using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using MacroCounter.Api.Data;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace MacroCounter.Api.Auth;

/// <summary>
/// Server-side sessions (research R5). The cookie carries only a 256-bit random key; the database keeps its
/// SHA-256, so a leaked sessions table cannot be replayed. Every request re-checks the row: idle and absolute
/// expiry, the user's security stamp, and whether the user is disabled. Revocation is therefore immediate.
/// </summary>
public sealed class PostgresTicketStore(
    NpgsqlDataSource dataSource,
    IDataProtectionProvider dataProtection,
    IOptions<SecurityOptions> options,
    TimeProvider clock) : ITicketStore
{
    /// <summary>HttpContext.Items key holding the current request's session key (set when a session is read).</summary>
    public const string SessionKeyItem = "MacroCounter.SessionKey";

    private static readonly TimeSpan LastSeenResolution = TimeSpan.FromMinutes(1);

    private readonly IDataProtector _protector = dataProtection.CreateProtector("MacroCounter.SessionTicket.v1");

    public static byte[] HashKey(string key) => SHA256.HashData(Encoding.UTF8.GetBytes(key));

    public Task<string> StoreAsync(AuthenticationTicket ticket) => StoreAsync(ticket, CancellationToken.None);

    public async Task<string> StoreAsync(AuthenticationTicket ticket, CancellationToken cancellationToken)
    {
        var kind = ticket.Principal.FindFirstValue(AuthClaims.SessionKind);
        if (kind is not (SessionRecord.FullKind or SessionRecord.SetupKind))
        {
            throw new InvalidOperationException($"A session ticket needs a {AuthClaims.SessionKind} claim of 'full' or 'setup'.");
        }
        var userId = Guid.Parse(ticket.Principal.FindFirstValue(AuthClaims.Subject)
            ?? throw new InvalidOperationException("A session ticket needs a sub claim."));

        var key = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        var now = clock.GetUtcNow();
        var lifetime = kind == SessionRecord.FullKind ? options.Value.Session.AbsoluteLifetime : options.Value.Session.SetupLifetime;

        await using var command = dataSource.CreateCommand("""
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
            select $1, u.id, $3, u.security_stamp, $4, $5, $5, $6 from macro.users u where u.id = $2
            """);
        command.Parameters.Add(new() { Value = HashKey(key) });
        command.Parameters.Add(new() { Value = userId });
        command.Parameters.Add(new() { Value = kind });
        command.Parameters.Add(new() { Value = Protect(ticket) });
        command.Parameters.Add(new() { Value = now });
        command.Parameters.Add(new() { Value = now + lifetime });
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
        {
            throw new InvalidOperationException("Cannot create a session for an unknown user.");
        }
        return key;
    }

    public Task RenewAsync(string key, AuthenticationTicket ticket) => RenewAsync(key, ticket, CancellationToken.None);

    public async Task RenewAsync(string key, AuthenticationTicket ticket, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("update macro.sessions set ticket = $2 where key_hash = $1");
        command.Parameters.Add(new() { Value = HashKey(key) });
        command.Parameters.Add(new() { Value = Protect(ticket) });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public Task<AuthenticationTicket?> RetrieveAsync(string key) => RetrieveAsync(key, CancellationToken.None);

    public async Task<AuthenticationTicket?> RetrieveAsync(string key, HttpContext httpContext, CancellationToken cancellationToken)
    {
        var ticket = await RetrieveAsync(key, cancellationToken);
        if (ticket is not null) httpContext.Items[SessionKeyItem] = key;
        return ticket;
    }

    public async Task<AuthenticationTicket?> RetrieveAsync(string key, CancellationToken cancellationToken)
    {
        var keyHash = HashKey(key);
        var now = clock.GetUtcNow();
        var session = options.Value.Session;

        byte[] ticket;
        string kind;
        DateTimeOffset lastSeen;
        bool valid;
        await using (var command = dataSource.CreateCommand("""
            select s.ticket, s.kind, s.last_seen_at, s.absolute_expires_at,
                   s.security_stamp = u.security_stamp and u.disabled_at is null
            from macro.sessions s join macro.users u on u.id = s.user_id
            where s.key_hash = $1
            """))
        {
            command.Parameters.Add(new() { Value = keyHash });
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return null;
            ticket = reader.GetFieldValue<byte[]>(0);
            kind = reader.GetString(1);
            lastSeen = reader.GetFieldValue<DateTimeOffset>(2);
            var absoluteExpiry = reader.GetFieldValue<DateTimeOffset>(3);
            var idleLimit = kind == SessionRecord.FullKind ? session.IdleTimeout : session.SetupLifetime;
            valid = reader.GetBoolean(4) && now < absoluteExpiry && now - lastSeen < idleLimit;
        }

        if (!valid)
        {
            await DeleteAsync(keyHash, cancellationToken);
            return null;
        }

        if (now - lastSeen > LastSeenResolution)
        {
            await using var touch = dataSource.CreateCommand("update macro.sessions set last_seen_at = $2 where key_hash = $1");
            touch.Parameters.Add(new() { Value = keyHash });
            touch.Parameters.Add(new() { Value = now });
            await touch.ExecuteNonQueryAsync(cancellationToken);
        }

        try
        {
            return TicketSerializer.Default.Deserialize(_protector.Unprotect(ticket));
        }
        catch (CryptographicException)
        {
            // Unreadable (e.g. the key ring was lost): treat as signed out.
            await DeleteAsync(keyHash, cancellationToken);
            return null;
        }
    }

    public Task RemoveAsync(string key) => RemoveAsync(key, CancellationToken.None);

    public Task RemoveAsync(string key, CancellationToken cancellationToken) => DeleteAsync(HashKey(key), cancellationToken);

    /// <summary>Sign out everywhere, reset or disable: every session of the user ends now.</summary>
    public async Task<int> RemoveAllForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("delete from macro.sessions where user_id = $1");
        command.Parameters.Add(new() { Value = userId });
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Keeps the current session alive after its own user rotated the security stamp.</summary>
    public async Task UpdateStampAsync(string key, string securityStamp, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("update macro.sessions set security_stamp = $2 where key_hash = $1");
        command.Parameters.Add(new() { Value = HashKey(key) });
        command.Parameters.Add(new() { Value = securityStamp });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Counts a wrong authenticator code during setup; returns the new total.</summary>
    public async Task<int> IncrementSetupFailuresAsync(string key, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            update macro.sessions set setup_failed_codes = setup_failed_codes + 1
            where key_hash = $1 returning setup_failed_codes
            """);
        command.Parameters.Add(new() { Value = HashKey(key) });
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is short count ? count : int.MaxValue;
    }

    private async Task DeleteAsync(byte[] keyHash, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("delete from macro.sessions where key_hash = $1");
        command.Parameters.Add(new() { Value = keyHash });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private byte[] Protect(AuthenticationTicket ticket) => _protector.Protect(TicketSerializer.Default.Serialize(ticket));
}

/// <summary>Wires the store into the session cookie.</summary>
public sealed class SessionStoreSetup(PostgresTicketStore store) : IPostConfigureOptions<CookieAuthenticationOptions>
{
    public void PostConfigure(string? name, CookieAuthenticationOptions options) => options.SessionStore = store;
}
