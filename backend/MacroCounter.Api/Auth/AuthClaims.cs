namespace MacroCounter.Api.Auth;

/// <summary>Claims carried by a session. Endpoints read the user only from <see cref="Subject"/>, never from input.</summary>
public static class AuthClaims
{
    public const string Subject = "sub";
    public const string Username = "username";
    public const string Role = "role";

    /// <summary>"setup", "mfa" or "full" (see <see cref="Data.SessionRecord"/>).</summary>
    public const string SessionKind = "session_kind";

    /// <summary>
    /// "true" on a pending or setup session when the person explicitly ticked Remember User at sign-in; the device
    /// is remembered only once the authenticator step completes (004 FR-015).
    /// </summary>
    public const string Remember = "remember";
}
