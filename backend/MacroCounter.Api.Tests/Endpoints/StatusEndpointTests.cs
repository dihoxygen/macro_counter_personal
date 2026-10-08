using System.Net.Http.Json;
using MacroCounter.Api.Contracts;

namespace MacroCounter.Api.Tests.Endpoints;

public class StatusEndpointTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Status_reports_ai_unavailable_without_a_key(string? key)
    {
        await using var factory = new ApiFactory(apiKey: key);
        var status = await factory.CreateClient().GetFromJsonAsync<StatusResponse>("/api/status");
        Assert.False(status!.AiAvailable);
    }

    [Fact]
    public async Task Status_reports_ai_available_with_a_key()
    {
        await using var factory = new ApiFactory(apiKey: "test-key-not-real");
        var status = await factory.CreateClient().GetFromJsonAsync<StatusResponse>("/api/status");
        Assert.True(status!.AiAvailable);
    }

    [Fact]
    public async Task Status_json_is_camelCase()
    {
        await using var factory = new ApiFactory(apiKey: null);
        var json = await factory.CreateClient().GetStringAsync("/api/status");
        Assert.Equal("""{"aiAvailable":false}""", json);
    }
}
