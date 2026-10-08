using System.Text.Json.Serialization;

namespace MacroCounter.Api.Contracts;

// Public request/response shapes, matching contracts/estimates-api.yaml. Serialized as camelCase.

[JsonConverter(typeof(JsonStringEnumConverter<Unit>))]
public enum Unit
{
    [JsonStringEnumMemberName("g")] G,
    [JsonStringEnumMemberName("ml")] Ml,
    [JsonStringEnumMemberName("serving")] Serving,
}

[JsonConverter(typeof(JsonStringEnumConverter<Flag>))]
public enum Flag
{
    [JsonStringEnumMemberName("calorie_macro_mismatch")] CalorieMacroMismatch,
    [JsonStringEnumMemberName("large_portion")] LargePortion,
}

public sealed record Quantity(double Amount, Unit Unit);

public sealed record Macros(double Kcal, double ProteinG, double CarbsG, double FatG)
{
    public static readonly Macros Zero = new(0, 0, 0, 0);
}

public sealed record EstimateItem(
    string Name,
    Quantity Portion,
    string PortionDescription,
    Macros Macros,
    IReadOnlyList<Flag> Flags);

public sealed record Estimate(
    bool Recognized,
    IReadOnlyList<EstimateItem> Items,
    Macros Total,
    IReadOnlyList<Flag> Flags);

public sealed record TextEstimateRequest(string? Description);

public sealed record StatusResponse(bool AiAvailable);
