using MacroCounter.Api.Ai;
using MacroCounter.Api.Auth;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MacroCounter.Api.Testing;

/// <summary>
/// Switches for the end-to-end test host (frontend Playwright "auth" projects). They are registered only in
/// the "Testing" environment, so Development and Production can never be configured into using them.
/// </summary>
public static class TestingSwitches
{
    public const string EnvironmentName = "Testing";

    public static WebApplicationBuilder AddTestingSwitches(this WebApplicationBuilder builder)
    {
        if (!builder.Environment.IsEnvironment(EnvironmentName)) return builder;

        var services = builder.Services;
        var estimator = services.Last(d => d.ServiceType == typeof(IEstimator));
        services.Replace(ServiceDescriptor.Singleton<IEstimator>(sp =>
            sp.GetRequiredService<IConfiguration>().GetValue<bool>("Testing:FakeEstimator")
                ? new TestingEstimator()
                : (IEstimator)estimator.ImplementationFactory!(sp)));

        services.Replace(ServiceDescriptor.Transient<IBreachedPasswordChecker>(sp =>
        {
            var breached = sp.GetRequiredService<IConfiguration>().GetSection("Testing:BreachedPasswords").Get<string[]>();
            return breached is { Length: > 0 }
                ? new ListBreachedPasswordChecker(breached)
                : ActivatorUtilities.CreateInstance<HibpBreachedPasswordChecker>(sp,
                    sp.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(IBreachedPasswordChecker)));
        }));
        return builder;
    }
}

/// <summary>Always returns one banana. Never calls Claude.</summary>
public sealed class TestingEstimator : IEstimator
{
    private static readonly AiEstimateDto Banana = new(true,
        [new AiEstimateItemDto("Banana", 118, "g", "1 medium banana (~118 g)", 105, 1.3, 27, 0.4)]);

    public Task<AiEstimateDto> EstimateFromTextAsync(string description, CancellationToken cancellationToken) =>
        Task.FromResult(Banana);

    public Task<AiEstimateDto> EstimateFromPhotoAsync(byte[] jpeg, string? note, CancellationToken cancellationToken) =>
        Task.FromResult(Banana);
}

/// <summary>Treats exactly the configured passwords as breached. Never calls Have I Been Pwned.</summary>
public sealed class ListBreachedPasswordChecker(IEnumerable<string> breached) : IBreachedPasswordChecker
{
    private readonly HashSet<string> _breached = [.. breached];

    public Task<bool> IsBreachedAsync(string password, CancellationToken cancellationToken) =>
        Task.FromResult(_breached.Contains(password));
}
