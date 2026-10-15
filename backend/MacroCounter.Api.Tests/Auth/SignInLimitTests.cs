using System.Net;
using System.Text.Json.Nodes;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>SC-006 / FR-020: repeated failures slow sign-in down, identically for real and unknown names.</summary>
[Collection("Postgres")]
public class SignInLimitTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        // These tests are about per-name limits; the per-IP limit has its own test and host below.
        _factory.Settings["Security:SignIn:PerIpLimit"] = "1000";
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task<HttpResponseMessage> Attempt(AuthClient client, string username, string password, string? code = null,
        string? forwardedFor = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/sign-in")
        {
            Content = System.Net.Http.Json.JsonContent.Create(code is null ? new { username, password } : (object)new { username, password, code }),
        };
        request.Headers.Add("X-CSRF-Token", client.Csrf);
        if (forwardedFor is not null) request.Headers.Add("X-Forwarded-For", forwardedFor);
        return await client.Http.SendAsync(request);
    }

    private static async Task<string> BodyWithoutTraceId(HttpResponseMessage response)
    {
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        json.Remove("traceId");
        return json.ToJsonString();
    }

    [Fact]
    public async Task After_ten_failures_even_the_right_password_is_refused_the_same_way_as_for_an_unknown_name()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        for (var i = 0; i < 10; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Attempt(client, "alice", "wrong password entirely")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await Attempt(client, "nobody", "wrong password entirely")).StatusCode);
        }

        var real = await Attempt(client, "alice", alice.Password, alice.Code());
        var unknown = await Attempt(client, "nobody", alice.Password, alice.Code());

        Assert.Equal(HttpStatusCode.TooManyRequests, real.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, unknown.StatusCode);
        Assert.True(real.Headers.RetryAfter is not null && unknown.Headers.RetryAfter is not null);
        Assert.Equal(await BodyWithoutTraceId(real), await BodyWithoutTraceId(unknown));
        Assert.Equal("rate_limited", JsonNode.Parse(await real.Content.ReadAsStringAsync())!["code"]!.GetValue<string>());
        Assert.True(await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'rate_limited'") >= 2);
    }

    [Fact]
    public async Task After_the_window_and_an_owner_unlock_sign_in_works_again()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        for (var i = 0; i < 10; i++) await Attempt(client, "alice", "wrong password entirely");
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Attempt(client, "alice", alice.Password, alice.Code())).StatusCode);

        _factory.Clock.Advance(TimeSpan.FromMinutes(15) + TimeSpan.FromSeconds(1));
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.unlock_user('alice')");

        Assert.Equal(HttpStatusCode.OK, (await Attempt(client, "alice", alice.Password, alice.Code())).StatusCode);
    }

    [Fact]
    public async Task The_account_lockout_survives_a_restart()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        for (var i = 0; i < 10; i++) await Attempt(client, "alice", "wrong password entirely");
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString, "select lockout_end > now() from macro.users"));

        // A new process: the in-memory throttle is empty, but the lockout stored on the account still applies.
        await using var restarted = new ApiFactory(db, apiKey: null);
        var after = new AuthClient(restarted);
        await after.SessionAsync();
        var response = await Attempt(after, "alice", alice.Password, alice.Code());

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sign_in_locked'"));
    }

    [Fact]
    public async Task Twenty_attempts_per_ip_in_the_window_then_refused()
    {
        await using var defaults = new ApiFactory(db, apiKey: null);
        var client = new AuthClient(defaults);
        await client.SessionAsync();

        for (var i = 0; i < 20; i++)
        {
            var response = await Attempt(client, $"name{i}", "wrong password entirely", forwardedFor: "203.0.113.9");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
        var limited = await Attempt(client, "another-name", "wrong password entirely", forwardedFor: "203.0.113.9");
        var otherIp = await Attempt(client, "another-name", "wrong password entirely", forwardedFor: "198.51.100.4");

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.NotNull(limited.Headers.RetryAfter);
        Assert.Equal(HttpStatusCode.Unauthorized, otherIp.StatusCode);
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString,
            "select exists (select 1 from macro.audit_events where event_type = 'rate_limited' and host(source_ip) = '203.0.113.9')"));
    }
}
