using Microsoft.AspNetCore.HttpsPolicy;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Security;

/// <summary>Transport and configuration rules for the public deployment (FR-027, FR-030, Constitution VII).</summary>
public static class ProductionHardening
{
    public static WebApplicationBuilder AddProductionHardening(this WebApplicationBuilder builder)
    {
        builder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false);
        builder.Services.Configure<HstsOptions>(o =>
        {
            o.MaxAge = TimeSpan.FromDays(365);
            o.IncludeSubDomains = true;
        });
        builder.Services.Configure<HttpsRedirectionOptions>(o =>
        {
            o.RedirectStatusCode = StatusCodes.Status308PermanentRedirect;
            o.HttpsPort = 443;
        });
        return builder;
    }

    /// <summary>Production refuses to start with permissive defaults: any host, or no allowed origin.</summary>
    public static void ValidateProductionConfiguration(this WebApplication app)
    {
        if (!app.Environment.IsProduction()) return;

        var hosts = app.Configuration["AllowedHosts"];
        if (string.IsNullOrWhiteSpace(hosts) || hosts.Split(';').Any(h => h.Trim() == "*"))
        {
            throw new InvalidOperationException(
                "AllowedHosts must list the real host name in Production, never \"*\" (docs/deploy.md).");
        }
        var origins = app.Services.GetRequiredService<IOptions<SecurityOptions>>().Value.AllowedOrigins;
        if (!origins.Any(o => !string.IsNullOrWhiteSpace(o)))
        {
            throw new InvalidOperationException(
                "Security:AllowedOrigins must contain the app's own https:// origin in Production (docs/deploy.md).");
        }
    }
}
