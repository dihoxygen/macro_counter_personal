using System.Security.Claims;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Data;
using MacroCounter.Api.Security;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Npgsql;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>Server-side sessions: hashed keys, idle/absolute expiry, stamp and disabled checks (research R5).</summary>
[Collection("Postgres")]
public class PostgresTicketStoreTests(PostgresFixture db) : IAsyncLifetime
{
    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 10, 14, 12, 0, 0, TimeSpan.Zero));
    private PostgresTicketStore _store = null!;
    private Guid _user;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _user = await Sql.InsertUser(db.AdminConnectionString, "alice");
        _store = new PostgresTicketStore(NpgsqlDataSource.Create(db.AppConnectionString), new EphemeralDataProtectionProvider(),
            Options.Create(new SecurityOptions()), _clock);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private AuthenticationTicket Ticket(string kind) => new(
        new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(AuthClaims.Subject, _user.ToString()), new Claim(AuthClaims.SessionKind, kind)], "test")),
        "test");

    private Task<long> Rows() => Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions");

    [Fact]
    public async Task Stores_only_the_hash_of_a_long_random_key()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));

        Assert.True(key.Length >= 43);
        Assert.DoesNotContain('+', key);
        Assert.DoesNotContain('/', key);
        var stored = await Sql.Scalar<byte[]>(db.AdminConnectionString, "select key_hash from macro.sessions");
        Assert.Equal(PostgresTicketStore.HashKey(key), stored);
        var row = await Sql.Scalar<string>(db.AdminConnectionString, "select row_to_json(s)::text from macro.sessions s");
        Assert.DoesNotContain(key, row);
    }

    [Fact]
    public async Task Keys_are_unique()
    {
        var first = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        var second = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        Assert.NotEqual(first, second);
    }

    [Fact]
    public async Task Returns_the_ticket_while_valid()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        _clock.Advance(TimeSpan.FromHours(23));

        var ticket = await _store.RetrieveAsync(key);

        Assert.NotNull(ticket);
        Assert.Equal(_user.ToString(), ticket.Principal.FindFirstValue(AuthClaims.Subject));
    }

    [Fact]
    public async Task Unknown_keys_return_null()
    {
        Assert.Null(await _store.RetrieveAsync("not-a-real-session-key-not-a-real-session-key"));
    }

    [Fact]
    public async Task A_full_session_expires_after_24_hours_idle()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        _clock.Advance(TimeSpan.FromHours(24) + TimeSpan.FromSeconds(1));

        Assert.Null(await _store.RetrieveAsync(key));
        Assert.Equal(0L, await Rows());
    }

    [Fact]
    public async Task A_full_session_expires_after_7_days_even_when_active()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        // Used every 23 hours (never idle for 24 h): 7 × 23 h = 161 h.
        for (var day = 0; day < 7; day++)
        {
            _clock.Advance(TimeSpan.FromHours(23));
            Assert.NotNull(await _store.RetrieveAsync(key));
        }
        _clock.Advance(TimeSpan.FromHours(7) - TimeSpan.FromSeconds(1)); // 167:59:59
        Assert.NotNull(await _store.RetrieveAsync(key));

        _clock.Advance(TimeSpan.FromSeconds(2)); // 168:00:01, just past 7 days
        Assert.Null(await _store.RetrieveAsync(key));
    }

    [Fact]
    public async Task A_setup_session_expires_after_15_minutes()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.SetupKind));
        _clock.Advance(TimeSpan.FromMinutes(14));
        Assert.NotNull(await _store.RetrieveAsync(key));
        _clock.Advance(TimeSpan.FromMinutes(1) + TimeSpan.FromSeconds(1));

        Assert.Null(await _store.RetrieveAsync(key));
    }

    [Fact]
    public async Task A_changed_security_stamp_ends_the_session()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        await Sql.Execute(db.AdminConnectionString, "update macro.users set security_stamp = 'rotated'");

        Assert.Null(await _store.RetrieveAsync(key));
        Assert.Equal(0L, await Rows());
    }

    [Fact]
    public async Task A_disabled_user_loses_the_session()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        await Sql.Execute(db.AdminConnectionString, "update macro.users set disabled_at = now()");

        Assert.Null(await _store.RetrieveAsync(key));
        Assert.Equal(0L, await Rows());
    }

    [Fact]
    public async Task Last_seen_is_written_at_most_once_a_minute()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        var created = await Sql.Scalar<DateTime>(db.AdminConnectionString, "select last_seen_at from macro.sessions");

        _clock.Advance(TimeSpan.FromSeconds(50));
        await _store.RetrieveAsync(key);
        Assert.Equal(created, await Sql.Scalar<DateTime>(db.AdminConnectionString, "select last_seen_at from macro.sessions"));

        _clock.Advance(TimeSpan.FromSeconds(20));
        await _store.RetrieveAsync(key);
        Assert.Equal(_clock.GetUtcNow().UtcDateTime,
            await Sql.Scalar<DateTime>(db.AdminConnectionString, "select last_seen_at from macro.sessions"));
    }

    [Fact]
    public async Task Remove_deletes_the_row()
    {
        var key = await _store.StoreAsync(Ticket(SessionRecord.FullKind));
        await _store.RemoveAsync(key);

        Assert.Equal(0L, await Rows());
        Assert.Null(await _store.RetrieveAsync(key));
    }

    [Fact]
    public async Task Rejects_a_ticket_without_a_valid_kind()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => _store.StoreAsync(Ticket("admin")));
    }
}
