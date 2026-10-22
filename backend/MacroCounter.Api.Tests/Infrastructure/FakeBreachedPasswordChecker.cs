using MacroCounter.Api.Auth;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>Stands in for Have I Been Pwned. Never touches the network.</summary>
public sealed class FakeBreachedPasswordChecker : IBreachedPasswordChecker
{
    public HashSet<string> Breached { get; } = ["password1234", "correcthorsebatterystaple"];

    /// <summary>When true, every check fails as if the service were down.</summary>
    public bool Unavailable { get; set; }

    public int Calls { get; private set; }

    public Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken)
    {
        Calls++;
        if (Unavailable) throw new BreachCheckUnavailableException(new HttpRequestException("fake outage"));
        return Task.FromResult(Breached.Contains(password));
    }
}
