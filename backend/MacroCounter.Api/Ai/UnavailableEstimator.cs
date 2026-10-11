namespace MacroCounter.Api.Ai;

/// <summary>Registered when no API key is configured; every call reports AI as unavailable.</summary>
public sealed class UnavailableEstimator : IEstimator
{
    private const string Message = "AI lookup is not configured (no Anthropic:ApiKey).";

    public Task<AiEstimateDto> EstimateFromTextAsync(string description, CancellationToken cancellationToken) =>
        throw new AiUnavailableException(Message);

    public Task<AiEstimateDto> EstimateFromPhotoAsync(byte[] jpeg, string? note, CancellationToken cancellationToken) =>
        throw new AiUnavailableException(Message);
}
