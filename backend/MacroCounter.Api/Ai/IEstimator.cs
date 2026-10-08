namespace MacroCounter.Api.Ai;

/// <summary>Seam over Claude so endpoints can be tested with a mock.</summary>
public interface IEstimator
{
    Task<AiEstimateDto> EstimateFromTextAsync(string description, CancellationToken cancellationToken);

    Task<AiEstimateDto> EstimateFromPhotoAsync(byte[] jpeg, string? note, CancellationToken cancellationToken);
}
