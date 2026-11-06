using System.Net;
using MacroCounter.Api.Tests.Audit;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>FR-018: sync is limited per user by rate and by size (R11).</summary>
[Collection("Postgres")]
public class SyncLimitsTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Sixty_requests_a_minute_pass_and_the_next_is_refused_for_that_user_only()
    {
        var (alice, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        var (bob, _) = await TestUsers.ActivateAsync(db, _factory, "bob");

        for (var i = 0; i < 60; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await alice.Http.GetAsync("/api/sync/state")).StatusCode);
        }

        var refused = await alice.Http.GetAsync("/api/sync/state");

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.NotNull(refused.Headers.RetryAfter);
        Assert.Equal("rate_limited", (await AuthClient.Json(refused)).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.OK, (await bob.Http.GetAsync("/api/sync/state")).StatusCode);

        var rows = await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'rate_limited' and reason = 'sync'");
        Assert.Equal(1L, rows);
    }

    [Fact]
    public async Task A_body_over_256_KiB_is_refused()
    {
        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await client.AcknowledgeAsync();

        var body = $$"""{"clientNow":"2026-11-04T08:00:00.000Z","changes":[],"padding":"{{new string('x', 256 * 1024)}}"}""";

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await client.PostRawAsync("/api/sync/push", body)).StatusCode);
    }

    [Fact]
    public async Task A_page_is_capped_at_500_records()
    {
        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await client.AcknowledgeAsync();
        for (var batch = 0; batch < 3; batch++)
        {
            var changes = Enumerable.Range(0, 200).Select(_ =>
            {
                var id = Guid.NewGuid();
                return SyncTestData.Upsert("entry", id, SyncTestData.Entry(id, SyncTestData.Start));
            }).ToArray();
            await client.PushAsync(SyncTestData.Start, changes);
        }

        var page = await AuthClient.Json(await client.Http.GetAsync("/api/sync/changes?since=0&limit=9999"));

        Assert.Equal(500, page.GetProperty("changes").GetArrayLength());
        Assert.True(page.GetProperty("hasMore").GetBoolean());
    }
}
