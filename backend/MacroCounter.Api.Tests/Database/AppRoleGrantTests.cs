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

    [Theory]
    [InlineData("delete from macro_data.log_entries")]
    [InlineData("delete from macro_data.saved_foods")]
    [InlineData("delete from macro_data.protein_goals")]
    [InlineData("delete from macro_data.saved_food_aliases")]
    [InlineData("delete from macro_data.protein_goal_aliases")]
    [InlineData("delete from macro_data.sync_state")]
    [InlineData("delete from macro_data.entry_versions")]
    [InlineData("update macro_data.entry_versions set name = 'x'")]
    [InlineData("alter table macro_data.log_entries add column x int")]
    [InlineData("create table macro_data.x (id int)")]
    public async Task The_app_role_cannot_delete_activity_data_or_change_history(string sql)
    {
        Assert.Equal(InsufficientPrivilege, await Sql.FailureCode(db.AppConnectionString, sql));
    }

    private static readonly string[] ActivityTables =
        ["log_entries", "entry_versions", "saved_foods", "protein_goals", "saved_food_aliases", "protein_goal_aliases", "sync_state"];

    private Task SeedActivity(Guid user) => Sql.Execute(db.AdminConnectionString, """
        insert into macro_data.sync_state (user_id, revision) values (@u, 1);
        insert into macro_data.saved_food_aliases (user_id, alias_id, canonical_id) values (@u, gen_random_uuid(), gen_random_uuid());
        insert into macro_data.protein_goal_aliases (user_id, alias_id, canonical_id) values (@u, gen_random_uuid(), gen_random_uuid());
        insert into macro_data.protein_goals (user_id, id, created_at, effective_at, schema_version, revision, effective_from, grams)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, '2026-11-04', 150);
        insert into macro_data.saved_foods (user_id, id, created_at, effective_at, schema_version, revision, name, normalized_name,
            ref_amount, ref_unit, kcal, protein_g, carbs_g, fat_g, source, last_used_at)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, 'Oats', 'oats', 1, 'g', 1, 1, 1, 1, 'manual', now());
        insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, deleted_at)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, now());
        insert into macro_data.entry_versions (user_id, id, entry_id, change_type, replaced_at, created_at, effective_at,
            schema_version, revision, day_key, logged_at, name, quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source)
        values (@u, gen_random_uuid(), gen_random_uuid(), 'edit', now(), now(), now(), 1, 1, '2026-11-04', now(),
                'Oats', 1, 'g', 1, 1, 1, 1, 'manual');
        """, ("u", user));

    [Fact]
    public async Task With_no_user_set_the_app_role_sees_no_activity_data()
    {
        await SeedActivity(_user);
        foreach (var table in ActivityTables)
        {
            Assert.Equal(0L, await Sql.Scalar<long>(db.AppConnectionString, $"select count(*) from macro_data.{table}"));
        }
    }

    [Fact]
    public async Task An_unscoped_select_returns_only_the_set_users_rows()
    {
        var bob = await Sql.InsertUser(db.AdminConnectionString, "bob");
        await SeedActivity(_user);
        await SeedActivity(bob);

        await using var connection = await PostgresFixture.Open(db.AppConnectionString);
        foreach (var table in ActivityTables)
        {
            await using var transaction = await connection.BeginTransactionAsync();
            await using (var set = new Npgsql.NpgsqlCommand("select set_config('macro.user_id', @u, true)", connection, transaction))
            {
                set.Parameters.AddWithValue("u", _user.ToString());
                await set.ExecuteNonQueryAsync();
            }
            await using var select = new Npgsql.NpgsqlCommand($"select count(distinct user_id), min(user_id::text) from macro_data.{table}", connection, transaction);
            await using var reader = await select.ExecuteReaderAsync();
            await reader.ReadAsync();
            Assert.Equal(1L, reader.GetInt64(0));
            Assert.Equal(_user.ToString(), reader.GetString(1));
            await reader.CloseAsync();
            await transaction.CommitAsync();
        }

        // The setting is empty, not absent, on a reused connection: still no rows, and no error.
        await using var after = new Npgsql.NpgsqlCommand("select count(*) from macro_data.log_entries", connection);
        Assert.Equal(0L, (long)(await after.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task The_app_role_cannot_write_a_row_for_another_user()
    {
        var bob = await Sql.InsertUser(db.AdminConnectionString, "bob");
        var code = await Sql.FailureCode(db.AppConnectionString, """
            begin;
            select set_config('macro.user_id', @u, true);
            insert into macro_data.sync_state (user_id, revision) values (@b, 0);
            commit;
            """, ("u", _user.ToString()), ("b", bob));
        Assert.Equal(InsufficientPrivilege, code);
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
