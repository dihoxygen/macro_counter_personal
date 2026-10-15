namespace MacroCounter.Api.Auth;

/// <summary>Claims carried by a session. Endpoints read the user only from <see cref="Subject"/>, never from input.</summary>
public static class AuthClaims
{
    public const string Subject = "sub";
    public const string Username = "username";
    public const string Role = "role";

    /// <summary>"setup" or "full" (see <see cref="Data.SessionRecord"/>).</summary>
    public const string SessionKind = "session_kind";
}
