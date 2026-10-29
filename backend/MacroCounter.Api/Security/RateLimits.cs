using System.Security.Claims;
using System.Threading.RateLimiting;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Endpoints;
using MacroCounter.Api.Usage;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Security;

/// <summary>
/// Request-rate limits (research R7 layer 1, R8 burst): sign-in and setup per source IP, AI lookups per
/// person. Every refusal returns the same rate_limited problem and is audited.
/// </summary>
public static class RateLimits
{
    public const string SignIn = "sign-in";
    public const string AiBurst = "ai-burst";

    public static WebApplicationBuilder AddRateLimits(this WebApplicationBuilder builder)
    {
        var services = builder.Services;

        // The host's TLS proxy (App Service front end) adds the client address; take only the last hop it
        // added (ForwardLimit = 1), so a client cannot choose its own address by sending the header itself.
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.ForwardLimit = 1;
            o.KnownIPNetworks.Clear();
            o.KnownProxies.Clear();
        });

        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(SignIn, context =>
            {
                var settings = context.RequestServices.GetRequiredService<IOptions<SecurityOptions>>().Value.SignIn;
                return RateLimitPartition.GetFixedWindowLimiter(
                    $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}",
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = settings.PerIpLimit,
                        Window = settings.PerIpWindow,
                        QueueLimit = 0,
                    });
            });
            o.AddPolicy(AiBurst, context =>
            {
                var perMinute = context.RequestServices.GetRequiredService<IOptions<LimitsOptions>>().Value.Ai.BurstPerMinute;
                return RateLimitPartition.GetTokenBucketLimiter(
                    $"user:{context.User.FindFirstValue(AuthClaims.Subject) ?? "anonymous"}",
                    _ => new TokenBucketRateLimiterOptions
                    {
                        TokenLimit = perMinute,
                        TokensPerPeriod = perMinute,
                        ReplenishmentPeriod = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    });
            });
            o.OnRejected = async (context, cancellationToken) =>
            {
                var http = context.HttpContext;
                var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait) ? wait : TimeSpan.FromMinutes(1);
                var userId = Guid.TryParse(http.User.FindFirstValue(AuthClaims.Subject), out var id) ? id : (Guid?)null;
                await http.RequestServices.GetRequiredService<IAuditLog>().WriteAsync(AuditEvent.RateLimited, AuditOutcome.Failure,
                    userId, AuditReason.RateLimited, http.Connection.RemoteIpAddress, cancellationToken);
                await Problems.RateLimited(retryAfter).ExecuteAsync(http);
            };
        });
        return builder;
    }
}
