using MacroCounter.Api.Endpoints;
using Microsoft.AspNetCore.Antiforgery;

namespace MacroCounter.Api.Security;

/// <summary>
/// Requires a valid antiforgery token (header X-CSRF-Token plus the __Host-mc_af cookie) on every unsafe
/// /api request, including sign-in, which blocks login CSRF (FR-010, research R10).
/// </summary>
public sealed class CsrfEndpointFilter(IAntiforgery antiforgery) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        {
            return await next(context);
        }

        try
        {
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            return Problems.CsrfFailed();
        }
        return await next(context);
    }
}
