namespace MacroCounter.Api.Security;

/// <summary>
/// Protective browser headers on every response, errors included (FR-028, contracts/http-hardening.md).
/// The CSP allows only the app's own scripts and styles: no inline code, no framing, no other origins.
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment environment)
{
    private const string BaseCsp =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'{0}; " +
        "worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; " +
        "frame-ancestors 'none'{1}";

    // Production upgrades any stray http:// subresource; development serves http://localhost and uses Vite's websocket.
    private readonly string _csp = environment.IsProduction()
        ? string.Format(BaseCsp, "", "; upgrade-insecure-requests")
        : string.Format(BaseCsp, " ws://localhost:5173", "");

    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers.ContentSecurityPolicy = _csp;
            headers.XContentTypeOptions = "nosniff";
            headers["Referrer-Policy"] = "no-referrer";
            headers.XFrameOptions = "DENY";
            headers["Cross-Origin-Opener-Policy"] = "same-origin";
            headers["Cross-Origin-Resource-Policy"] = "same-origin";
            // Feature 002's in-app camera uses getUserMedia on this origin only.
            headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=(), payment=()";
            headers.Remove("X-Powered-By");

            var path = context.Request.Path;
            var html = context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true;
            if (path.StartsWithSegments("/api"))
            {
                // A browser opening an API URL directly downloads it instead of rendering it (ASVS 14.4.2).
                headers.ContentDisposition = "attachment; filename=\"api.json\"";
            }
            if (path.StartsWithSegments("/api") || html)
            {
                // Never cache the API or the app page: no stale signed-in screen after sign-out (US1.3).
                headers.CacheControl = "no-store";
            }
            else if (path.StartsWithSegments("/assets") && context.Response.StatusCode == StatusCodes.Status200OK)
            {
                // Vite puts a content hash in every asset file name.
                headers.CacheControl = "public, max-age=31536000, immutable";
            }
            return Task.CompletedTask;
        });
        return next(context);
    }
}
