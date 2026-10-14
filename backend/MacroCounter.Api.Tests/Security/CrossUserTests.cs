using System.Net;
using System.Net.Http.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>FR-014: a signed-in person can only act as themselves. No endpoint takes a user id as input.</summary>
[Collection("Postgres")]
public class CrossUserTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: "test-key-not-real", FakeEstimator.Returning(FakeEstimator.Banana));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Signing_out_everywhere_ends_only_your_own_sessions()
    {
        var (alice, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        var (bob, _) = await TestUsers.ActivateAsync(db, _factory, "bob");

        Assert.Equal(HttpStatusCode.NoContent, (await alice.PostAsync("/api/auth/sign-out-everywhere")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await bob.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await alice.Http.GetAsync("/api/status")).StatusCode);
    }

    [Fact]
    public async Task Another_persons_id_in_the_body_or_query_never_changes_who_is_acting()
    {
        var (alice, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        var (bob, bobUser) = await TestUsers.ActivateAsync(db, _factory, "bob");

        // Smuggled ids on auth endpoints are rejected outright (strict JSON).
        var smuggled = await alice.PostRawAsync("/api/auth/sign-out-everywhere?userId=" + bobUser.Id,
            $$"""{"userId":"{{bobUser.Id}}","user_id":"{{bobUser.Id}}","sub":"{{bobUser.Id}}"}""");
        Assert.NotEqual(HttpStatusCode.InternalServerError, smuggled.StatusCode);

        // Whatever happened to alice, bob is still signed in.
        Assert.Equal(HttpStatusCode.OK, (await bob.Http.GetAsync("/api/status")).StatusCode);

        // On the estimate endpoint an extra id is ignored at most; it cannot make the request count as bob's.
        await alice.SessionAsync();
        var estimate = await alice.PostAsync("/api/estimates/text?userId=" + bobUser.Id,
            new { description = "banana", userId = bobUser.Id });
        Assert.Contains(estimate.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized });
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.ai_usage_daily where user_id = @b", ("b", bobUser.Id)));
    }

    [Fact]
    public async Task One_persons_csrf_token_does_not_work_with_another_persons_session()
    {
        var (alice, _) = await TestUsers.ActivateAsync(db, _factory, "alice");
        var (bob, _) = await TestUsers.ActivateAsync(db, _factory, "bob");

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/sign-out-everywhere");
        request.Headers.Add("X-CSRF-Token", alice.Csrf);
        var response = await bob.Http.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await bob.Http.GetAsync("/api/status")).StatusCode);
    }
}
