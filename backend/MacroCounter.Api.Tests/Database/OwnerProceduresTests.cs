using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Npgsql;

namespace MacroCounter.Api.Tests.Database;

/// <summary>
/// The owner's account procedures (contracts/owner-procedures.md), run as the admin like the Supabase SQL
/// editor. invite_user is covered in InviteUserTests.
/// </summary>
[Collection("Postgres")]
public class OwnerProceduresTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private ActiveUser _alice = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        _alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
            select decode(md5(random()::text), 'hex'), id, 'full', security_stamp, '\x00', now(), now(), now() + interval '1 day'
            from macro.users cross join generate_series(1, 2);
            update macro.users set lockout_end = now() + interval '10 minutes', access_failed_count = 4,
                                   totp_last_code = '123456', totp_last_used_at = now();
            delete from macro.audit_events;
            """);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private Task<T> Call<T>(string sql) => Sql.Scalar<T>(db.AdminConnectionString, sql);

    private Task<string> Stamp() => Call<string>("select security_stamp from macro.users where username = 'alice'");

    private Task<long> Sessions() => Call<long>("select count(*) from macro.sessions");

    private async Task<(string Event, string Actor, Guid? User)> SingleAudit()
    {
        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand("select event_type, actor, user_id from macro.audit_events", connection);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync(), "expected one audit row");
        var row = (reader.GetString(0), reader.GetString(1), reader.IsDBNull(2) ? (Guid?)null : reader.GetGuid(2));
        Assert.False(await reader.ReadAsync(), "expected exactly one audit row");
        return row;
    }

    [Fact]
    public async Task Reset_wipes_credentials_and_sessions_and_issues_a_new_code()
    {
        var stamp = await Stamp();
        await Sql.Execute(db.AdminConnectionString, "update macro.users set ai_notice_ack_at = now() - interval '3 days'");
        var noticeBefore = await Call<DateTime>("select ai_notice_ack_at from macro.users");

        var code = await Call<string>("select macro_admin.reset_user('Alice')");

        Assert.Matches("^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$", code);
        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand("""
            select password_hash is null, two_factor_enabled, totp_last_code is null, totp_last_used_at is null,
                   temp_code_hash = sha256(convert_to(@code, 'UTF8')),
                   setup_expires_at > now() + interval '71 hours 59 minutes', setup_expires_at <= now() + interval '72 hours',
                   lockout_end is null, access_failed_count, role, ai_notice_ack_at
            from macro.users
            """, connection);
        command.Parameters.AddWithValue("code", code.Replace("-", ""));
        await using (var reader = await command.ExecuteReaderAsync())
        {
            Assert.True(await reader.ReadAsync());
            Assert.True(reader.GetBoolean(0), "password cleared");
            Assert.False(reader.GetBoolean(1), "two-factor off");
            Assert.True(reader.GetBoolean(2) && reader.GetBoolean(3), "replay guard cleared");
            Assert.True(reader.GetBoolean(4), "new code hash stored");
            Assert.True(reader.GetBoolean(5) && reader.GetBoolean(6), "72-hour deadline");
            Assert.True(reader.GetBoolean(7), "lockout cleared");
            Assert.Equal(0, reader.GetInt32(8));
            Assert.Equal("user", reader.GetString(9));
            Assert.Equal(noticeBefore, reader.GetDateTime(10));
        }
        Assert.Equal(0L, await Call<long>("select count(*) from macro.user_tokens"));
        Assert.Equal(0L, await Sessions());
        Assert.NotEqual(stamp, await Stamp());
        Assert.Equal(("account_reset", "owner", _alice.Id), await SingleAudit());
    }

    [Fact]
    public async Task Disable_ends_all_sessions_and_enable_restores_the_account()
    {
        var stamp = await Stamp();

        await Sql.Execute(db.AdminConnectionString, "select macro_admin.disable_user('alice')");

        Assert.True(await Call<bool>("select disabled_at is not null from macro.users"));
        Assert.Equal(0L, await Sessions());
        Assert.NotEqual(stamp, await Stamp());
        Assert.Equal(("account_disabled", "owner", _alice.Id), await SingleAudit());

        await Sql.Execute(db.AdminConnectionString, "delete from macro.audit_events; select macro_admin.enable_user('alice')");

        Assert.True(await Call<bool>("select disabled_at is null and password_hash is not null and two_factor_enabled from macro.users"));
        Assert.Equal(("account_enabled", "owner", _alice.Id), await SingleAudit());
    }

    [Fact]
    public async Task Unlock_clears_the_lockout()
    {
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.unlock_user('alice')");

        Assert.True(await Call<bool>("select lockout_end is null and access_failed_count = 0 from macro.users"));
        Assert.Equal(("account_unlocked", "owner", _alice.Id), await SingleAudit());
    }

    [Fact]
    public async Task Revoke_sessions_returns_how_many_and_rotates_the_stamp()
    {
        var stamp = await Stamp();

        Assert.Equal(2, await Call<int>("select macro_admin.revoke_sessions('alice')"));

        Assert.Equal(0L, await Sessions());
        Assert.NotEqual(stamp, await Stamp());
        Assert.True(await Call<bool>("select disabled_at is null from macro.users"));
        Assert.Equal(("session_revoked", "owner", _alice.Id), await SingleAudit());
    }

    [Theory]
    [InlineData("reset_user")]
    [InlineData("disable_user")]
    [InlineData("enable_user")]
    [InlineData("unlock_user")]
    [InlineData("revoke_sessions")]
    public async Task An_unknown_username_is_an_error(string procedure)
    {
        var error = await Assert.ThrowsAsync<PostgresException>(
            () => Sql.Execute(db.AdminConnectionString, $"select macro_admin.{procedure}('nobody')"));
        Assert.Equal("no such user: nobody", error.MessageText);
        Assert.Equal(0L, await Call<long>("select count(*) from macro.audit_events"));
    }

    [Theory]
    [InlineData("reset_user")]
    [InlineData("disable_user")]
    [InlineData("enable_user")]
    [InlineData("unlock_user")]
    [InlineData("revoke_sessions")]
    public async Task The_app_role_cannot_call_them(string procedure)
    {
        Assert.Equal("42501", await Sql.FailureCode(db.AppConnectionString, $"select macro_admin.{procedure}('alice')"));
    }
}
