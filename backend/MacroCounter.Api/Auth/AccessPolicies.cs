using MacroCounter.Api.Data;
using Microsoft.AspNetCore.Authorization;

namespace MacroCounter.Api.Auth;

/// <summary>Access levels from contracts/auth-api.yaml (x-access).</summary>
public static class AccessPolicies
{
    /// <summary>A normal signed-in session. The default for <c>RequireAuthorization()</c>.</summary>
    public const string FullSession = "FullSession";

    /// <summary>Only during first-time setup.</summary>
    public const string SetupSession = "SetupSession";

    /// <summary>Either kind (sign-out).</summary>
    public const string AnySession = "AnySession";

    public static void Configure(AuthorizationOptions options)
    {
        var full = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireClaim(AuthClaims.SessionKind, SessionRecord.FullKind)
            .Build();
        options.AddPolicy(FullSession, full);
        options.DefaultPolicy = full;
        options.AddPolicy(SetupSession, p => p.RequireAuthenticatedUser().RequireClaim(AuthClaims.SessionKind, SessionRecord.SetupKind));
        options.AddPolicy(AnySession, p => p.RequireAuthenticatedUser()
            .RequireClaim(AuthClaims.SessionKind, SessionRecord.FullKind, SessionRecord.SetupKind));
    }
}
