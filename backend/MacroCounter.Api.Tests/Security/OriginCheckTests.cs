using System.Net;
using System.Net.Http.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>FR-029 / R10: only the app's own origins may make unsafe /api requests from a browser.</summary>
[Collection("Postgres")]
public class OriginCheckTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private AuthClient _client = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        _client = new AuthClient(_factory);
        await _client.SessionAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private Task<HttpResponseMessage> SignIn(params (string Name, string Value)[] headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/sign-in")
        {
            Content = JsonContent.Create(new { username = "nobody", password = "not a real password" }),
        };
        request.Headers.Add("X-CSRF-Token", _client.Csrf);
        foreach (var (name, value) in headers) request.Headers.Add(name, value);
        return _client.Http.SendAsync(request);
    }

    private static async Task<string?> Code(HttpResponseMessage response) =>
        (await AuthClient.Json(response)).TryGetProperty("code", out var code) ? code.GetString() : null;

    [Fact]
    public async Task A_foreign_origin_is_refused_even_with_a_valid_token()
    {
        var response = await SignIn(("Origin", "https://evil.example"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("csrf_failed", await Code(response));
    }

    [Fact]
    public async Task A_cross_site_request_without_origin_is_refused()
    {
        var response = await SignIn(("Sec-Fetch-Site", "cross-site"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("csrf_failed", await Code(response));
    }

    [Theory]
    [InlineData("same-origin")]
    [InlineData(null)]
    public async Task Same_origin_or_non_browser_requests_go_on_to_the_csrf_check(string? fetchSite)
    {
        var response = fetchSite is null ? await SignIn() : await SignIn(("Sec-Fetch-Site", fetchSite));

        // Not refused by the origin check: it reaches sign-in, which fails for this unknown name.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("sign_in_failed", await Code(response));
    }

    [Theory]
    [InlineData("http://localhost:5080")]
    [InlineData("http://localhost:5173")]
    [InlineData("HTTP://LOCALHOST:5173")]
    public async Task An_allowed_origin_passes(string origin)
    {
        var response = await SignIn(("Origin", origin));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("sign_in_failed", await Code(response));
    }

    [Fact]
    public async Task Reads_are_never_blocked_by_origin()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/session");
        request.Headers.Add("Origin", "https://evil.example");
        request.Headers.Add("Sec-Fetch-Site", "cross-site");

        Assert.Equal(HttpStatusCode.OK, (await _client.Http.SendAsync(request)).StatusCode);
    }
}
