using MacroCounter.Api.Tests.Infrastructure;
using Npgsql;

namespace MacroCounter.Api.Tests.Database;

/// <summary>FR-026: the owner can review recent audit history; old rows are purged on a schedule.</summary>
[Collection("Postgres")]
public class AuditRetentionTests(PostgresFixture db) : IAsyncLifetime
{
    private Guid _alice;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _alice = await Sql.InsertUser(db.AdminConnectionString, "alice");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Recent_audit_shows_the_last_30_days_newest_first_with_usernames()
    {
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.audit_events (occurred_at, event_type, outcome, actor, user_id) values
              (now() - interval '31 days', 'sign_in', 'success', 'user', @a),
              (now() - interval '2 days',  'sign_in', 'success', 'user', @a),
              (now() - interval '1 hour',  'sign_out', 'success', 'user', @a),
              (now() - interval '1 day',   'rate_limited', 'failure', 'system', null);
            """, ("a", _alice));

        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand("select event_type, username from macro_admin.recent_audit", connection);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<(string, string?)>();
        while (await reader.ReadAsync()) rows.Add((reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1)));

        Assert.Equal([("sign_out", "alice"), ("rate_limited", null), ("sign_in", "alice")], rows);
    }

    [Fact]
    public async Task Purge_removes_only_what_is_past_its_retention_and_says_how_much()
    {
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.audit_events (occurred_at, event_type, outcome, actor) values
              (now() - interval '181 days', 'sign_in', 'success', 'user'),
              (now() - interval '179 days', 'sign_in', 'success', 'user');
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at) values
              ('\x01', @a, 'full', 'stamp', '\x00', now() - interval '8 days', now() - interval '8 days', now() - interval '1 day'),
              ('\x02', @a, 'full', 'stamp', '\x00', now(), now(), now() + interval '7 days');
            insert into macro.ai_usage_daily (user_id, day, count) values
              (@a, current_date - 401, 3), (@a, current_date - 10, 2);
            insert into macro.ai_usage_global_daily (day, count) values
              (current_date - 401, 3), (current_date - 10, 2);
            """, ("a", _alice));

        var removed = await Sql.Scalar<int>(db.AdminConnectionString, "select macro_admin.purge_expired()");

        Assert.Equal(4, removed);
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.audit_events"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.ai_usage_daily"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.ai_usage_global_daily"));
    }

    [Theory]
    [InlineData("select macro_admin.purge_expired()")]
    [InlineData("select * from macro_admin.recent_audit")]
    public async Task The_app_role_cannot_purge_or_read_audit_history(string sql)
    {
        Assert.Equal("42501", await Sql.FailureCode(db.AppConnectionString, sql));
    }
}
