using System.Net;
using System.Text.RegularExpressions;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace MacroCounter.Api.Tests.Security;

/// <summary>SC-004: there is no way to create an account through the app, by any route.</summary>
[Collection("Postgres")]
public partial class NoSignUpRouteTests(PostgresFixture db)
{
    [GeneratedRegex("register|sign-?up|create-?account|invite|/users", RegexOptions.IgnoreCase)]
    private static partial Regex AccountCreation();

    [Fact]
    public async Task No_registered_route_looks_like_account_creation()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var routes = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Select(e => e.RoutePattern.RawText ?? "")
            .ToList();

        Assert.NotEmpty(routes);
        Assert.DoesNotContain(routes, r => AccountCreation().IsMatch(r));
    }

    [Theory]
    [InlineData("/api/auth/register")]
    [InlineData("/api/register")]
    [InlineData("/api/users")]
    [InlineData("/api/auth/sign-up")]
    [InlineData("/api/auth/signup")]
    [InlineData("/api/invites")]
    public async Task Posting_to_likely_sign_up_paths_never_succeeds(string path)
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var client = new AuthClient(factory);
        await client.SessionAsync();

        var response = await client.PostAsync(path, new { username = "mallory", password = "a long password here" });

        Assert.False(response.IsSuccessStatusCode, $"{path} returned {(int)response.StatusCode}");
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.users where username = 'mallory'"));
    }
}
