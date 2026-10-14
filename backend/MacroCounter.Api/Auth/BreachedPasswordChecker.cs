using System.Security.Cryptography;
using System.Text;

namespace MacroCounter.Api.Auth;

public interface IBreachedPasswordChecker
{
    /// <summary>True when the password appears in a known breach.</summary>
    /// <exception cref="BreachCheckUnavailableException">The check could not be made (fail closed, research R2).</exception>
    Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken);
}

public sealed class BreachCheckUnavailableException(Exception inner)
    : Exception("The breached-password check is unavailable.", inner);

/// <summary>
/// Have I Been Pwned "Pwned Passwords" range API with k-anonymity: only the first five hex characters of
/// the SHA-1 hash leave the server, never the password or the username (Tech Constraints: Privacy).
/// </summary>
public sealed class HibpBreachedPasswordChecker(HttpClient http) : IBreachedPasswordChecker
{
    public static readonly Uri BaseAddress = new("https://api.pwnedpasswords.com/");

    public async Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken)
    {
        var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(password)));
        var prefix = hash[..5];
        var suffix = hash[5..];

        string body;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"range/{prefix}");
            // Padding hides how many real suffixes share the prefix.
            request.Headers.Add("Add-Padding", "true");
            using var response = await http.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            body = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            throw new BreachCheckUnavailableException(ex);
        }

        foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var separator = line.IndexOf(':');
            if (separator < 0) continue;
            if (line.AsSpan(0, separator).Equals(suffix, StringComparison.OrdinalIgnoreCase)
                && long.TryParse(line.AsSpan(separator + 1), out var count))
            {
                return count > 0;
            }
        }
        return false;
    }
}
