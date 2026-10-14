using MacroCounter.Api.Ai;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>
/// Test host. Uses the "Testing" environment so User Secrets (the real key) are never loaded,
/// overrides Anthropic:ApiKey with an in-memory value, and points the identity store at the
/// throwaway test database as the least-privilege app role. Claude is never called.
/// </summary>
public sealed class ApiFactory(PostgresFixture db, string? apiKey, IEstimator? estimator = null)
    : WebApplicationFactory<Program>
{
    /// <summary>
    /// Shared clock for session expiry, lockout windows and quota days. It starts at the real time (whole
    /// seconds) because cookie expiry is also judged by the test client's real clock.
    /// </summary>
    public FakeTimeProvider Clock { get; } = new(DateTimeOffset.FromUnixTimeSeconds(DateTimeOffset.UtcNow.ToUnixTimeSeconds()));

    /// <summary>Replaces Have I Been Pwned; configure breached passwords or an outage per test.</summary>
    public FakeBreachedPasswordChecker Breach { get; } = new();

    /// <summary>Optional web root (static files), for tests of the app shell.</summary>
    public string? WebRoot { get; set; }

    /// <summary>Hosting environment; "Testing" unless a test checks another environment's behavior.</summary>
    public string EnvironmentName { get; set; } = "Testing";

    /// <summary>Extra service replacements a test needs (applied last).</summary>
    public List<Action<IServiceCollection>> ServiceOverrides { get; } = [];

    /// <summary>
    /// Host settings, applied while Program builds its services: for values read at that point (the Production
    /// Data Protection certificate) or startup checks. Ordinary settings go in <see cref="Settings"/>.
    /// </summary>
    public Dictionary<string, string?> HostSettings { get; } = new();

    /// <summary>Extra configuration a test needs (e.g. smaller limits).</summary>
    public Dictionary<string, string?> Settings { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(EnvironmentName);
        if (WebRoot is not null) builder.UseWebRoot(WebRoot);
        foreach (var (key, value) in HostSettings) builder.UseSetting(key, value);
        builder.ConfigureAppConfiguration(config =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Anthropic:ApiKey"] = apiKey ?? "",
                ["ConnectionStrings:Identity"] = db.AppConnectionString,
            });
            config.AddInMemoryCollection(Settings);
        });
        builder.ConfigureServices(services =>
        {
            services.Replace(ServiceDescriptor.Singleton<TimeProvider>(Clock));
            services.Replace(ServiceDescriptor.Singleton<IBreachedPasswordChecker>(Breach));
            if (estimator is not null)
            {
                services.Replace(ServiceDescriptor.Singleton(estimator));
            }
            foreach (var replace in ServiceOverrides)
            {
                replace(services);
            }
        });
    }

    /// <summary>
    /// A browser-like client signed in as a fresh, fully set-up user, with the CSRF header preset so plain
    /// HttpClient calls behave like the app's own requests.
    /// </summary>
    public async Task<HttpClient> SignedInClientAsync()
    {
        var user = await TestUsers.ActivateDirectlyAsync(db, this, "u" + Guid.NewGuid().ToString("N")[..12]);
        var client = new AuthClient(this);
        await client.SessionAsync();
        await client.SignInAsync(user.Username, user.Password, user.Code());
        client.Http.DefaultRequestHeaders.Add("X-CSRF-Token", client.Csrf);
        return client.Http;
    }
}
