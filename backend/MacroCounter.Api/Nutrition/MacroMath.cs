using MacroCounter.Api.Contracts;

namespace MacroCounter.Api.Nutrition;

/// <summary>Pure nutrition math. No rounding; invalid input throws.</summary>
public static class MacroMath
{
    private const double MismatchFloorKcal = 20;
    private const double MismatchPercent = 15;

    /// <summary>Atwater 4/4/9: kcal from protein, carbohydrate and fat grams.</summary>
    public static double CaloriesFromMacros(double proteinG, double carbsG, double fatG)
    {
        Require(proteinG, nameof(proteinG));
        Require(carbsG, nameof(carbsG));
        Require(fatG, nameof(fatG));
        return 4 * proteinG + 4 * carbsG + 9 * fatG;
    }

    public static Macros Sum(IEnumerable<Macros> items)
    {
        double kcal = 0, protein = 0, carbs = 0, fat = 0;
        foreach (var m in items)
        {
            Require(m.Kcal, nameof(m.Kcal));
            Require(m.ProteinG, nameof(m.ProteinG));
            Require(m.CarbsG, nameof(m.CarbsG));
            Require(m.FatG, nameof(m.FatG));
            kcal += m.Kcal;
            protein += m.ProteinG;
            carbs += m.CarbsG;
            fat += m.FatG;
        }
        return new Macros(kcal, protein, carbs, fat);
    }

    /// <summary>
    /// True when |kcal − (4P + 4C + 9F)| exceeds max(20 kcal, 15% of 4P + 4C + 9F) (research R5).
    /// </summary>
    public static bool IsCalorieMismatch(double kcal, double proteinG, double carbsG, double fatG)
    {
        Require(kcal, nameof(kcal));
        var expected = CaloriesFromMacros(proteinG, carbsG, fatG);
        // Multiply before dividing so 15% of round numbers stays exact (170 → 25.5).
        var tolerance = Math.Max(MismatchFloorKcal, expected * MismatchPercent / 100);
        return Math.Abs(kcal - expected) > tolerance;
    }

    private static void Require(double value, string name)
    {
        if (!double.IsFinite(value) || value < 0)
        {
            throw new ArgumentOutOfRangeException(name, value, "must be a finite number ≥ 0");
        }
    }
}
