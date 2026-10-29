using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Database;

/// <summary>The server-side schema enforces data-model.md itself, not just the app code.</summary>
[Collection("Postgres")]
public class SchemaTests(PostgresFixture db) : IAsyncLifetime
{
    private const string CheckViolation = "23514";
    private const string UniqueViolation = "23505";
    private const string StringTooLong = "22001";

    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Theory]
    [InlineData("ab")]
    [InlineData("Alice")]
    [InlineData("al ice")]
    [InlineData("alice@example")]
    [InlineData("a-very-long-username-that-exceeds-32")]
    public async Task Rejects_usernames_outside_the_canonical_pattern(string username)
    {
        var error = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Sql.InsertUser(db.AdminConnectionString, username));
        // Over-long names hit the varchar(32) limit before the CHECK; both are refusals.
        Assert.Contains(error.SqlState, new[] { CheckViolation, StringTooLong });
    }

    [Fact]
    public async Task Accepts_a_canonical_username()
    {
        await Sql.InsertUser(db.AdminConnectionString, "alice.b_c-9");
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.users"));
    }

    [Fact]
    public async Task Rejects_a_duplicate_username()
    {
        await Sql.InsertUser(db.AdminConnectionString, "alice");
        var error = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Sql.InsertUser(db.AdminConnectionString, "alice"));
        Assert.Equal(UniqueViolation, error.SqlState);
    }

    [Fact]
    public async Task Rejects_an_unknown_role()
    {
        var error = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Sql.InsertUser(db.AdminConnectionString, "alice", "admin"));
        Assert.Equal(CheckViolation, error.SqlState);
    }

    [Fact]
    public async Task Allows_only_one_owner()
    {
        await Sql.InsertUser(db.AdminConnectionString, "sam", "owner");
        await Sql.InsertUser(db.AdminConnectionString, "alice", "user");
        var error = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Sql.InsertUser(db.AdminConnectionString, "kim", "owner"));
        Assert.Equal(UniqueViolation, error.SqlState);
    }

    [Fact]
    public async Task Rejects_an_unknown_session_kind()
    {
        var user = await Sql.InsertUser(db.AdminConnectionString, "alice");
        Assert.Equal(CheckViolation, await Sql.FailureCode(db.AdminConnectionString, """
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
            values ('\x01', @user, 'admin', 'stamp', '\x00', now(), now(), now() + interval '1 day')
            """, ("user", user)));
    }

    [Theory]
    [InlineData("password_changed", "success", null)]
    [InlineData("sign_in", "maybe", null)]
    [InlineData("sign_in", "failure", "wrong password typed: hunter2")]
    public async Task Audit_rows_accept_only_the_closed_lists(string eventType, string outcome, string? reason)
    {
        Assert.Equal(CheckViolation, await Sql.FailureCode(db.AdminConnectionString, """
            insert into macro.audit_events (event_type, outcome, actor, reason) values (@e, @o, 'user', @r)
            """, ("e", eventType), ("o", outcome), ("r", reason)));
    }

    [Fact]
    public async Task Audit_actor_is_a_closed_list()
    {
        Assert.Equal(CheckViolation, await Sql.FailureCode(db.AdminConnectionString,
            "insert into macro.audit_events (event_type, outcome, actor) values ('sign_in', 'success', 'hacker')"));
    }

    [Fact]
    public async Task Accepts_a_valid_audit_row()
    {
        await Sql.Execute(db.AdminConnectionString,
            "insert into macro.audit_events (event_type, outcome, actor, reason) values ('sign_in', 'failure', 'user', 'bad_credentials')");
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.audit_events"));
    }

    [Fact]
    public async Task Usage_counts_cannot_be_negative()
    {
        var user = await Sql.InsertUser(db.AdminConnectionString, "alice");
        Assert.Equal(CheckViolation, await Sql.FailureCode(db.AdminConnectionString,
            "insert into macro.ai_usage_daily (user_id, day, count) values (@user, current_date, -1)", ("user", user)));
        Assert.Equal(CheckViolation, await Sql.FailureCode(db.AdminConnectionString,
            "insert into macro.ai_usage_global_daily (day, count) values (current_date, -1)"));
    }

    [Fact]
    public async Task Deleting_a_user_cascades_to_tokens_sessions_and_usage()
    {
        var user = await Sql.InsertUser(db.AdminConnectionString, "alice");
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.user_tokens (user_id, login_provider, name, value) values (@user, '[AspNetUserStore]', 'AuthenticatorKey', 'x');
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
              values ('\x01', @user, 'full', 'stamp', '\x00', now(), now(), now() + interval '1 day');
            insert into macro.ai_usage_daily (user_id, day, count) values (@user, current_date, 1);
            delete from macro.users where id = @user;
            """, ("user", user));

        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, """
            select (select count(*) from macro.user_tokens) + (select count(*) from macro.sessions)
                 + (select count(*) from macro.ai_usage_daily)
            """));
    }

    [Fact]
    public async Task The_server_stores_only_identity_and_security_tables()
    {
        // FR-019: no food logs, photos or goals on the server.
        var tables = await Sql.Scalar<string[]>(db.AdminConnectionString,
            "select array_agg(tablename::text order by tablename) from pg_tables where schemaname = 'macro'");

        Assert.Equal(
            new[]
            {
                "__EFMigrationsHistory", "ai_usage_daily", "ai_usage_global_daily", "audit_events", "data_protection_keys",
                "sessions", "trusted_devices", "user_claims", "user_logins", "user_tokens", "users",
            }.Order(StringComparer.Ordinal),
            tables.Order(StringComparer.Ordinal));
    }
}
