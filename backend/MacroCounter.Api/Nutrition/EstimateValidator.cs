using MacroCounter.Api.Ai;
using MacroCounter.Api.Contracts;

namespace MacroCounter.Api.Nutrition;

public abstract record ValidationResult
{
    public sealed record Valid(Estimate Estimate) : ValidationResult;

    public sealed record Invalid(string Reason) : ValidationResult;
}

/// <summary>
/// Turns Claude's raw output into a public <see cref="Estimate"/>, applying research R5:
/// hard checks reject the whole response; consistency checks add flags the user must accept.
/// </summary>
public static class EstimateValidator
{
    private const double MaxKcal = 5000;
    private const double MaxMacroG = 1000;
    private const double MaxPortion = 2000;

    public static ValidationResult Validate(AiEstimateDto dto)
    {
        if (dto.Recognized is not { } recognized) return Reject("recognized is missing");
        if (dto.Items is not { } rawItems) return Reject("items is missing");
        if (recognized && rawItems.Count == 0) return Reject("recognized food but no items");
        if (!recognized && rawItems.Count > 0) return Reject("unrecognized food but items present");

        var items = new List<EstimateItem>(rawItems.Count);
        foreach (var raw in rawItems)
        {
            var error = TryMapItem(raw, out var item);
            if (error is not null) return Reject(error);
            items.Add(item!);
        }

        var flags = items.SelectMany(i => i.Flags).Distinct().Order().ToList();
        var total = MacroMath.Sum(items.Select(i => i.Macros));
        return new ValidationResult.Valid(new Estimate(recognized, items, total, flags));
    }

    private static string? TryMapItem(AiEstimateItemDto? raw, out EstimateItem? item)
    {
        item = null;
        if (raw is null) return "item is missing";
        if (string.IsNullOrWhiteSpace(raw.Name)) return "item name is empty";
        if (raw.PortionDescription is null) return $"{raw.Name}: portion description is missing";
        if (ParseUnit(raw.PortionUnit) is not { } unit) return $"{raw.Name}: unknown unit '{raw.PortionUnit}'";

        if (!IsValidNumber(raw.PortionAmount, out var amount)
            || !IsValidNumber(raw.Kcal, out var kcal)
            || !IsValidNumber(raw.ProteinG, out var protein)
            || !IsValidNumber(raw.CarbsG, out var carbs)
            || !IsValidNumber(raw.FatG, out var fat))
        {
            return $"{raw.Name}: a number is missing, negative or not finite";
        }

        if (kcal > MaxKcal) return $"{raw.Name}: kcal above {MaxKcal}";
        if (protein > MaxMacroG || carbs > MaxMacroG || fat > MaxMacroG) return $"{raw.Name}: a macro is above {MaxMacroG} g";

        var flags = new List<Flag>();
        if (MacroMath.IsCalorieMismatch(kcal, protein, carbs, fat)) flags.Add(Flag.CalorieMacroMismatch);
        if (unit != Unit.Serving && amount > MaxPortion) flags.Add(Flag.LargePortion);

        item = new EstimateItem(
            raw.Name.Trim(),
            new Quantity(amount, unit),
            raw.PortionDescription,
            new Macros(kcal, protein, carbs, fat),
            flags);
        return null;
    }

    private static bool IsValidNumber(double? value, out double result)
    {
        result = value.GetValueOrDefault();
        return value is { } v && double.IsFinite(v) && v >= 0;
    }

    private static Unit? ParseUnit(string? raw) => raw switch
    {
        "g" => Unit.G,
        "ml" => Unit.Ml,
        "serving" => Unit.Serving,
        _ => null,
    };

    private static ValidationResult.Invalid Reject(string reason) => new(reason);
}
