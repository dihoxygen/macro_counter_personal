using System.Net;
using System.Net.Http.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// ASVS 7.1.3, 7.2.2 and 14.5.1 (checklists/asvs-l2.md G8): every refused /api request is logged with its
/// method, path, status and address, and never with its body or cookies.
/// </summary>
[Collection("Postgres")]
public class RefusedRequestLogTests(PostgresFixture db) : IAsyncLifetime
{
    private readonly CapturingLoggerProvider _logs = new();
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        _factory.ServiceOverrides.Add(services => services.AddSingleton<ILoggerProvider>(_logs));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private (LogLevel Level, string Category, string Text)[] Refusals() =>
        _logs.Entries.Where(e => e.Text.StartsWith("Refused ", StringComparison.Ordinal)).ToArray();

    [Fact]
    public async Task A_request_without_a_session_is_logged()
    {
        var response = await new AuthClient(_factory).Http.GetAsync("/api/status?secret=in-the-query");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var entry = Assert.Single(Refusals());
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Contains("GET /api/status", entry.Text);
        Assert.Contains("401", entry.Text);
        Assert.DoesNotContain("in-the-query", entry.Text);
    }

    [Fact]
    public async Task A_foreign_origin_is_logged()
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/sign-in")
        {
            Content = JsonContent.Create(new { username = "nobody", password = "a password that is never logged" }),
        };
        request.Headers.Add("X-CSRF-Token", client.Csrf);
        request.Headers.Add("Origin", "https://evil.example");

        Assert.Equal(HttpStatusCode.Forbidden, (await client.Http.SendAsync(request)).StatusCode);
        Assert.Contains("POST /api/auth/sign-in", Assert.Single(Refusals()).Text);
        Assert.Contains("403", Assert.Single(Refusals()).Text);
        Assert.DoesNotContain(_logs.Entries, e => e.Text.Contains("a password that is never logged"));
    }

    [Fact]
    public async Task A_method_the_api_does_not_use_is_logged()
    {
        var response = await new AuthClient(_factory).Http.DeleteAsync("/api/health");

        // No endpoint matches, so deny-by-default answers it like any unknown path.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("DELETE /api/health", Assert.Single(Refusals()).Text);
    }

    [Fact]
    public async Task An_invalid_body_is_logged_without_the_body()
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        var response = await client.PostAsync("/api/auth/sign-in", new { username = "nobody", password = "secret-in-a-bad-body", extra = 1 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("400", Assert.Single(Refusals()).Text);
        Assert.DoesNotContain(_logs.Entries, e => e.Text.Contains("secret-in-a-bad-body"));
    }

    [Fact]
    public async Task Successful_requests_and_the_app_shell_are_not_logged()
    {
        var client = new AuthClient(_factory);

        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/health")).StatusCode);
        await client.SessionAsync();

        Assert.Empty(Refusals());
    }
}
