using MacroCounter.Api.Ai;
using MacroCounter.Api.Contracts;
using MacroCounter.Api.Nutrition;

namespace MacroCounter.Api.Tests.Nutrition;

public class EstimateValidatorTests
{
    // A banana whose calories match 4/4/9 closely: 4*1.3 + 4*27 + 9*0.4 = 116.8 vs 105 (within 20 kcal).
    private static AiEstimateItemDto Banana(
        string? name = "Banana",
        double? amount = 118,
        string? unit = "g",
        string? description = "1 medium banana (~118 g)",
        double? kcal = 105,
        double? protein = 1.3,
        double? carbs = 27,
        double? fat = 0.4) =>
        new(name, amount, unit, description, kcal, protein, carbs, fat);

    private static Estimate AssertValid(ValidationResult result) =>
        Assert.IsType<ValidationResult.Valid>(result).Estimate;

    private static void AssertInvalid(AiEstimateDto dto) =>
        Assert.IsType<ValidationResult.Invalid>(EstimateValidator.Validate(dto));

    [Fact]
    public void Unrecognized_with_no_items_is_valid_and_empty()
    {
        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(false, [])));

        Assert.False(estimate.Recognized);
        Assert.Empty(estimate.Items);
        Assert.Equal(Macros.Zero, estimate.Total);
        Assert.Empty(estimate.Flags);
    }

    [Fact]
    public void Valid_item_maps_to_the_public_contract()
    {
        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [Banana()])));

        var item = Assert.Single(estimate.Items);
        Assert.True(estimate.Recognized);
        Assert.Equal("Banana", item.Name);
        Assert.Equal(new Quantity(118, Unit.G), item.Portion);
        Assert.Equal("1 medium banana (~118 g)", item.PortionDescription);
        Assert.Equal(new Macros(105, 1.3, 27, 0.4), item.Macros);
        Assert.Empty(item.Flags);
    }

    [Theory]
    [InlineData("g", Unit.G)]
    [InlineData("ml", Unit.Ml)]
    [InlineData("serving", Unit.Serving)]
    public void Units_are_mapped(string raw, Unit expected)
    {
        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [Banana(unit: raw)])));
        Assert.Equal(expected, estimate.Items[0].Portion.Unit);
    }

    [Fact]
    public void Total_is_recomputed_from_the_items()
    {
        var egg = Banana(name: "Egg", kcal: 78, protein: 6.3, carbs: 0.6, fat: 5.3);
        var toast = Banana(name: "Toast", kcal: 69, protein: 3.6, carbs: 12, fat: 0.9);

        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [egg, toast])));

        Assert.Equal(147, estimate.Total.Kcal, 10);
        Assert.Equal(9.9, estimate.Total.ProteinG, 10);
        Assert.Equal(12.6, estimate.Total.CarbsG, 10);
        Assert.Equal(6.2, estimate.Total.FatG, 10);
    }

    [Fact]
    public void Flags_are_the_distinct_union_of_item_flags()
    {
        // Both mismatched (kcal far from 4/4/9) and one also a large portion.
        var a = Banana(name: "A", kcal: 500);
        var b = Banana(name: "B", kcal: 500, amount: 2500);

        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [a, b])));

        Assert.Equal([Flag.CalorieMacroMismatch], estimate.Items[0].Flags);
        Assert.Equal([Flag.CalorieMacroMismatch, Flag.LargePortion], estimate.Items[1].Flags);
        Assert.Equal([Flag.CalorieMacroMismatch, Flag.LargePortion], estimate.Flags);
    }

    [Fact]
    public void Calorie_mismatch_adds_a_flag()
    {
        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [Banana(kcal: 300)])));
        Assert.Equal([Flag.CalorieMacroMismatch], estimate.Items[0].Flags);
    }

    [Theory]
    [InlineData("g", 2000, false)]
    [InlineData("g", 2000.1, true)]
    [InlineData("ml", 2000.1, true)]
    [InlineData("serving", 2500, false)]
    public void Large_g_or_ml_portion_adds_a_flag(string unit, double amount, bool flagged)
    {
        var estimate = AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [Banana(unit: unit, amount: amount)])));
        Assert.Equal(flagged, estimate.Items[0].Flags.Contains(Flag.LargePortion));
    }

    [Fact]
    public void Recognized_with_no_items_is_invalid() => AssertInvalid(new AiEstimateDto(true, []));

    [Fact]
    public void Unrecognized_with_items_is_invalid() => AssertInvalid(new AiEstimateDto(false, [Banana()]));

    [Fact]
    public void Missing_recognized_is_invalid() => AssertInvalid(new AiEstimateDto(null, []));

    [Fact]
    public void Missing_items_is_invalid() => AssertInvalid(new AiEstimateDto(true, null));

    [Fact]
    public void Null_item_is_invalid() => AssertInvalid(new AiEstimateDto(true, [null!]));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_name_is_invalid(string? name) => AssertInvalid(new AiEstimateDto(true, [Banana(name: name)]));

    [Fact]
    public void Missing_portion_description_is_invalid() =>
        AssertInvalid(new AiEstimateDto(true, [Banana(description: null)]));

    [Theory]
    [InlineData(null)]
    [InlineData("kg")]
    [InlineData("G")]
    public void Unknown_unit_is_invalid(string? unit) => AssertInvalid(new AiEstimateDto(true, [Banana(unit: unit)]));

    public static TheoryData<double?> BadNumbers => new() { null, -0.1, double.NaN, double.PositiveInfinity, double.NegativeInfinity };

    [Theory]
    [MemberData(nameof(BadNumbers))]
    public void Missing_negative_or_non_finite_numbers_are_invalid(double? bad)
    {
        AssertInvalid(new AiEstimateDto(true, [Banana(amount: bad)]));
        AssertInvalid(new AiEstimateDto(true, [Banana(kcal: bad)]));
        AssertInvalid(new AiEstimateDto(true, [Banana(protein: bad)]));
        AssertInvalid(new AiEstimateDto(true, [Banana(carbs: bad)]));
        AssertInvalid(new AiEstimateDto(true, [Banana(fat: bad)]));
    }

    [Fact]
    public void Kcal_over_5000_is_invalid()
    {
        AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [Banana(kcal: 5000, protein: 0, carbs: 0, fat: 555.5)])));
        AssertInvalid(new AiEstimateDto(true, [Banana(kcal: 5000.1)]));
    }

    [Fact]
    public void Any_macro_over_1000_g_is_invalid()
    {
        AssertValid(EstimateValidator.Validate(new AiEstimateDto(true, [Banana(kcal: 4000, protein: 1000, carbs: 0, fat: 0)])));
        AssertInvalid(new AiEstimateDto(true, [Banana(protein: 1000.1)]));
        AssertInvalid(new AiEstimateDto(true, [Banana(carbs: 1000.1)]));
        AssertInvalid(new AiEstimateDto(true, [Banana(fat: 1000.1)]));
    }

    [Fact]
    public void One_bad_item_rejects_the_whole_estimate()
    {
        AssertInvalid(new AiEstimateDto(true, [Banana(), Banana(kcal: -1)]));
    }

    [Fact]
    public void Invalid_result_carries_a_reason()
    {
        var invalid = Assert.IsType<ValidationResult.Invalid>(EstimateValidator.Validate(new AiEstimateDto(true, [])));
        Assert.False(string.IsNullOrWhiteSpace(invalid.Reason));
    }
}
