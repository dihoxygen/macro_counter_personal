using MacroCounter.Api.Tests.Infrastructure;
using Npgsql;

namespace MacroCounter.Api.Tests.Database;

/// <summary>The activity tables enforce data-model.md themselves, behind the endpoint validator (007 R1).</summary>
[Collection("Postgres")]
public class ActivityDataMigrationTests(PostgresFixture db) : IAsyncLifetime
{
    private const string CheckViolation = "23514";

    private static readonly string[] Tables =
        ["log_entries", "entry_versions", "saved_foods", "protein_goals", "saved_food_aliases", "protein_goal_aliases", "sync_state"];

    private static readonly string[] RecordTables = ["log_entries", "entry_versions", "saved_foods", "protein_goals"];

    private Guid _user;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _user = await Sql.InsertUser(db.AdminConnectionString, "alice");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private const string InsertEntry = """
        insert into macro_data.log_entries
          (user_id, id, created_at, effective_at, schema_version, revision, day_key, logged_at, name,
           quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source, version_id, meal_category)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, '2026-11-04', now(), @name,
                @amount, @unit, @kcal, @protein, 1, 1, @source, gen_random_uuid(), @meal)
        """;

    private Task Entry(string name = "Banana", double amount = 1, string unit = "g", double kcal = 1, double protein = 1,
        string source = "manual", string? meal = null) =>
        Sql.Execute(db.AdminConnectionString, InsertEntry, ("u", _user), ("name", name), ("amount", amount), ("unit", unit),
            ("kcal", kcal), ("protein", protein), ("source", source), ("meal", (object?)meal ?? DBNull.Value));

    private async Task AssertCheckFails(Func<Task> insert)
    {
        var error = await Assert.ThrowsAsync<PostgresException>(insert);
        Assert.Equal(CheckViolation, error.SqlState);
    }

    [Fact]
    public async Task Every_table_exists_with_row_level_security_on()
    {
        foreach (var table in Tables)
        {
            Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString, """
                select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'macro_data' and c.relname = @t
                """, ("t", table)), table);
        }
    }

    [Fact]
    public async Task Record_tables_are_keyed_by_user_and_id_and_cascade_from_the_user()
    {
        foreach (var table in RecordTables)
        {
            var key = await Sql.Scalar<string>(db.AdminConnectionString, """
                select string_agg(a.attname, ',' order by k.ordinality)
                from pg_index i
                join pg_class c on c.oid = i.indrelid
                join pg_namespace n on n.oid = c.relnamespace
                cross join lateral unnest(i.indkey) with ordinality k(attnum, ordinality)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
                where n.nspname = 'macro_data' and c.relname = @t and i.indisprimary
                """, ("t", table));
            Assert.Equal("user_id,id", key);

            Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, """
                select count(*) from pg_constraint f
                join pg_class c on c.oid = f.conrelid
                join pg_namespace n on n.oid = c.relnamespace
                where f.contype = 'f' and n.nspname = 'macro_data' and c.relname = @t
                  and f.confdeltype = 'c' and f.confrelid = 'macro.users'::regclass
                """, ("t", table)));

            Assert.True(await HasIndex(table, "(user_id, revision)"), $"{table} needs a revision index");
        }
    }

    private Task<bool> HasIndex(string table, string columns) => Sql.Scalar<bool>(db.AdminConnectionString, """
        select exists (select 1 from pg_indexes
                       where schemaname = 'macro_data' and tablename = @t and indexdef like '%' || @c || '%')
        """, ("t", table), ("c", columns));

    [Fact]
    public async Task Entry_versions_have_lookup_and_purge_indexes()
    {
        Assert.True(await HasIndex("entry_versions", "(user_id, entry_id)"));
        Assert.True(await HasIndex("entry_versions", "(replaced_at)"));
    }

    [Fact]
    public async Task Saved_foods_and_goals_are_unique_by_natural_key()
    {
        var foods = await Sql.Scalar<string>(db.AdminConnectionString, """
            select indexdef from pg_indexes
            where schemaname = 'macro_data' and tablename = 'saved_foods' and indexdef like '%normalized_name%'
            """);
        Assert.Contains("UNIQUE", foods);
        Assert.Contains("(user_id, normalized_name, ref_unit)", foods);
        Assert.Contains("deleted_at IS NULL", foods);
        Assert.True(await HasIndex("protein_goals", "(user_id, effective_from)"));
    }

    [Theory]
    [InlineData(1d, "oz", 1d, 1d, "manual")]
    [InlineData(100001d, "g", 1d, 1d, "manual")]
    [InlineData(-1d, "g", 1d, 1d, "manual")]
    [InlineData(1d, "g", 100001d, 1d, "manual")]
    [InlineData(1d, "g", -1d, 1d, "manual")]
    [InlineData(1d, "g", 1d, 10001d, "manual")]
    [InlineData(1d, "g", 1d, 1d, "import")]
    public Task Entry_values_outside_the_bounds_are_rejected(double amount, string unit, double kcal, double protein, string source) =>
        AssertCheckFails(() => Entry(amount: amount, unit: unit, kcal: kcal, protein: protein, source: source));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public Task An_empty_name_is_rejected(string name) => AssertCheckFails(() => Entry(name: name));

    [Fact]
    public Task A_name_over_120_characters_is_rejected() => AssertCheckFails(() => Entry(name: new string('x', 121)));

    [Fact]
    public Task An_unknown_meal_category_is_rejected() => AssertCheckFails(() => Entry(meal: "brunch"));

    [Theory]
    [InlineData("breakfast")]
    [InlineData("snacks")]
    [InlineData(null)]
    public Task A_known_category_or_none_is_accepted(string? meal) => Entry(meal: meal);

    [Theory]
    [InlineData(0d)]
    [InlineData(10001d)]
    public Task Goal_grams_outside_the_bounds_are_rejected(double grams) => AssertCheckFails(() => Goal(grams));

    [Fact]
    public Task A_cleared_goal_is_accepted() => Goal(null);

    private Task Goal(double? grams) => Sql.Execute(db.AdminConnectionString, """
        insert into macro_data.protein_goals (user_id, id, created_at, effective_at, schema_version, revision, effective_from, grams)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, '2026-11-04', @g)
        """, ("u", _user), ("g", (object?)grams ?? DBNull.Value));

    private Task Version(string changeType) => Sql.Execute(db.AdminConnectionString, """
        insert into macro_data.entry_versions
          (user_id, id, entry_id, change_type, replaced_at, created_at, effective_at, schema_version, revision, day_key,
           logged_at, name, quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source)
        values (@u, gen_random_uuid(), gen_random_uuid(), @c, now(), now(), now(), 1, 1, '2026-11-04',
                now(), 'Banana', 1, 'g', 1, 1, 1, 1, 'manual')
        """, ("u", _user), ("c", changeType));

    [Fact]
    public Task An_unknown_change_type_is_rejected() => AssertCheckFails(() => Version("merge"));

    [Fact]
    public Task A_live_entry_needs_its_data() => AssertCheckFails(() => Sql.Execute(db.AdminConnectionString, """
        insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision)
        values (@u, gen_random_uuid(), now(), now(), 1, 1)
        """, ("u", _user)));

    [Fact]
    public Task A_tombstone_cannot_hold_food_data() => AssertCheckFails(() => Sql.Execute(db.AdminConnectionString, """
        insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, deleted_at, name)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, now(), 'Banana')
        """, ("u", _user)));

    [Fact]
    public Task A_tombstone_needs_no_data() => Sql.Execute(db.AdminConnectionString, """
        insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, deleted_at)
        values (@u, gen_random_uuid(), now(), now(), 1, 1, now())
        """, ("u", _user));

    [Fact]
    public async Task The_purge_removes_versions_after_90_days_and_keeps_tombstones()
    {
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, deleted_at)
            values (@u, gen_random_uuid(), now() - interval '100 days', now() - interval '100 days', 1, 1, now() - interval '100 days');
            insert into macro.audit_events (occurred_at, event_type, outcome, actor) values (now() - interval '181 days', 'sign_in', 'success', 'user');
            """, ("u", _user));
        await Version("delete");
        await Version("edit");
        await Sql.Execute(db.AdminConnectionString, """
            update macro_data.entry_versions set replaced_at = now() - interval '91 days'
            where change_type = 'delete'
            """);

        Assert.Equal(2, await Sql.Scalar<int>(db.AdminConnectionString, "select macro_admin.purge_expired()"));

        Assert.Equal("edit", await Sql.Scalar<string>(db.AdminConnectionString, "select change_type from macro_data.entry_versions"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro_data.log_entries"));
    }
}
