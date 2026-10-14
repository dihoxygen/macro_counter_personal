using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MacroCounter.Api.Ai;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Endpoints;

[Collection("Postgres")]
public class TextEstimateEndpointTests(PostgresFixture db)
{
    private const string Key = "test-key-not-real";

    private async Task<HttpResponseMessage> Post(IEstimator estimator, object body, string? apiKey = Key)
    {
        var factory = new ApiFactory(db, apiKey, estimator);
        return await (await factory.SignedInClientAsync()).PostAsJsonAsync("/api/estimates/text", body);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var json = await Json(response);
        Assert.Equal(code, json.GetProperty("code").GetString());
        Assert.Equal((int)status, json.GetProperty("status").GetInt32());
        Assert.False(string.IsNullOrEmpty(json.GetProperty("title").GetString()));
    }

    [Fact]
    public async Task Returns_the_validated_estimate_as_camelCase()
    {
        var estimator = FakeEstimator.Returning(new AiEstimateDto(true,
        [
            new AiEstimateItemDto("Egg", 50, "g", "1 large egg", 78, 6.3, 0.6, 5.3),
            new AiEstimateItemDto("Toast", 30, "g", "1 slice", 69, 3.6, 12, 0.9),
        ]));

        var response = await Post(estimator, new { description = "egg and toast" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await Json(response);
        Assert.True(json.GetProperty("recognized").GetBoolean());
        var first = json.GetProperty("items")[0];
        Assert.Equal("Egg", first.GetProperty("name").GetString());
        Assert.Equal(50, first.GetProperty("portion").GetProperty("amount").GetDouble());
        Assert.Equal("g", first.GetProperty("portion").GetProperty("unit").GetString());
        Assert.Equal("1 large egg", first.GetProperty("portionDescription").GetString());
        Assert.Equal(6.3, first.GetProperty("macros").GetProperty("proteinG").GetDouble());
        Assert.Equal(0, first.GetProperty("flags").GetArrayLength());
        // Total is recomputed on the server.
        Assert.Equal(147, json.GetProperty("total").GetProperty("kcal").GetDouble(), 10);
        Assert.Equal(9.9, json.GetProperty("total").GetProperty("proteinG").GetDouble(), 10);
        Assert.Equal(0, json.GetProperty("flags").GetArrayLength());
        Assert.Equal("egg and toast", estimator.LastDescription);
    }

    [Fact]
    public async Task Serializes_flags_in_snake_case()
    {
        var estimator = FakeEstimator.Returning(new AiEstimateDto(true,
            [new AiEstimateItemDto("Soup", 2500, "ml", "a pot", 900, 1, 1, 1)]));

        var json = await Json(await Post(estimator, new { description = "a pot of soup" }));

        Assert.Equal(["calorie_macro_mismatch", "large_portion"],
            json.GetProperty("flags").EnumerateArray().Select(f => f.GetString()));
    }

    [Fact]
    public async Task Unrecognized_food_is_a_200_with_no_items()
    {
        var json = await Json(await Post(FakeEstimator.Returning(new AiEstimateDto(false, [])), new { description = "asdf" }));
        Assert.False(json.GetProperty("recognized").GetBoolean());
        Assert.Equal(0, json.GetProperty("items").GetArrayLength());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Missing_or_blank_description_is_invalid_request(string? description)
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, new { description }), HttpStatusCode.BadRequest, "invalid_request");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Description_over_500_characters_is_invalid_request()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, new { description = new string('x', 501) }), HttpStatusCode.BadRequest, "invalid_request");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Description_of_exactly_500_characters_is_accepted()
    {
        var response = await Post(FakeEstimator.Returning(FakeEstimator.Banana), new { description = new string('x', 500) });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Malformed_json_body_is_invalid_request()
    {
        var factory = new ApiFactory(db, Key, FakeEstimator.Returning(FakeEstimator.Banana));
        var response = await (await factory.SignedInClientAsync()).PostAsync("/api/estimates/text",
            new StringContent("{not json", System.Text.Encoding.UTF8, "application/json"));
        await AssertProblem(response, HttpStatusCode.BadRequest, "invalid_request");
    }

    [Fact]
    public async Task Validator_rejection_is_invalid_ai_response()
    {
        var estimator = FakeEstimator.Returning(new AiEstimateDto(true,
            [new AiEstimateItemDto("Banana", 118, "g", "1", -5, 1, 1, 1)]));
        await AssertProblem(await Post(estimator, new { description = "banana" }), HttpStatusCode.BadGateway, "invalid_ai_response");
    }

    [Fact]
    public async Task Estimator_invalid_response_is_invalid_ai_response()
    {
        var estimator = FakeEstimator.Throwing(new InvalidAiResponseException("refused"));
        await AssertProblem(await Post(estimator, new { description = "banana" }), HttpStatusCode.BadGateway, "invalid_ai_response");
    }

    [Fact]
    public async Task No_key_is_ai_unavailable()
    {
        // No estimator override: the real DI registration must pick the unavailable estimator.
        var factory = new ApiFactory(db, apiKey: null);
        var response = await (await factory.SignedInClientAsync()).PostAsJsonAsync("/api/estimates/text", new { description = "banana" });
        await AssertProblem(response, HttpStatusCode.ServiceUnavailable, "ai_unavailable");
    }

    [Fact]
    public async Task Estimator_unavailable_is_ai_unavailable()
    {
        var estimator = FakeEstimator.Throwing(new AiUnavailableException("down"));
        await AssertProblem(await Post(estimator, new { description = "banana" }), HttpStatusCode.ServiceUnavailable, "ai_unavailable");
    }

    [Fact]
    public async Task Estimator_timeout_is_ai_timeout()
    {
        var estimator = FakeEstimator.Throwing(new AiTimeoutException("slow"));
        await AssertProblem(await Post(estimator, new { description = "banana" }), HttpStatusCode.GatewayTimeout, "ai_timeout");
    }

    [Fact]
    public async Task Aborting_the_request_cancels_the_estimator_token()
    {
        var started = new TaskCompletionSource();
        var cancelled = new TaskCompletionSource();
        var estimator = new FakeEstimator(async ct =>
        {
            ct.Register(() => cancelled.TrySetResult());
            started.SetResult();
            await Task.Delay(Timeout.Infinite, ct);
            return FakeEstimator.Banana;
        });
        var factory = new ApiFactory(db, Key, estimator);
        using var cts = new CancellationTokenSource();

        var request = (await factory.SignedInClientAsync()).PostAsJsonAsync("/api/estimates/text", new { description = "banana" }, cts.Token);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await cts.CancelAsync();

        await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(estimator.LastToken.IsCancellationRequested);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => request);
    }

    [Fact]
    public async Task Without_a_session_it_is_refused_and_claude_is_never_called()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        var factory = new ApiFactory(db, Key, estimator);

        var response = await factory.CreateClient().PostAsJsonAsync("/api/estimates/text", new { description = "banana" });

        await AssertProblem(response, HttpStatusCode.Unauthorized, "unauthenticated");
        Assert.Equal(0, estimator.Calls);
    }
}
