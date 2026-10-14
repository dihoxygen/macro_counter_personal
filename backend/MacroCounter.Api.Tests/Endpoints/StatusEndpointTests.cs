using System.Net.Http.Json;
using MacroCounter.Api.Contracts;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Endpoints;

[Collection("Postgres")]
public class StatusEndpointTests(PostgresFixture db)
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Status_reports_ai_unavailable_without_a_key(string? key)
    {
        await using var factory = new ApiFactory(db, apiKey: key);
        var status = await (await factory.SignedInClientAsync()).GetFromJsonAsync<StatusResponse>("/api/status");
        Assert.False(status!.AiAvailable);
    }

    [Fact]
    public async Task Status_reports_ai_available_with_a_key()
    {
        await using var factory = new ApiFactory(db, apiKey: "test-key-not-real");
        var status = await (await factory.SignedInClientAsync()).GetFromJsonAsync<StatusResponse>("/api/status");
        Assert.True(status!.AiAvailable);
    }

    [Fact]
    public async Task Status_json_is_camelCase()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        var json = await (await factory.SignedInClientAsync()).GetStringAsync("/api/status");
        Assert.Equal("""{"aiAvailable":false}""", json);
    }

    [Fact]
    public async Task Status_requires_a_session()
    {
        await using var factory = new ApiFactory(db, apiKey: "test-key-not-real");
        var response = await factory.CreateClient().GetAsync("/api/status");
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
