using System.Text;
using MacroCounter.Api.Security;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Auth;

/// <summary>
/// NIST SP 800-63B style rules (research R2): length only, measured in characters after NFKC, and the
/// password must not contain the username. Breached-password checking is separate (IBreachedPasswordChecker).
/// </summary>
public sealed class PasswordPolicy(IOptions<SecurityOptions> options)
{
    public const string TooShort = "too_short";
    public const string TooLong = "too_long";
    public const string ContainsUsername = "contains_username";
    public const string Breached = "breached";

    /// <summary>Passwords are hashed and compared in this form, so visually equal input always matches.</summary>
    public static string Normalize(string password) => password.Normalize(NormalizationForm.FormKC);

    public IReadOnlyList<string> Check(string password, string username)
    {
        var settings = options.Value.Password;
        var normalized = Normalize(password);
        var length = normalized.EnumerateRunes().Count();
        var reasons = new List<string>();

        if (length < settings.MinLength) reasons.Add(TooShort);
        if (length > settings.MaxLength) reasons.Add(TooLong);
        if (username.Length > 0 && normalized.Contains(username, StringComparison.OrdinalIgnoreCase))
        {
            reasons.Add(ContainsUsername);
        }
        return reasons;
    }
}
