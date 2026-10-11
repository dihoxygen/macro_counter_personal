using MacroCounter.Api.Contracts;
using MacroCounter.Api.Nutrition;

namespace MacroCounter.Api.Tests.Nutrition;

public class MacroMathTests
{
    [Theory]
    [InlineData(0, 0, 0, 0)]
    [InlineData(10, 0, 0, 40)]
    [InlineData(0, 10, 0, 40)]
    [InlineData(0, 0, 10, 90)]
    // Large egg (USDA): 6.3 g protein, 0.4 g carbs, 4.8 g fat → 25.2 + 1.6 + 43.2 = 70.0
    [InlineData(6.3, 0.4, 4.8, 70.0)]
    public void CaloriesFromMacros_uses_4_4_9(double p, double c, double f, double expected)
    {
        Assert.Equal(expected, MacroMath.CaloriesFromMacros(p, c, f), 10);
    }

    [Fact]
    public void Sum_returns_the_field_wise_sum()
    {
        var egg = new Macros(78, 6.3, 0.6, 5.3);
        var toast = new Macros(69, 3.6, 12, 0.9);
        var butter = new Macros(36, 0.04, 0, 4.1);

        var total = MacroMath.Sum([egg, toast, butter]);

        Assert.Equal(183, total.Kcal, 10);
        Assert.Equal(9.94, total.ProteinG, 10);
        Assert.Equal(12.6, total.CarbsG, 10);
        Assert.Equal(10.3, total.FatG, 10);
    }

    [Fact]
    public void Sum_of_nothing_is_zero()
    {
        Assert.Equal(Macros.Zero, MacroMath.Sum([]));
    }

    [Fact]
    public void Sum_of_large_values_is_exact()
    {
        var big = new Macros(5000, 1000, 1000, 1000);
        Assert.Equal(new Macros(150000, 30000, 30000, 30000), MacroMath.Sum(Enumerable.Repeat(big, 30)));
    }

    [Fact]
    public void CaloriesFromMacros_of_large_values_is_exact()
    {
        Assert.Equal(17000, MacroMath.CaloriesFromMacros(1000, 1000, 1000));
    }

    // Expected = 4*10 + 4*10 + 9*10 = 170. Tolerance = max(20, 0.15 * 170 = 25.5) = 25.5.
    [Theory]
    [InlineData(170, false)]
    [InlineData(195.5, false)] // exactly at the threshold, above
    [InlineData(144.5, false)] // exactly at the threshold, below
    [InlineData(195.6, true)]  // just above, high side
    [InlineData(144.4, true)]  // just above, low side
    public void IsCalorieMismatch_uses_the_15_percent_tolerance(double kcal, bool expected)
    {
        Assert.Equal(expected, MacroMath.IsCalorieMismatch(kcal, 10, 10, 10));
    }

    // Expected = 4*5 = 20. Tolerance = max(20, 3) = 20 kcal floor.
    [Theory]
    [InlineData(40, false)]
    [InlineData(0, false)]
    [InlineData(40.1, true)]
    public void IsCalorieMismatch_uses_the_20_kcal_floor_for_small_foods(double kcal, bool expected)
    {
        Assert.Equal(expected, MacroMath.IsCalorieMismatch(kcal, 5, 0, 0));
    }

    [Fact]
    public void IsCalorieMismatch_is_false_for_all_zeros()
    {
        Assert.False(MacroMath.IsCalorieMismatch(0, 0, 0, 0));
    }

    public static TheoryData<double> InvalidNumbers => new() { -1, double.NaN, double.PositiveInfinity, double.NegativeInfinity };

    [Theory]
    [MemberData(nameof(InvalidNumbers))]
    public void CaloriesFromMacros_rejects_invalid_arguments(double bad)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.CaloriesFromMacros(bad, 1, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.CaloriesFromMacros(1, bad, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.CaloriesFromMacros(1, 1, bad));
    }

    [Theory]
    [MemberData(nameof(InvalidNumbers))]
    public void IsCalorieMismatch_rejects_invalid_arguments(double bad)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.IsCalorieMismatch(bad, 1, 1, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.IsCalorieMismatch(10, bad, 1, 1));
    }

    [Theory]
    [MemberData(nameof(InvalidNumbers))]
    public void Sum_rejects_invalid_values(double bad)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.Sum([new Macros(bad, 0, 0, 0)]));
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.Sum([new Macros(0, bad, 0, 0)]));
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.Sum([new Macros(0, 0, bad, 0)]));
        Assert.Throws<ArgumentOutOfRangeException>(() => MacroMath.Sum([new Macros(0, 0, 0, bad)]));
    }
}
