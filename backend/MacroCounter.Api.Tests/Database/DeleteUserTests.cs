using MacroCounter.Api.Tests.Infrastructure;
using Npgsql;

namespace MacroCounter.Api.Tests.Database;

/// <summary>FR-016: removing a user removes all of their data, and only theirs. Audit history stays, unlinked.</summary>
[Collection("Postgres")]
public class DeleteUserTests(PostgresFixture db) : IAsyncLifetime
{
    private static readonly string[] ActivityTables =
        ["log_entries", "entry_versions", "saved_foods", "protein_goals", "saved_food_aliases", "protein_goal_aliases", "sync_state"];

    private Guid _yuki;
    private Guid _bob;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _yuki = await Sql.InsertUser(db.AdminConnectionString, "yuki");
        _bob = await Sql.InsertUser(db.AdminConnectionString, "bob");
        await Seed(_yuki);
        await Seed(_bob);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task Seed(Guid user) => Sql.Execute(db.AdminConnectionString, """
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
        insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
        values (gen_random_uuid()::text::bytea, @u, 'full', 'stamp', '\x00', now(), now(), now() + interval '1 day');
        insert into macro.audit_events (event_type, outcome, actor, user_id) values ('sign_in', 'success', 'user', @u);
        """, ("u", user));

    private Task<long> RowsFor(string table, Guid user) => Sql.Scalar<long>(db.AdminConnectionString,
        $"select count(*) from macro_data.{table} where user_id = @u", ("u", user));

    [Fact]
    public async Task Every_row_goes_and_other_users_are_untouched()
    {
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.delete_user('yuki')");

        foreach (var table in ActivityTables)
        {
            Assert.Equal(0L, await RowsFor(table, _yuki));
            Assert.Equal(1L, await RowsFor(table, _bob));
        }
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.users where id = @u", ("u", _yuki)));
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions where user_id = @u", ("u", _yuki)));
    }

    [Fact]
    public async Task Audit_rows_stay_unlinked_with_a_record_of_the_removal()
    {
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.delete_user('yuki')");

        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sign_in' and user_id is null"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'user_deleted' and actor = 'owner' and user_id is null"));
    }

    [Fact]
    public async Task The_app_role_cannot_call_it()
    {
        Assert.Equal("42501", await Sql.FailureCode(db.AppConnectionString, "select macro_admin.delete_user('yuki')"));
    }

    [Fact]
    public async Task An_unknown_username_is_an_error()
    {
        await Assert.ThrowsAsync<PostgresException>(() => Sql.Execute(db.AdminConnectionString, "select macro_admin.delete_user('nobody')"));
    }
}
