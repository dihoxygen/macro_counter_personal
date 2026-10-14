using MacroCounter.Api.Ai;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Testing;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// The end-to-end test host can swap in a canned estimator and a fixed breached-password list, but only in
/// the "Testing" environment. In Development and Production those settings are ignored.
/// </summary>
[Collection("Postgres")]
public class TestingSwitchTests(PostgresFixture db)
{
    /// <summary>Unlike ApiFactory, this host does not replace the breach checker itself, so the switch is visible.</summary>
    private sealed class SwitchHost(PostgresFixture db, string environment) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(environment);
            builder.ConfigureAppConfiguration(config =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["Anthropic:ApiKey"] = "test-key-not-real",
                    ["ConnectionStrings:Identity"] = db.AppConnectionString,
                    ["Testing:FakeEstimator"] = "true",
                    ["Testing:BreachedPasswords:0"] = "password1234",
                };
                config.AddInMemoryCollection(settings);
            });
            if (environment == "Production")
            {
                // Host settings apply while Program builds services (the certificate is read then).
                foreach (var (key, value) in TestCertificates.ProductionSettings()) builder.UseSetting(key, value);
            }
        }
    }

    private static T Resolve<T>(WebApplicationFactory<Program> host) where T : notnull
    {
        using var scope = host.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<T>();
    }

    [Fact]
    public async Task In_testing_the_switches_replace_the_estimator_and_breach_checker()
    {
        await using var host = new SwitchHost(db, "Testing");

        Assert.IsType<TestingEstimator>(Resolve<IEstimator>(host));
        var checker = Assert.IsType<ListBreachedPasswordChecker>(Resolve<IBreachedPasswordChecker>(host));
        Assert.True(await checker.IsBreachedAsync("password1234", CancellationToken.None));
        Assert.False(await checker.IsBreachedAsync("something else entirely", CancellationToken.None));
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    public async Task Elsewhere_the_switches_are_ignored(string environment)
    {
        await using var host = new SwitchHost(db, environment);

        Assert.IsNotType<TestingEstimator>(Resolve<IEstimator>(host));
        Assert.IsType<HibpBreachedPasswordChecker>(Resolve<IBreachedPasswordChecker>(host));
    }
}
