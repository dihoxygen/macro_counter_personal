using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using MacroCounter.Api.Usage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Tests.Usage;

/// <summary>R8: what the request-count limits mean in dollars, stated at startup so the owner sees the cap.</summary>
[Collection("Postgres")]
public class SpendCapTests(PostgresFixture db)
{
    [Fact]
    public void The_worst_case_cost_defaults_to_35_cents_and_the_caps_follow_from_the_limits()
    {
        var limits = new LimitsOptions();

        Assert.Equal(0.35m, limits.Ai.WorstCaseCostPerRequestUsd);
        Assert.Equal(1050m, SpendCap.MonthlyWorstCaseUsd(limits));
        Assert.Equal(70m, SpendCap.DailyWorstCaseUsd(limits));
    }

    [Fact]
    public async Task Startup_logs_both_caps_and_the_model_but_never_the_key()
    {
        var logs = new CapturingLoggerProvider();
        await using var factory = new ApiFactory(db, apiKey: "sk-ant-test-key-that-must-not-be-logged");
        factory.ServiceOverrides.Add(services => services.AddSingleton<ILoggerProvider>(logs));
        _ = factory.Services; // start the host

        var line = Assert.Single(logs.Entries, e => e.Text.Contains("worst-case AI spend", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("$70.00 per day", line.Text);
        Assert.Contains("$1,050.00 per month", line.Text);
        Assert.Contains("claude-opus-5-5", line.Text);
        Assert.DoesNotContain(logs.Entries, e => e.Text.Contains("sk-ant-test-key"));
    }

    [Theory]
    [InlineData("Limits:Ai:PerUserDaily", "0")]
    [InlineData("Limits:Ai:GlobalDaily", "-1")]
    [InlineData("Limits:Ai:GlobalMonthly", "0")]
    [InlineData("Limits:Ai:BurstPerMinute", "0")]
    [InlineData("Limits:Ai:WorstCaseCostPerRequestUsd", "0")]
    public async Task Startup_fails_on_a_limit_that_is_not_positive(string key, string value)
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        factory.Settings[key] = value;

        var error = Assert.ThrowsAny<Exception>(() => factory.Services.GetRequiredService<IOptions<LimitsOptions>>().Value);
        Assert.Contains("must be greater than zero", error.ToString());
    }
}
