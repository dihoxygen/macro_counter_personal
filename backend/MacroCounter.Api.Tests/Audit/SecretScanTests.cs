using MacroCounter.Api.Ai;
using MacroCounter.Api.Tests.Ai;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Tests.Audit;

/// <summary>
/// FR-025 / SC-009: after the full scenario, neither the audit table nor anything logged contains a password,
/// code, setup key, cookie, CSRF token, food description, photo note or photo bytes.
/// </summary>
[Collection("Postgres")]
public class SecretScanTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task No_secret_or_food_text_reaches_the_audit_trail_or_the_logs()
    {
        var logs = new CapturingLoggerProvider();
        // The real Claude estimator over a fake sender, so its own logging is part of the scan.
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await using var factory = new ApiFactory(db, "test-key-not-real");
        AuditScenario.Configure(factory);
        factory.ServiceOverrides.Add(services =>
        {
            services.AddSingleton<ILoggerProvider>(logs);
            services.Replace(ServiceDescriptor.Singleton<IEstimator>(sp =>
                new ClaudeEstimator(sender, sp.GetRequiredService<IOptions<AnthropicOptions>>(),
                    logger: sp.GetRequiredService<ILogger<ClaudeEstimator>>())));
        });
        factory.Settings["Logging:LogLevel:Default"] = "Trace";

        var scenario = new AuditScenario(db, factory);
        await scenario.RunAsync();

        var audit = await AuditScenario.AuditDump(db);
        var logged = string.Join("\n", logs.Entries.Select(e => e.Text));
        Assert.NotEmpty(audit);
        Assert.NotEmpty(logged);
        foreach (var secret in scenario.Secrets.Where(s => s.Length >= 6).Distinct())
        {
            Assert.False(audit.Contains(secret, StringComparison.OrdinalIgnoreCase), $"audit trail contains \"{secret}\"");
            Assert.False(logged.Contains(secret, StringComparison.OrdinalIgnoreCase), $"logs contain \"{secret}\"");
        }
    }
}
