using System.Text.Json;

namespace MacroCounter.Api.Ai;

/// <summary>
/// The system prompt and structured-output schema. Both are constant so the prompt prefix stays
/// byte-identical between requests (research R4).
/// </summary>
public static class EstimatePrompt
{
    public const string SystemPrompt =
        """
        You estimate the nutrition of food for a personal macro-tracking app. The user describes what
        they ate, or sends a photo of it (sometimes with a short note such as how it was cooked).

        Rules:
        - List each distinct food or drink as its own item, with its own calories (kcal), protein,
          carbohydrates and fat in grams.
        - Every item needs a concrete portion: portion_amount with portion_unit "g", "ml" or "serving".
          Prefer g or ml. In portion_description, state the portion you assumed in plain words with the
          gram or ml amount, for example "1 cup cooked (~140 g)", so the user can correct it.
        - When the portion is vague ("some pasta"), assume a typical single serving and say so in
          portion_description.
        - Use standard reference values (USDA-style) where they are known. Keep calories consistent with
          4 kcal per gram of protein and carbohydrate and 9 kcal per gram of fat, except where fiber or
          alcohol makes that inexact.
        - Account for cooking fats, sauces and drinks that are mentioned or clearly visible.
        - If no food or drink can be identified, return recognized false with an empty items list.
          Do not guess.
        - Respond only with the JSON object described by the schema.
        """;

    /// <summary>The JSON schema from contracts/ai-estimate.schema.json, embedded in the assembly.</summary>
    public static IReadOnlyDictionary<string, JsonElement> Schema { get; } = LoadSchema();

    private static Dictionary<string, JsonElement> LoadSchema()
    {
        using var stream = typeof(EstimatePrompt).Assembly
            .GetManifestResourceStream("MacroCounter.Api.Ai.ai-estimate.schema.json")
            ?? throw new InvalidOperationException("Embedded resource ai-estimate.schema.json is missing.");
        var schema = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(stream)!;
        // "$comment" documents the file for humans; it is not part of the schema sent to the API.
        schema.Remove("$comment");
        return schema;
    }
}
