using MacroCounter.Api.Ai;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>
/// Test host. Uses the "Testing" environment so User Secrets (the real key) are never loaded,
/// and overrides Anthropic:ApiKey with an in-memory value. Claude is never called.
/// </summary>
public sealed class ApiFactory(string? apiKey, IEstimator? estimator = null) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(config =>
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["Anthropic:ApiKey"] = apiKey ?? "" }));
        if (estimator is not null)
        {
            builder.ConfigureServices(services => services.Replace(ServiceDescriptor.Singleton(estimator)));
        }
    }
}
