using System.Globalization;

namespace MacroCounter.Api.Endpoints;

/// <summary>RFC 9457 problem responses carrying the contract's machine-readable <c>code</c>.</summary>
public static class Problems
{
    public const string SignInFailedDetail = "Could not sign in. Check your details and try again.";

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

    // ---- 003: auth & security (contracts/auth-api.yaml) ----

    public static IResult BodyTooLarge() =>
        Create(StatusCodes.Status413PayloadTooLarge, "invalid_request", "The request is too large.",
            "The request body is too large.");

    public static IResult Unauthenticated() =>
        Create(StatusCodes.Status401Unauthorized, "unauthenticated", "Sign-in required.", "Sign in to continue.");

    public static IResult CsrfFailed() =>
        Create(StatusCodes.Status403Forbidden, "csrf_failed", "The request was refused.",
            "Reload the page and try again.");

    /// <summary>Identical for every failure cause: unknown user, wrong password or code, disabled, expired (FR-006).</summary>
    public static IResult SignInFailed() =>
        Create(StatusCodes.Status401Unauthorized, "sign_in_failed", "Could not sign in.", SignInFailedDetail);

    /// <summary>Identical for every limiter (R7).</summary>
    public static IResult RateLimited(TimeSpan retryAfter) => WithRetryAfter(
        Create(StatusCodes.Status429TooManyRequests, "rate_limited", "Too many attempts.", "Too many attempts. Try again later."),
        retryAfter);

    public static IResult QuotaExceeded(string scope, DateTimeOffset resetAt, TimeSpan retryAfter) => WithRetryAfter(
        Create(StatusCodes.Status429TooManyRequests, "quota_exceeded", "AI lookup limit reached.",
            "The AI lookup limit has been reached. You can still add food manually.",
            new() { ["scope"] = scope, ["resetAt"] = resetAt.ToUniversalTime() }),
        retryAfter);

    public static IResult PasswordRejected(IReadOnlyList<string> reasons) =>
        Create(StatusCodes.Status400BadRequest, "password_rejected", "Choose a different password.",
            "That password can't be used.", new() { ["reasons"] = reasons });

    public static IResult BreachCheckUnavailable() =>
        Create(StatusCodes.Status503ServiceUnavailable, "breach_check_unavailable", "Password check unavailable.",
            "We couldn't check this password right now. Please try again in a minute.");

    /// <summary>A password change with a wrong current password or code; one message for both.</summary>
    public static IResult InvalidCredentials() =>
        Create(StatusCodes.Status400BadRequest, "invalid_credentials", "Check your current details.",
            "Your current password or authenticator code didn't match.");

    public static IResult InvalidCode(int attemptsLeft) =>
        Create(StatusCodes.Status400BadRequest, "invalid_code", "The code didn't match.",
            "Code didn't match.", new() { ["attemptsLeft"] = attemptsLeft });

    public static IResult WrongSetupStep(string expected) =>
        Create(StatusCodes.Status409Conflict, "wrong_setup_step", "Setup step out of order.",
            "Continue setup from the current step.", new() { ["setupStep"] = expected });

    public static IResult ServiceUnavailable() =>
        Create(StatusCodes.Status503ServiceUnavailable, "service_unavailable", "Temporarily unavailable.",
            "Sign-in is temporarily unavailable.");

    private static IResult Create(int status, string code, string title, string detail,
        Dictionary<string, object?>? extensions = null)
    {
        var all = new Dictionary<string, object?> { ["code"] = code };
        foreach (var (key, value) in extensions ?? [])
        {
            all[key] = value;
        }
        return Results.Problem(statusCode: status, title: title, detail: detail, extensions: all);
    }

    private static IResult WithRetryAfter(IResult inner, TimeSpan retryAfter) => new RetryAfterResult(inner, retryAfter);

    private sealed class RetryAfterResult(IResult inner, TimeSpan retryAfter) : IResult
    {
        public Task ExecuteAsync(HttpContext httpContext)
        {
            var seconds = Math.Max(1, (long)Math.Ceiling(retryAfter.TotalSeconds));
            httpContext.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
            return inner.ExecuteAsync(httpContext);
        }
    }
}
