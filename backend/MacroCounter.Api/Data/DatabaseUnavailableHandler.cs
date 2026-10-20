using MacroCounter.Api.Endpoints;
using Microsoft.AspNetCore.Diagnostics;
using Npgsql;

namespace MacroCounter.Api.Data;

/// <summary>
/// An unreachable identity database is an outage, not a bug: <c>/api</c> answers 503 service_unavailable
/// (auth-api.yaml), so the client says "temporarily unavailable" and keeps offline grace (R9) instead of
/// showing a generic sign-in failure. Every other error stays the generic 500 (FR-031).
/// </summary>
public sealed partial class DatabaseUnavailableHandler(ILogger<DatabaseUnavailableHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (!httpContext.Request.Path.StartsWithSegments("/api") || !IsOutage(exception)) return false;

        LogUnavailable(logger, exception);
        await Problems.ServiceUnavailable().ExecuteAsync(httpContext);
        return true;
    }

    /// <summary>A transient Npgsql error (refused, reset, timed out, server shutting down), possibly wrapped by EF Core.</summary>
    private static bool IsOutage(Exception exception)
    {
        for (var e = exception; e is not null; e = e.InnerException)
        {
            if (e is NpgsqlException { IsTransient: true }) return true;
        }
        return false;
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "The identity database is unreachable; answered 503.")]
    private static partial void LogUnavailable(ILogger logger, Exception exception);
}
