namespace MacroCounter.Api.Security;

/// <summary>
/// Development and test runs serve http://localhost, which browsers treat as a secure context: they accept
/// the Secure, __Host- session and antiforgery cookies there. This mirrors that rule on the server so the
/// antiforgery system (which demands HTTPS for Secure cookies) works locally. Never used in Production,
/// which is HTTPS only (FR-027), and only for requests addressed to localhost.
/// </summary>
public static class LocalhostSecureContext
{
    public static IApplicationBuilder UseLocalhostSecureContext(this IApplicationBuilder app, IWebHostEnvironment environment)
    {
        if (environment.IsProduction()) return app;
        return app.Use((context, next) =>
        {
            if (!context.Request.IsHttps && IsLoopbackHost(context.Request.Host.Host))
            {
                context.Request.Scheme = Uri.UriSchemeHttps;
            }
            return next(context);
        });
    }

    public static bool IsLoopbackHost(string host) =>
        host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host is "127.0.0.1" or "[::1]" or "::1";
}
