using MacroCounter.Api.Tests.Infrastructure;
using Npgsql;

namespace MacroCounter.Api.Tests.Database;

/// <summary>Read-only owner views: who exists and in what state, and today's AI usage (US5.3, US6).</summary>
[Collection("Postgres")]
public class OwnerViewsTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<Dictionary<string, (string State, long Sessions, bool Locked)>> Overview()
    {
        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand(
            "select username, state, active_sessions, locked_until is not null from macro_admin.users_overview", connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new Dictionary<string, (string, long, bool)>();
        while (await reader.ReadAsync()) rows[reader.GetString(0)] = (reader.GetString(1), reader.GetInt64(2), reader.GetBoolean(3));
        return rows;
    }

    [Fact]
    public async Task Users_overview_reports_each_state_from_the_data_model()
    {
        await TestUsers.InviteAsync(db, "invited1");
        await TestUsers.InviteAsync(db, "setup1");
        await TestUsers.InviteAsync(db, "active1");
        await TestUsers.InviteAsync(db, "expired1");
        await TestUsers.InviteAsync(db, "disabled1");
        await TestUsers.InviteAsync(db, "broken1");
        await Sql.Execute(db.AdminConnectionString, """
            update macro.users set password_hash = 'h', temp_code_hash = null where username = 'setup1';
            update macro.users set password_hash = 'h', temp_code_hash = null, two_factor_enabled = true,
                                   ai_notice_ack_at = now(), setup_expires_at = null where username = 'active1';
            update macro.users set setup_expires_at = now() - interval '1 minute' where username = 'expired1';
            update macro.users set disabled_at = now() where username = 'disabled1';
            update macro.users set temp_code_hash = null where username = 'broken1';
            update macro.users set lockout_end = now() + interval '5 minutes' where username = 'active1';
            """);

        var rows = await Overview();

        Assert.Equal("invited", rows["invited1"].State);
        Assert.Equal("setup", rows["setup1"].State);
        Assert.Equal("active", rows["active1"].State);
        Assert.Equal("expired", rows["expired1"].State);
        Assert.Equal("disabled", rows["disabled1"].State);
        Assert.Equal("incomplete", rows["broken1"].State);
        Assert.True(rows["active1"].Locked);
        Assert.False(rows["invited1"].Locked);
    }

    [Fact]
    public async Task Active_sessions_counts_only_unexpired_sessions()
    {
        await TestUsers.InviteAsync(db, "alice");
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
            select decode(md5(n::text), 'hex'), u.id, 'full', u.security_stamp, '\x00', now(), now(),
                   case when n = 1 then now() - interval '1 minute' else now() + interval '1 day' end
            from macro.users u cross join generate_series(1, 3) n;
            """);

        Assert.Equal(2L, (await Overview())["alice"].Sessions);
    }

    [Fact]
    public async Task Ai_usage_today_shows_per_user_global_and_month_counts()
    {
        await TestUsers.InviteAsync(db, "alice");
        await TestUsers.InviteAsync(db, "bob");
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.ai_usage_daily (user_id, day, count)
            select id, (now() at time zone 'utc')::date, case username when 'alice' then 3 else 1 end from macro.users;
            insert into macro.ai_usage_global_daily (day, count, ceiling_hit_at)
            values ((now() at time zone 'utc')::date, 4, now());
            insert into macro.ai_usage_global_daily (day, count)
            select d, 10 from (select date_trunc('month', now() at time zone 'utc')::date + 0 as d) x
            where d <> (now() at time zone 'utc')::date;
            """);
        var monthExtra = await Sql.Scalar<bool>(db.AdminConnectionString,
            "select date_trunc('month', now() at time zone 'utc')::date <> (now() at time zone 'utc')::date");

        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand(
            "select username, user_today, global_today, global_month, ceiling_hit_at is not null from macro_admin.ai_usage_today order by username",
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<(string, int, int, long, bool)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt64(3), reader.GetBoolean(4)));
        }

        var month = monthExtra ? 14L : 4L;
        Assert.Equal([("alice", 3, 4, month, true), ("bob", 1, 4, month, true)], rows);
    }

    [Theory]
    [InlineData("users_overview")]
    [InlineData("ai_usage_today")]
    public async Task The_app_role_cannot_read_the_views(string view)
    {
        Assert.Equal("42501", await Sql.FailureCode(db.AppConnectionString, $"select * from macro_admin.{view}"));
    }
}
