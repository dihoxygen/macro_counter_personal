using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>Two devices pushing at once: no pull ever skips a change (R2).</summary>
[Collection("Postgres")]
public class SyncConcurrencyTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static object[] Batch(DateTimeOffset now, int count) => [.. Enumerable.Range(0, count).Select(_ =>
    {
        var id = Guid.NewGuid();
        return Upsert("entry", id, Entry(id, now));
    })];

    [Fact]
    public async Task Parallel_pushes_give_every_change_its_own_revision()
    {
        var (a, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await a.AcknowledgeAsync();
        var now = _factory.Clock.GetUtcNow();

        await Task.WhenAll(a.PushAsync(now, Batch(now, 50)), a.PushAsync(now, Batch(now, 50)));

        var changes = await a.PullAllAsync();
        Assert.Equal(Enumerable.Range(1, 100).Select(i => (long)i), changes.Select(c => c.GetProperty("revision").GetInt64()));
    }

    [Fact]
    public async Task A_device_pulling_while_others_push_ends_up_with_everything()
    {
        var (a, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await a.AcknowledgeAsync();
        var now = _factory.Clock.GetUtcNow();

        var seen = new HashSet<long>();
        var cursor = 0L;
        async Task PullOnce()
        {
            var page = await AuthClient.Json(await a.Http.GetAsync($"/api/sync/changes?since={cursor}"));
            foreach (var change in page.GetProperty("changes").EnumerateArray()) seen.Add(change.GetProperty("revision").GetInt64());
            cursor = page.GetProperty("cursor").GetInt64();
        }

        var pushes = Task.WhenAll(Enumerable.Range(0, 5).Select(_ => a.PushAsync(now, Batch(now, 10))));
        while (!pushes.IsCompleted) await PullOnce();
        await pushes;
        await PullOnce();

        Assert.Equal(Enumerable.Range(1, 50).Select(i => (long)i), seen.Order());
    }
}
