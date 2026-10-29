using MacroCounter.Api.Data;
using Microsoft.AspNetCore.Authorization;

namespace MacroCounter.Api.Auth;

/// <summary>Access levels from contracts/auth-api.yaml (x-access).</summary>
public static class AccessPolicies
{
    /// <summary>A normal signed-in session: the default for <c>RequireAuthorization()</c> and the fallback for everything else.</summary>
    public const string FullSession = "FullSession";

    /// <summary>Only during first-time setup.</summary>
    public const string SetupSession = "SetupSession";

    /// <summary>Only a pending sign-in waiting for its authenticator code (004 FR-006).</summary>
    public const string MfaSession = "MfaSession";

    /// <summary>Any kind: pending, setup or full (sign-out).</summary>
    public const string AnySession = "AnySession";

    public static void Configure(AuthorizationOptions options)
    {
        var full = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .RequireClaim(AuthClaims.SessionKind, SessionRecord.FullKind)
            .Build();
        options.AddPolicy(FullSession, full);
        options.DefaultPolicy = full;
        // Deny by default (FR-013): an endpoint with no explicit setting needs a full session.
        options.FallbackPolicy = full;
        options.AddPolicy(SetupSession, p => p.RequireAuthenticatedUser().RequireClaim(AuthClaims.SessionKind, SessionRecord.SetupKind));
        options.AddPolicy(MfaSession, p => p.RequireAuthenticatedUser().RequireClaim(AuthClaims.SessionKind, SessionRecord.MfaKind));
        options.AddPolicy(AnySession, p => p.RequireAuthenticatedUser()
            .RequireClaim(AuthClaims.SessionKind, SessionRecord.FullKind, SessionRecord.SetupKind, SessionRecord.MfaKind));
    }
}
