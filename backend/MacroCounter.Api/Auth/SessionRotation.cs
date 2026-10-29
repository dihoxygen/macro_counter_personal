using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace MacroCounter.Api.Auth;

/// <summary>
/// Every sign-in (including finishing setup) gets a brand-new session key, never a renewal of the one the
/// browser already holds, which prevents session fixation (research R4).
/// <para>
/// ASP.NET's cookie handler renews the existing session key when the request already carries one, and keeps
/// that key cached for the whole request, even across sign-out. So the old session is deleted, its cookie
/// is hidden from a fresh handler instance, and that handler stores a new session.
/// </para>
/// </summary>
public static class SessionRotation
{
    private const string HideSessionCookieItem = "MacroCounter.HideSessionCookie";

    public static async Task SignInWithNewKeyAsync(HttpContext context, AuthenticationTicket ticket)
    {
        if (context.Items[PostgresTicketStore.SessionKeyItem] is string oldKey)
        {
            await context.RequestServices.GetRequiredService<PostgresTicketStore>().RemoveAsync(oldKey, context.RequestAborted);
            context.Items.Remove(PostgresTicketStore.SessionKeyItem);
        }

        context.Items[HideSessionCookieItem] = true;
        await using var scope = context.RequestServices.CreateAsyncScope();
        var authentication = scope.ServiceProvider.GetRequiredService<IAuthenticationService>();
        await authentication.SignInAsync(context, ticket.AuthenticationScheme, ticket.Principal, ticket.Properties);
    }

    /// <summary>Reads cookies normally, except it hides the incoming session cookie while a new one is issued.</summary>
    public sealed class CookieManager : ICookieManager
    {
        private readonly ChunkingCookieManager _inner = new();

        public string? GetRequestCookie(HttpContext context, string key) =>
            context.Items.ContainsKey(HideSessionCookieItem) && key == AuthServices.SessionCookie
                ? null
                : _inner.GetRequestCookie(context, key);

        public void AppendResponseCookie(HttpContext context, string key, string? value, CookieOptions options) =>
            _inner.AppendResponseCookie(context, key, value, options);

        public void DeleteCookie(HttpContext context, string key, CookieOptions options) =>
            _inner.DeleteCookie(context, key, options);
    }
}
