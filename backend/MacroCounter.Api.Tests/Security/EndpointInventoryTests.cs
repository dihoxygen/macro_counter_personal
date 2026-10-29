using MacroCounter.Api.Auth;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// SC-003 / FR-013: every /api endpoint is declared in the live contract (specs/004-security-qol/contracts/auth-api.yaml)
/// with its access level, and the running app enforces exactly that. A new endpoint that is not in the contract fails this test.
/// </summary>
[Collection("Postgres")]
public class EndpointInventoryTests(PostgresFixture db)
{
    public sealed record ContractEndpoint(string Method, string Path, string Access);

    /// <summary>Line-based reader for the contract's paths, methods and x-access (no YAML package, Principle V).</summary>
    public static IReadOnlyList<ContractEndpoint> ReadContract()
    {
        var file = Path.Combine(RepoRoot(), "specs", "004-security-qol", "contracts", "auth-api.yaml");
        var endpoints = new List<ContractEndpoint>();
        string? path = null;
        string? method = null;
        string? access = null;
        var inPaths = false;

        void Flush()
        {
            if (path is not null && method is not null) endpoints.Add(new(method, "/api" + path, access ?? "full"));
            method = null;
            access = null;
        }

        foreach (var raw in File.ReadLines(file))
        {
            var line = raw.TrimEnd();
            if (line == "paths:") { inPaths = true; continue; }
            if (!inPaths) continue;
            if (line.Length > 0 && !line.StartsWith(' ')) { Flush(); break; } // next top-level key (components)
            if (line.StartsWith("  /") && !line.StartsWith("   ") && line.EndsWith(':'))
            {
                Flush();
                path = line.Trim().TrimEnd(':');
            }
            else if (line.StartsWith("    ") && !line.StartsWith("     ") && line.Trim() is "get:" or "post:" or "put:" or "patch:" or "delete:")
            {
                Flush();
                method = line.Trim().TrimEnd(':').ToUpperInvariant();
            }
            else if (line.Trim().StartsWith("x-access:", StringComparison.Ordinal))
            {
                access = line.Trim()["x-access:".Length..].Trim();
            }
        }
        Flush();
        return endpoints;
    }

    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "specs"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("Repository root (with specs/) not found.");
    }

    private static IEnumerable<(string Method, string Path, RouteEndpoint Endpoint)> ApiEndpoints(ApiFactory factory) =>
        factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => ("/" + e.RoutePattern.RawText?.TrimStart('/')).StartsWith("/api/", StringComparison.Ordinal))
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["*"])
                .Select(m => (m, "/" + e.RoutePattern.RawText!.TrimStart('/'), e)));

    [Fact]
    public void The_contract_lists_the_expected_public_endpoints()
    {
        var contract = ReadContract();
        Assert.NotEmpty(contract);
        Assert.Equal(
            ["GET /api/auth/session", "GET /api/health", "POST /api/auth/sign-in"],
            contract.Where(e => e.Access == "public").Select(e => $"{e.Method} {e.Path}").Order());
    }

    [Fact]
    public async Task Registered_api_endpoints_are_exactly_the_contract()
    {
        await using var factory = new ApiFactory(db, apiKey: null);

        var registered = ApiEndpoints(factory).Select(e => $"{e.Method} {e.Path}").Order().ToList();
        var declared = ReadContract().Select(e => $"{e.Method} {e.Path}").Order().ToList();

        Assert.Equal(declared, registered);
    }

    [Fact]
    public async Task Each_endpoint_enforces_its_declared_access()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var declared = ReadContract().ToDictionary(e => $"{e.Method} {e.Path}", e => e.Access);

        foreach (var (method, path, endpoint) in ApiEndpoints(factory))
        {
            var key = $"{method} {path}";
            var anonymous = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
            var policies = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Select(a => a.Policy ?? AccessPolicies.FullSession).ToList();
            var actual = anonymous ? "public"
                : policies.Contains(AccessPolicies.SetupSession) ? "setup"
                : policies.Contains(AccessPolicies.MfaSession) ? "mfa"
                : policies.Contains(AccessPolicies.AnySession) ? "any-session"
                : "full"; // RequireAuthorization() (default policy) or no metadata (fallback policy): both FullSession
            Assert.True(declared[key] == actual, $"{key}: contract says {declared[key]}, app enforces {actual}");
        }
    }

    [Fact]
    public async Task Anything_without_an_explicit_setting_needs_a_full_session()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var options = factory.Services.GetRequiredService<IOptions<AuthorizationOptions>>().Value;

        Assert.NotNull(options.FallbackPolicy);
        Assert.Same(options.GetPolicy(AccessPolicies.FullSession), options.FallbackPolicy);
        Assert.Same(options.GetPolicy(AccessPolicies.FullSession), options.DefaultPolicy);
    }
}
