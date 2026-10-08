namespace MacroCounter.Api.Endpoints;

/// <summary>RFC 9457 problem responses carrying the contract's machine-readable <c>code</c>.</summary>
public static class Problems
{
    public static IResult InvalidRequest(string detail) =>
        Create(StatusCodes.Status400BadRequest, "invalid_request", "The request is invalid.", detail);

    public static IResult ImageTooLarge(string detail) =>
        Create(StatusCodes.Status413PayloadTooLarge, "image_too_large", "The image is too large.", detail);

    public static IResult UnsupportedMediaType(string detail) =>
        Create(StatusCodes.Status415UnsupportedMediaType, "unsupported_media_type", "The image type is not supported.", detail);

    public static IResult InvalidAiResponse(string detail) =>
        Create(StatusCodes.Status502BadGateway, "invalid_ai_response", "The AI could not produce a usable estimate.", detail);

    public static IResult AiUnavailable(string detail) =>
        Create(StatusCodes.Status503ServiceUnavailable, "ai_unavailable", "AI lookup is unavailable.", detail);

    public static IResult AiTimeout(string detail) =>
        Create(StatusCodes.Status504GatewayTimeout, "ai_timeout", "The AI took too long to answer.", detail);

    private static IResult Create(int status, string code, string title, string detail) =>
        Results.Problem(
            statusCode: status,
            title: title,
            detail: detail,
            extensions: new Dictionary<string, object?> { ["code"] = code });
}
