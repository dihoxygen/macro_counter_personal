using System.Diagnostics;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>The pull contract: everything after the cursor, oldest first, in the device's own shape.</summary>
[Collection("Postgres")]
public class SyncPullTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private AuthClient _client = null!;

    private DateTimeOffset Now => _factory.Clock.GetUtcNow();

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        (_client, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await _client.AcknowledgeAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task All_four_record_types_come_back_oldest_first()
    {
        var (entry, food, goal, version) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await _client.PushAsync(Now,
            Upsert("goal", goal, Goal(goal, Now)),
            Upsert("food", food, Food(food, Now)),
            Upsert("entry", entry, Entry(entry, Now)),
            Insert(version, Version(version, entry, Now, Now)));

        var changes = await _client.PullAllAsync();

        Assert.Equal(4, changes.Count);
        Assert.Equal(changes.OrderBy(c => c.GetProperty("revision").GetInt64()).Select(c => c.GetProperty("revision").GetInt64()),
            changes.Select(c => c.GetProperty("revision").GetInt64()));
        Assert.Equal(["entry", "food", "goal", "version"], changes.Select(c => c.GetProperty("type").GetString()!).Order());
    }

    [Fact]
    public async Task Pages_follow_the_cursor_and_say_when_there_is_more()
    {
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid()).ToArray();
        await _client.PushAsync(Now, [.. ids.Select(id => Upsert("entry", id, Entry(id, Now)))]);

        var first = await AuthClient.Json(await _client.Http.GetAsync("/api/sync/changes?since=0&limit=2"));
        var cursor = first.GetProperty("cursor").GetInt64();
        var rest = await AuthClient.Json(await _client.Http.GetAsync($"/api/sync/changes?since={cursor}&limit=10"));

        Assert.Equal(2, first.GetProperty("changes").GetArrayLength());
        Assert.True(first.GetProperty("hasMore").GetBoolean());
        Assert.Equal(3, rest.GetProperty("changes").GetArrayLength());
        Assert.False(rest.GetProperty("hasMore").GetBoolean());
        Assert.Equal(5, rest.GetProperty("cursor").GetInt64());
    }

    [Fact]
    public async Task A_tombstone_is_an_id_and_a_flag()
    {
        var id = Guid.NewGuid();
        await _client.PushAsync(Now, Delete(id, Now));

        var change = Assert.Single(await _client.PullAllAsync());

        Assert.Equal("entry", change.GetProperty("type").GetString());
        Assert.Equal(id, change.GetProperty("id").GetGuid());
        Assert.True(change.GetProperty("deleted").GetBoolean());
        Assert.False(change.TryGetProperty("record", out _));
    }

    [Fact]
    public async Task A_record_comes_back_exactly_as_the_device_shaped_it()
    {
        var id = Guid.NewGuid();
        var food = Guid.NewGuid();
        var pushedAt = Now;
        await _client.PushAsync(pushedAt, Upsert("entry", id, Entry(id, pushedAt, 33.333333333333336, kcal: 123.456789, savedFoodId: food)));

        var record = Assert.Single(await _client.PullAllAsync()).GetProperty("record");

        Assert.Equal(id, record.GetProperty("id").GetGuid());
        Assert.Equal(Iso(pushedAt), record.GetProperty("updatedAt").GetString());
        Assert.Equal(Iso(Start), record.GetProperty("createdAt").GetString());
        Assert.Equal(Iso(Start), record.GetProperty("loggedAt").GetString());
        Assert.Equal(1, record.GetProperty("schemaVersion").GetInt32());
        Assert.Equal("2026-11-04", record.GetProperty("dayKey").GetString());
        Assert.Equal(33.333333333333336, record.GetProperty("quantity").GetProperty("amount").GetDouble());
        Assert.Equal("g", record.GetProperty("quantity").GetProperty("unit").GetString());
        Assert.Equal(123.456789, record.GetProperty("macros").GetProperty("kcal").GetDouble());
        Assert.Equal(1.3, record.GetProperty("macros").GetProperty("proteinG").GetDouble());
        Assert.Equal("manual", record.GetProperty("source").GetString());
        Assert.Equal(food, record.GetProperty("savedFoodId").GetGuid());
        Assert.Equal("breakfast", record.GetProperty("mealCategory").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, record.GetProperty("restoredAt").ValueKind);
    }

    [Fact]
    public async Task A_saved_food_and_a_goal_come_back_in_their_own_shape()
    {
        var (food, goal) = (Guid.NewGuid(), Guid.NewGuid());
        await _client.PushAsync(Now, Upsert("food", food, Food(food, Now, "Greek yogurt")), Upsert("goal", goal, Goal(goal, Now, grams: null)));

        var changes = await _client.PullAllAsync();

        var saved = changes.Find("food", food)!.Value.GetProperty("record");
        Assert.Equal("Greek yogurt", saved.GetProperty("name").GetString());
        Assert.Equal(100, saved.GetProperty("referenceQuantity").GetProperty("amount").GetDouble());
        Assert.Equal(Iso(Now), saved.GetProperty("lastUsedAt").GetString());
        var cleared = changes.Find("goal", goal)!.Value.GetProperty("record");
        Assert.Equal("2026-11-04", cleared.GetProperty("effectiveFrom").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, cleared.GetProperty("grams").ValueKind);
    }

    [Fact]
    public async Task An_empty_pull_keeps_the_cursor_and_gives_server_time()
    {
        var page = await AuthClient.Json(await _client.Http.GetAsync("/api/sync/changes?since=7"));

        Assert.Equal(7, page.GetProperty("cursor").GetInt64());
        Assert.Equal(0, page.GetProperty("changes").GetArrayLength());
        Assert.False(page.GetProperty("hasMore").GetBoolean());
        Assert.Equal(Iso(Now), page.GetProperty("serverNow").GetString());
    }

    [Fact]
    public async Task Since_is_required()
    {
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await _client.Http.GetAsync("/api/sync/changes")).StatusCode);
    }

    [Fact]
    public async Task An_empty_pull_is_cheap()
    {
        await _client.PushAsync(Now, Delete(Guid.NewGuid(), Now));
        var cursor = (await _client.PullAllAsync()).Max(c => c.GetProperty("revision").GetInt64());
        var times = new List<double>();
        for (var i = 0; i < 40; i++)
        {
            var watch = Stopwatch.StartNew();
            await _client.Http.GetAsync($"/api/sync/changes?since={cursor}");
            times.Add(watch.Elapsed.TotalMilliseconds);
        }

        // A loose bound on purpose: this guards against a full scan, not against a busy machine running coverage.
        Assert.True(times.Order().ElementAt(37) < 1000, $"p95 was {times.Order().ElementAt(37)} ms");
    }
}
