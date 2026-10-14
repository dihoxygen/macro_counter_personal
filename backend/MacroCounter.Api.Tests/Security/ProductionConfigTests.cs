using System.Net;
using System.Text.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>FR-027, FR-030, FR-031: what changes in Production, and what stops it from starting misconfigured.</summary>
[Collection("Postgres")]
public class ProductionConfigTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private ApiFactory Production(Dictionary<string, string?>? overrides = null, FakeEstimator? estimator = null)
    {
        var factory = new ApiFactory(db, apiKey: "test-key-not-real", estimator) { EnvironmentName = "Production" };
        foreach (var (key, value) in TestCertificates.ProductionSettings()) factory.HostSettings[key] = value;
        factory.HostSettings["AllowedHosts"] = "app.example";
        factory.HostSettings["Security:AllowedOrigins:0"] = "https://app.example";
        foreach (var (key, value) in overrides ?? []) factory.HostSettings[key] = value;
        return factory;
    }

    [Fact]
    public async Task Https_responses_carry_hsts()
    {
        await using var factory = Production();
        var response = await factory.CreateDefaultClient(new Uri("https://app.example")).GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("max-age=31536000; includeSubDomains", string.Join(",", response.Headers.GetValues("Strict-Transport-Security")));
    }

    [Fact]
    public async Task Plain_http_is_redirected_to_https()
    {
        await using var factory = Production();
        var response = await factory.CreateDefaultClient(new Uri("http://app.example")).GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.PermanentRedirect, response.StatusCode);
        Assert.Equal("https://app.example/api/health", response.Headers.Location?.ToString());
    }

    [Fact]
    public async Task Another_host_name_is_refused()
    {
        await using var factory = Production();
        var response = await factory.CreateDefaultClient(new Uri("https://other.example")).GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unexpected_error_reveals_no_internals()
    {
        var estimator = FakeEstimator.Throwing(new InvalidOperationException(
            "Npgsql exploded at C:\\dev\\secret\\Internals.cs line 42 select * from macro.users"));
        await using var factory = Production(estimator: estimator);
        var client = await SignedInOverHttps(factory);

        var response = await client.PostAsync("/api/estimates/text", new { description = "banana" });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        foreach (var leak in new[] { "InvalidOperationException", "Npgsql", "C:\\", "Internals.cs", " at ", "select *", "stackTrace", "exception" })
        {
            Assert.DoesNotContain(leak, body, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(500, JsonDocument.Parse(body).RootElement.GetProperty("status").GetInt32());
    }

    [Theory]
    [InlineData("AllowedHosts", "*")]
    [InlineData("AllowedHosts", "")]
    [InlineData("Security:AllowedOrigins:0", "")]
    [InlineData("DataProtection:CertificatePfxBase64", "")]
    public async Task Startup_refuses_a_permissive_or_incomplete_configuration(string key, string value)
    {
        await using var factory = Production(new() { [key] = value });

        var error = Assert.ThrowsAny<Exception>(() => factory.Services);
        Assert.Contains(key.Split(':')[0], error.ToString());
    }

    [Fact]
    public async Task Startup_refuses_a_missing_identity_store_connection()
    {
        await using var factory = Production();
        factory.Settings["ConnectionStrings:Identity"] = "";

        var error = Assert.ThrowsAny<Exception>(() => factory.Services);
        Assert.Contains("ConnectionStrings:Identity", error.ToString());
    }

    /// <summary>A signed-in client over https://app.example (Production sessions need HTTPS and the real host).</summary>
    private async Task<AuthClient> SignedInOverHttps(ApiFactory factory)
    {
        var user = await TestUsers.ActivateDirectlyAsync(db, factory, "carol");
        var client = new AuthClient(factory, new Uri("https://app.example"));
        await client.SessionAsync();
        await client.SignInAsync("carol", user.Password, user.Code());
        return client;
    }
}
