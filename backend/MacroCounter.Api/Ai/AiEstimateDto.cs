using System.Text.Json.Serialization;

namespace MacroCounter.Api.Ai;

// Raw structured output from Claude, shaped like contracts/ai-estimate.schema.json.
// Everything is nullable so the validator, not the deserializer, decides what is missing.

public sealed record AiEstimateDto(
    [property: JsonPropertyName("recognized")] bool? Recognized,
    [property: JsonPropertyName("items")] IReadOnlyList<AiEstimateItemDto>? Items);

public sealed record AiEstimateItemDto(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("portion_amount")] double? PortionAmount,
    [property: JsonPropertyName("portion_unit")] string? PortionUnit,
    [property: JsonPropertyName("portion_description")] string? PortionDescription,
    [property: JsonPropertyName("kcal")] double? Kcal,
    [property: JsonPropertyName("protein_g")] double? ProteinG,
    [property: JsonPropertyName("carbs_g")] double? CarbsG,
    [property: JsonPropertyName("fat_g")] double? FatG);
