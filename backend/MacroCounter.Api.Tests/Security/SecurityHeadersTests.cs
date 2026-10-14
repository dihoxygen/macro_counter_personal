using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>FR-028 / contracts/http-hardening.md: protective headers on every response.</summary>
[Collection("Postgres")]
public class SecurityHeadersTests(PostgresFixture db) : IAsyncLifetime
{
    public const string ProductionCsp =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; " +
        "worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; " +
        "frame-ancestors 'none'; upgrade-insecure-requests";

    private readonly string _webRoot = Path.Combine(Path.GetTempPath(), "macro-headers-" + Guid.NewGuid().ToString("N"));

    public Task InitializeAsync()
    {
        Directory.CreateDirectory(Path.Combine(_webRoot, "assets"));
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), "<!doctype html><title>Macro Counter</title>");
        File.WriteAllText(Path.Combine(_webRoot, "assets", "app-1234.js"), "console.log('app');");
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        Directory.Delete(_webRoot, recursive: true);
        return Task.CompletedTask;
    }

    private ApiFactory Factory(string environment = "Testing")
    {
        var factory = new ApiFactory(db, apiKey: null) { WebRoot = _webRoot, EnvironmentName = environment };
        if (environment == "Production")
        {
            foreach (var (key, value) in TestCertificates.ProductionSettings()) factory.HostSettings[key] = value;
        }
        return factory;
    }

    public static TheoryData<string, HttpStatusCode> Paths => new()
    {
        { "/", HttpStatusCode.OK },
        { "/index.html", HttpStatusCode.OK },
        { "/assets/app-1234.js", HttpStatusCode.OK },
        { "/api/health", HttpStatusCode.OK },
        { "/api/status", HttpStatusCode.Unauthorized },
        // No endpoint matches a missing file, so deny-by-default answers it like any unknown path.
        { "/assets/missing.js", HttpStatusCode.Unauthorized },
    };

    [Theory]
    [MemberData(nameof(Paths))]
    public async Task Every_response_carries_the_protective_headers(string path, HttpStatusCode status)
    {
        await using var factory = Factory();
        var response = await factory.CreateDefaultClient(AuthClient.BaseAddress).GetAsync(path);

        Assert.Equal(status, response.StatusCode);
        Assert.Equal("nosniff", Header(response, "X-Content-Type-Options"));
        Assert.Equal("no-referrer", Header(response, "Referrer-Policy"));
        Assert.Equal("DENY", Header(response, "X-Frame-Options"));
        Assert.Equal("same-origin", Header(response, "Cross-Origin-Opener-Policy"));
        Assert.Equal("same-origin", Header(response, "Cross-Origin-Resource-Policy"));
        Assert.Equal("camera=(self), microphone=(), geolocation=(), payment=()", Header(response, "Permissions-Policy"));
        Assert.NotNull(Header(response, "Content-Security-Policy"));
        Assert.Null(Header(response, "Server"));
        Assert.Null(Header(response, "X-Powered-By"));
        Assert.DoesNotContain(response.Headers.Concat(response.Content.Headers),
            h => h.Key.StartsWith("Access-Control-Allow", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("/", true)]
    [InlineData("/index.html", true)]
    [InlineData("/history", true)]
    [InlineData("/api/health", true)]
    [InlineData("/api/status", true)]
    [InlineData("/assets/app-1234.js", false)]
    public async Task The_app_page_and_api_are_never_cached_but_hashed_assets_are(string path, bool noStore)
    {
        await using var factory = Factory();
        var response = await factory.CreateDefaultClient(AuthClient.BaseAddress).GetAsync(path);

        var cacheControl = response.Headers.CacheControl?.ToString() ?? "";
        Assert.Equal(noStore, cacheControl.Contains("no-store"));
        if (!noStore) Assert.Contains("immutable", cacheControl);
    }

    [Fact]
    public async Task Outside_production_the_csp_allows_the_dev_server_and_does_not_upgrade_requests()
    {
        await using var factory = Factory();
        var csp = Header(await factory.CreateDefaultClient(AuthClient.BaseAddress).GetAsync("/"), "Content-Security-Policy")!;

        Assert.DoesNotContain("upgrade-insecure-requests", csp);
        Assert.Contains("connect-src 'self' ws://localhost:5173", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.DoesNotContain("unsafe-inline", csp);
    }

    [Fact]
    public async Task In_production_the_csp_is_exactly_the_contract()
    {
        await using var factory = Factory("Production");
        var client = factory.CreateDefaultClient(new Uri("https://localhost"));

        Assert.Equal(ProductionCsp, Header(await client.GetAsync("/"), "Content-Security-Policy"));
    }

    private static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) || response.Content.Headers.TryGetValues(name, out values)
            ? string.Join(", ", values)
            : null;
}
