namespace MacroCounter.Api.Ai;

/// <summary>Bound from the "Anthropic" config section. The key comes from User Secrets or env only.</summary>
public sealed class AnthropicOptions
{
    public const string Section = "Anthropic";

    public string? ApiKey { get; set; }

    /// <summary>The one place the model ID is configured (Principle VI): appsettings.json.</summary>
    public string Model { get; set; } = "";

    public string Effort { get; set; } = "medium";

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);
}
