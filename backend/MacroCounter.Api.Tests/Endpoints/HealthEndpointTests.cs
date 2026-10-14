using System.Net;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>R16 / FR-013: the public availability check reveals nothing about users or configuration.</summary>
[Collection("Postgres")]
public class HealthEndpointTests(PostgresFixture db)
{
    [Theory]
    [InlineData(null)]
    [InlineData("test-key-not-real")]
    public async Task Health_is_public_and_says_only_ok(string? apiKey)
    {
        await using var factory = new ApiFactory(db, apiKey);
        var response = await factory.CreateClient().GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("""{"status":"ok"}""", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Status_reveals_ai_configuration_only_to_a_signed_in_person()
    {
        await using var factory = new ApiFactory(db, apiKey: "test-key-not-real");
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/status")).StatusCode);
    }
}
