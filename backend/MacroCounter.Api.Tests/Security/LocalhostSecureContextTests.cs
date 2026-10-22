using System.Net;
using MacroCounter.Api.Security;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// http://localhost behaves as a secure context outside Production (as browsers treat it), so local sign-in
/// works; any other host over plain HTTP is still refused by the antiforgery system.
/// </summary>
[Collection("Postgres")]
public class LocalhostSecureContextTests(PostgresFixture db)
{
    [Fact]
    public async Task Session_state_works_over_http_on_localhost()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var client = factory.CreateDefaultClient(new Uri("http://localhost"));

        var response = await client.GetAsync("/api/auth/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Other_hosts_over_http_are_not_treated_as_secure()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var client = factory.CreateDefaultClient(new Uri("http://192.168.1.20"));

        var response = await client.GetAsync("/api/auth/session");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }

    [Theory]
    [InlineData("localhost", true)]
    [InlineData("LOCALHOST", true)]
    [InlineData("127.0.0.1", true)]
    [InlineData("[::1]", true)]
    [InlineData("192.168.1.20", false)]
    [InlineData("localhost.evil.example", false)]
    public void Recognizes_only_loopback_hosts(string host, bool expected)
    {
        Assert.Equal(expected, LocalhostSecureContext.IsLoopbackHost(host));
    }
}
