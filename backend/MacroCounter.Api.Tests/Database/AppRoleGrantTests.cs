using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Database;

/// <summary>
/// The backend's database role cannot create, delete, re-enable or promote accounts, and cannot read
/// or change audit history, even if the app process is compromised (research R6, R12; T7 in the plan).
/// </summary>
[Collection("Postgres")]
public class AppRoleGrantTests(PostgresFixture db) : IAsyncLifetime
{
    private const string InsufficientPrivilege = "42501";

    private Guid _user;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _user = await Sql.InsertUser(db.AdminConnectionString, "alice");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Theory]
    [InlineData("insert into macro.users (id, username, normalized_username, role, security_stamp, concurrency_stamp) values (gen_random_uuid(), 'mallory', 'MALLORY', 'user', 's', 'c')")]
    [InlineData("delete from macro.users")]
    [InlineData("update macro.users set role = 'owner'")]
    [InlineData("update macro.users set disabled_at = null")]
    [InlineData("update macro.users set username = 'x'")]
    [InlineData("select count(*) from macro.audit_events")]
    [InlineData("update macro.audit_events set outcome = 'success'")]
    [InlineData("delete from macro.audit_events")]
    [InlineData("select macro_admin.invite_user('mallory')")]
    public async Task The_app_role_is_denied(string sql)
    {
        Assert.Equal(InsufficientPrivilege, await Sql.FailureCode(db.AppConnectionString, sql));
    }

    [Fact]
    public async Task The_app_role_can_read_users_and_update_sign_in_bookkeeping()
    {
        Assert.Equal(1L, await Sql.Scalar<long>(db.AppConnectionString, "select count(*) from macro.users"));
        await Sql.Execute(db.AppConnectionString,
            "update macro.users set last_sign_in_at = now(), access_failed_count = 0 where id = @id", ("id", _user));
    }

    [Fact]
    public async Task The_app_role_can_write_audit_rows()
    {
        await Sql.Execute(db.AppConnectionString,
            "insert into macro.audit_events (event_type, outcome, actor, user_id) values ('sign_in', 'success', 'user', @id)",
            ("id", _user));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.audit_events"));
    }

    [Fact]
    public async Task The_app_role_manages_sessions()
    {
        await Sql.Execute(db.AppConnectionString, """
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
            values ('\x01', @id, 'full', 'stamp', '\x00', now(), now(), now() + interval '1 day');
            update macro.sessions set last_seen_at = now();
            """, ("id", _user));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AppConnectionString, "select count(*) from macro.sessions"));
        await Sql.Execute(db.AppConnectionString, "delete from macro.sessions");
    }

    [Fact]
    public async Task Row_level_security_hides_rows_from_any_other_role()
    {
        // A role that has a table grant but no policy sees nothing: RLS is on, and only the app role has a policy.
        var probe = $"rls_probe_{Guid.NewGuid():N}"[..20];
        await Sql.Execute(db.AdminConnectionString, $"""
            create role "{probe}";
            grant usage on schema macro to "{probe}";
            grant select on macro.users to "{probe}";
            """);
        try
        {
            await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
            await PostgresFixture.Execute(connection, $"""set role "{probe}" """);
            await using var command = new Npgsql.NpgsqlCommand("select count(*) from macro.users", connection);
            Assert.Equal(0L, (long)(await command.ExecuteScalarAsync())!);
        }
        finally
        {
            await Sql.Execute(db.AdminConnectionString, $"""
                revoke all on macro.users from "{probe}";
                revoke usage on schema macro from "{probe}";
                drop role "{probe}";
                """);
        }
    }
}
