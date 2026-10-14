using System.Globalization;
using MacroCounter.Api.Ai;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Usage;

/// <summary>
/// What the AI request ceilings mean in dollars at worst (research R8). Logged at startup so the owner can see
/// the cap that the configuration actually enforces.
/// </summary>
public static partial class SpendCap
{
    public static decimal DailyWorstCaseUsd(LimitsOptions limits) => limits.Ai.GlobalDaily * limits.Ai.WorstCaseCostPerRequestUsd;

    public static decimal MonthlyWorstCaseUsd(LimitsOptions limits) => limits.Ai.GlobalMonthly * limits.Ai.WorstCaseCostPerRequestUsd;

    public static void LogAtStartup(IServiceProvider services)
    {
        var limits = services.GetRequiredService<IOptions<LimitsOptions>>().Value;
        var model = services.GetRequiredService<IOptions<AnthropicOptions>>().Value.Model;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("MacroCounter.SpendCap");
        var usd = CultureInfo.GetCultureInfo("en-US");
        LogCaps(logger, DailyWorstCaseUsd(limits).ToString("C2", usd), MonthlyWorstCaseUsd(limits).ToString("C2", usd), model);
    }

    /// <summary>Refuses to start with a limit that is zero or negative (it would silently disable a cap).</summary>
    public static void AddLimitsValidation(this IServiceCollection services)
    {
        services.AddSingleton<IValidateOptions<LimitsOptions>, LimitsValidator>();
        services.AddOptions<LimitsOptions>().ValidateOnStart();
    }

    private sealed class LimitsValidator : IValidateOptions<LimitsOptions>
    {
        public ValidateOptionsResult Validate(string? name, LimitsOptions options)
        {
            var problems = options.Problems().ToList();
            return problems.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(problems);
        }
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Worst-case AI spend with the current limits: {Daily} per day, {Monthly} per month (model {Model}).")]
    private static partial void LogCaps(ILogger logger, string daily, string monthly, string model);
}
