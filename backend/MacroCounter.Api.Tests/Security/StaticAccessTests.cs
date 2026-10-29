using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// The app shell is public (it has to load to show sign-in), but nothing under /api falls back to it:
/// unknown /api paths are refused like any other server feature.
/// </summary>
[Collection("Postgres")]
public class StaticAccessTests(PostgresFixture db) : IAsyncLifetime
{
    private readonly string _webRoot = Path.Combine(Path.GetTempPath(), "macro-webroot-" + Guid.NewGuid().ToString("N"));
    private ApiFactory _factory = null!;

    public Task InitializeAsync()
    {
        Directory.CreateDirectory(Path.Combine(_webRoot, "assets"));
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), "<!doctype html><title>Macro Counter</title>");
        File.WriteAllText(Path.Combine(_webRoot, "assets", "app-1234.js"), "console.log('app');");
        _factory = new ApiFactory(db, apiKey: null) { WebRoot = _webRoot };
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _factory.DisposeAsync();
        Directory.Delete(_webRoot, recursive: true);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/assets/app-1234.js")]
    [InlineData("/history")]
    public async Task The_app_shell_loads_without_a_session(string path)
    {
        var response = await _factory.CreateClient().GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/unknown")]
    [InlineData("/api/admin/users")]
    [InlineData("/api")]
    public async Task Unknown_api_paths_are_refused_not_served_the_app(string path)
    {
        var response = await _factory.CreateClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.DoesNotContain("<!doctype html>", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }
}
