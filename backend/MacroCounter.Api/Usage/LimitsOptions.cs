namespace MacroCounter.Api.Usage;

/// <summary>Bound from "Limits": AI cost protection (research R8, FR-021).</summary>
public sealed class LimitsOptions
{
    public const string Section = "Limits";

    public AiLimits Ai { get; set; } = new();

    public sealed class AiLimits
    {
        public int BurstPerMinute { get; set; } = 6;
        public int PerUserDaily { get; set; } = 30;
        public int GlobalDaily { get; set; } = 200;
        public int GlobalMonthly { get; set; } = 3000;

        /// <summary>The most one lookup can cost at list price (research R8); turns the counts into dollars.</summary>
        public decimal WorstCaseCostPerRequestUsd { get; set; } = 0.35m;
    }

    /// <summary>Every limit must be positive; a zero or negative one would silently disable a cap.</summary>
    public IEnumerable<string> Problems()
    {
        if (Ai.BurstPerMinute <= 0) yield return "Limits:Ai:BurstPerMinute must be greater than zero.";
        if (Ai.PerUserDaily <= 0) yield return "Limits:Ai:PerUserDaily must be greater than zero.";
        if (Ai.GlobalDaily <= 0) yield return "Limits:Ai:GlobalDaily must be greater than zero.";
        if (Ai.GlobalMonthly <= 0) yield return "Limits:Ai:GlobalMonthly must be greater than zero.";
        if (Ai.WorstCaseCostPerRequestUsd <= 0) yield return "Limits:Ai:WorstCaseCostPerRequestUsd must be greater than zero.";
    }
}
