using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>FR-017: nothing syncs until the user has read the notice. The server enforces it, not the app (R7).</summary>
[Collection("Postgres")]
public class SyncNoticeTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await AuthClient.Json(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_new_user_has_not_acknowledged_and_has_no_revision()
    {
        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "alice");

        var state = await AuthClient.Json(await client.Http.GetAsync("/api/sync/state"));

        Assert.False(state.GetProperty("noticeAcknowledged").GetBoolean());
        Assert.Equal(0, state.GetProperty("revision").GetInt64());
    }

    [Fact]
    public async Task Push_and_pull_are_refused_until_the_notice_is_acknowledged()
    {
        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        var id = Guid.NewGuid();
        var body = new
        {
            clientNow = SyncTestData.Iso(SyncTestData.Start),
            changes = new[] { SyncTestData.Upsert("entry", id, SyncTestData.Entry(id, SyncTestData.Start)) },
        };

        await AssertProblem(await client.PostAsync("/api/sync/push", body), HttpStatusCode.Conflict, "sync_notice_required");
        await AssertProblem(await client.Http.GetAsync("/api/sync/changes?since=0"), HttpStatusCode.Conflict, "sync_notice_required");

        await client.AcknowledgeAsync();

        Assert.True((await AuthClient.Json(await client.Http.GetAsync("/api/sync/state"))).GetProperty("noticeAcknowledged").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/sync/push", body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/sync/changes?since=0")).StatusCode);
    }

    [Fact]
    public async Task Acknowledging_twice_is_fine_and_keeps_the_first_time()
    {
        var (client, user) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await client.AcknowledgeAsync();
        var first = await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select notice_ack_at from macro_data.sync_state where user_id = @u", ("u", user.Id));

        _factory.Clock.Advance(TimeSpan.FromMinutes(5));
        await client.AcknowledgeAsync();

        Assert.Equal(first, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select notice_ack_at from macro_data.sync_state where user_id = @u", ("u", user.Id)));
    }

    [Theory]
    [InlineData("GET", "/api/sync/state")]
    [InlineData("GET", "/api/sync/changes?since=0")]
    [InlineData("POST", "/api/sync/notice")]
    [InlineData("POST", "/api/sync/push")]
    public async Task Every_endpoint_needs_a_session(string method, string path)
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        var response = method == "GET" ? await client.Http.GetAsync(path) : await client.PostAsync(path);

        await AssertProblem(response, HttpStatusCode.Unauthorized, "unauthenticated");
    }

    [Theory]
    [InlineData("/api/sync/notice")]
    [InlineData("/api/sync/push")]
    public async Task Posts_need_a_csrf_token(string path)
    {
        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "alice");

        await AssertProblem(await client.PostAsync(path, withCsrf: false), HttpStatusCode.Forbidden, "csrf_failed");
    }
}
