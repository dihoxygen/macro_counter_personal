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
    }
}
