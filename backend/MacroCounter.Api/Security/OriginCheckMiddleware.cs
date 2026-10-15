using MacroCounter.Api.Endpoints;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Security;

/// <summary>
/// Refuses unsafe /api requests sent by a browser from another site (FR-029, research R10), on top of
/// SameSite cookies and the CSRF token. Requests without Origin or Sec-Fetch-Site (non-browser clients) go on
/// to the CSRF check, which still requires the token.
/// </summary>
public sealed class OriginCheckMiddleware(RequestDelegate next, IOptionsMonitor<SecurityOptions> options)
{
    public Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        if (!request.Path.StartsWithSegments("/api") || IsSafe(request.Method)) return next(context);

        var origin = request.Headers.Origin.ToString();
        if (origin.Length > 0)
        {
            var allowed = options.CurrentValue.AllowedOrigins.Any(o => string.Equals(o.TrimEnd('/'), origin, StringComparison.OrdinalIgnoreCase));
            if (!allowed) return Problems.CsrfFailed().ExecuteAsync(context);
        }
        else if (request.Headers.TryGetValue("Sec-Fetch-Site", out var site)
                 && !string.Equals(site.ToString(), "same-origin", StringComparison.OrdinalIgnoreCase))
        {
            return Problems.CsrfFailed().ExecuteAsync(context);
        }
        return next(context);
    }

    private static bool IsSafe(string method) => HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
}
