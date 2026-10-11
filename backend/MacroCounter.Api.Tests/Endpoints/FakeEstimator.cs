using MacroCounter.Api.Ai;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>Mocked IEstimator for endpoint tests. Claude is never called.</summary>
public sealed class FakeEstimator(Func<CancellationToken, Task<AiEstimateDto>> respond) : IEstimator
{
    public string? LastDescription { get; private set; }
    public byte[]? LastPhoto { get; private set; }
    public string? LastNote { get; private set; }
    public CancellationToken LastToken { get; private set; }
    public int Calls { get; private set; }

    public Task<AiEstimateDto> EstimateFromTextAsync(string description, CancellationToken cancellationToken)
    {
        Calls++;
        LastDescription = description;
        LastToken = cancellationToken;
        return respond(cancellationToken);
    }

    public Task<AiEstimateDto> EstimateFromPhotoAsync(byte[] jpeg, string? note, CancellationToken cancellationToken)
    {
        Calls++;
        LastPhoto = jpeg;
        LastNote = note;
        LastToken = cancellationToken;
        return respond(cancellationToken);
    }

    public static readonly AiEstimateDto Banana = new(true,
        [new AiEstimateItemDto("Banana", 118, "g", "1 medium banana (~118 g)", 105, 1.3, 27, 0.4)]);

    public static FakeEstimator Returning(AiEstimateDto dto) => new(_ => Task.FromResult(dto));

    public static FakeEstimator Throwing(Exception ex) => new(_ => Task.FromException<AiEstimateDto>(ex));
}
