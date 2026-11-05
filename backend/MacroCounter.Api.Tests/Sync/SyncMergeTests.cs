using System.Text.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using MacroCounter.Api.Tests.Security;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>Two devices creating the same food or goal day end up with one row (R4, FR-008).</summary>
[Collection("Postgres")]
public class SyncMergeTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private AuthClient _client = null!;
    private ActiveUser _user = null!;
    private readonly Guid _first = Guid.NewGuid();
    private readonly Guid _second = Guid.NewGuid();

    private DateTimeOffset Now => _factory.Clock.GetUtcNow();

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        (_client, _user) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await _client.AcknowledgeAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private void Advance() => _factory.Clock.Advance(TimeSpan.FromMinutes(1));

    private Task<long> Foods() => Sql.Scalar<long>(db.AdminConnectionString,
        "select count(*) from macro_data.saved_foods where user_id = @u", ("u", _user.Id));

    private static void AssertMerged(JsonElement push, Guid canonical)
    {
        var result = push.GetProperty("results")[0];
        Assert.Equal("merged", result.GetProperty("status").GetString());
        Assert.Equal(canonical, result.GetProperty("canonicalId").GetGuid());
    }

    public static TheoryData<string> Names()
    {
        var names = new TheoryData<string>();
        var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(EndpointInventoryTests.RepoRoot(), "backend",
            "MacroCounter.Api.Tests", "Sync", "vectors", "normalize.json")));
        foreach (var vector in vectors.RootElement.GetProperty("cases").EnumerateArray()) names.Add(vector.GetProperty("input").GetString()!);
        return names;
    }

    [Theory]
    [MemberData(nameof(Names))]
    public async Task The_same_name_after_normalizing_is_one_food(string input)
    {
        var normalized = input.Trim().ToLowerInvariant();
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now, normalized)));
        Advance();

        var push = await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now, input)));

        AssertMerged(push, _first);
        Assert.Equal(1L, await Foods());
        Assert.Equal(_first, await Sql.Scalar<Guid>(db.AdminConnectionString,
            "select canonical_id from macro_data.saved_food_aliases where alias_id = @a", ("a", _second)));
    }

    [Fact]
    public async Task The_newer_macros_win_and_the_later_last_use_stays()
    {
        var earlierUse = Now.AddHours(-2);
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now.AddMinutes(-5), kcal: 100, lastUsedAt: Now.AddHours(-1))));

        await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now, kcal: 200, lastUsedAt: earlierUse)));

        Assert.Equal(200, await Sql.Scalar<double>(db.AdminConnectionString, "select kcal from macro_data.saved_foods where id = @i", ("i", _first)));
        Assert.Equal(Now.AddHours(-1).UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select last_used_at from macro_data.saved_foods where id = @i", ("i", _first)));
    }

    [Fact]
    public async Task An_older_duplicate_keeps_the_stored_macros_but_can_raise_the_last_use()
    {
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now, kcal: 100, lastUsedAt: Now.AddHours(-1))));
        Advance();

        var push = await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now.AddHours(-3), kcal: 200, lastUsedAt: Now)));

        AssertMerged(push, _first);
        Assert.Equal(100, await Sql.Scalar<double>(db.AdminConnectionString, "select kcal from macro_data.saved_foods where id = @i", ("i", _first)));
        Assert.Equal(Now.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select last_used_at from macro_data.saved_foods where id = @i", ("i", _first)));
    }

    [Fact]
    public async Task A_stored_row_that_wins_a_merge_comes_back_in_the_next_pull()
    {
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now, kcal: 100)));
        Advance();
        var cursor = (await _client.PullAllAsync()).Max(c => c.GetProperty("revision").GetInt64());

        await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now.AddHours(-3), kcal: 200)));

        Assert.NotNull((await _client.PullAllAsync(cursor)).Find("food", _first));
    }

    [Fact]
    public async Task The_same_name_with_another_unit_is_a_different_food()
    {
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now, unit: "g")));

        var push = await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now, unit: "ml")));

        Assert.Equal(["applied"], push.Statuses());
        Assert.Equal(2L, await Foods());
    }

    [Fact]
    public async Task The_same_goal_day_is_one_goal_and_the_newer_value_wins()
    {
        await _client.PushAsync(Now, Upsert("goal", _first, Goal(_first, Now.AddMinutes(-5), 150)));

        var push = await _client.PushAsync(Now, Upsert("goal", _second, Goal(_second, Now, 170)));

        AssertMerged(push, _first);
        Assert.Equal(170, await Sql.Scalar<double>(db.AdminConnectionString, "select grams from macro_data.protein_goals where id = @i", ("i", _first)));
        Assert.Equal(_first, await Sql.Scalar<Guid>(db.AdminConnectionString,
            "select canonical_id from macro_data.protein_goal_aliases where alias_id = @a", ("a", _second)));
    }

    [Fact]
    public async Task A_change_sent_to_an_alias_reaches_the_canonical_row()
    {
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now.AddMinutes(-5), kcal: 100)));
        await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now.AddMinutes(-4), kcal: 150)));
        Advance();

        var push = await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now, kcal: 300)));

        AssertMerged(push, _first);
        Assert.Equal(300, await Sql.Scalar<double>(db.AdminConnectionString, "select kcal from macro_data.saved_foods where id = @i", ("i", _first)));
    }

    [Fact]
    public async Task An_entry_or_version_linked_to_an_alias_is_stored_with_the_canonical_id()
    {
        await _client.PushAsync(Now, Upsert("food", _first, Food(_first, Now.AddMinutes(-5))));
        await _client.PushAsync(Now, Upsert("food", _second, Food(_second, Now.AddMinutes(-4))));
        var (entry, state) = (Guid.NewGuid(), Guid.NewGuid());

        await _client.PushAsync(Now,
            Upsert("entry", entry, Entry(entry, Now, savedFoodId: _second)),
            Insert(state, Version(state, Guid.NewGuid(), Now, Now, savedFoodId: _second)));

        Assert.Equal(_first, await Sql.Scalar<Guid>(db.AdminConnectionString, "select saved_food_id from macro_data.log_entries where id = @i", ("i", entry)));
        Assert.Equal(_first, await Sql.Scalar<Guid>(db.AdminConnectionString, "select saved_food_id from macro_data.entry_versions where id = @i", ("i", state)));
    }

    [Fact]
    public async Task An_unknown_food_link_is_accepted_as_it_is()
    {
        var entry = Guid.NewGuid();
        var unknown = Guid.NewGuid();

        await _client.PushAsync(Now, Upsert("entry", entry, Entry(entry, Now, savedFoodId: unknown)));

        Assert.Equal(unknown, await Sql.Scalar<Guid>(db.AdminConnectionString, "select saved_food_id from macro_data.log_entries where id = @i", ("i", entry)));
    }
}
