using System.Security.Claims;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Endpoints;

namespace MacroCounter.Api.Usage;

/// <summary>
/// Runs before every AI estimate (FR-021): reserves the lookup in the quota, or refuses with the scope and
/// reset time. The per-minute burst limit ("ai-burst" rate-limiter policy) has already run by then.
/// </summary>
public sealed class AiLimitsEndpointFilter(AiQuotaService quota, TimeProvider clock) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (!Guid.TryParse(http.User.FindFirstValue(AuthClaims.Subject), out var userId)) return Problems.Unauthenticated();

        var result = await quota.TryReserveAsync(userId, http.RequestAborted);
        if (result is QuotaResult.Exceeded exceeded)
        {
            return Problems.QuotaExceeded(exceeded.Scope, exceeded.ResetAt, exceeded.ResetAt - clock.GetUtcNow());
        }
        return await next(context);
    }
}
