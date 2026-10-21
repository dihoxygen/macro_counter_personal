namespace MacroCounter.Api.Security;

/// <summary>
/// Logs every refused /api request: no session, CSRF or Origin refusal, an invalid body, a rate limit
/// (ASVS 7.1.3, 7.2.2, 14.5.1). Only the method, path, status and address; never the query, body or cookies.
/// These go to the app log, not the audit table, which would fill up with anonymous noise.
/// </summary>
public sealed partial class RefusedRequestLogging(RequestDelegate next, ILogger<RefusedRequestLogging> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        await next(context);

        var status = context.Response.StatusCode;
        if (status is >= 400 and < 500 && context.Request.Path.StartsWithSegments("/api"))
        {
            LogRefused(logger, context.Request.Method, context.Request.Path.Value, status, context.Connection.RemoteIpAddress?.ToString());
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Refused {Method} {Path}: {Status} from {RemoteIp}")]
    private static partial void LogRefused(ILogger logger, string method, string? path, int status, string? remoteIp);
}
