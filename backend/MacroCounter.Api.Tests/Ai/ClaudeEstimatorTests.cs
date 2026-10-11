using System.Net;
using System.Text.Json;
using Anthropic.Exceptions;
using MacroCounter.Api.Ai;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Tests.Ai;

public class ClaudeEstimatorTests
{
    private static readonly AnthropicOptions Options = new()
    {
        ApiKey = "test-key-not-real",
        Model = "model-from-config",
        Effort = "low",
    };

    private static ClaudeEstimator Estimator(
        FakeClaudeSender sender, TimeSpan? textTimeout = null, TimeSpan? photoTimeout = null) =>
        new(sender, Microsoft.Extensions.Options.Options.Create(Options), textTimeout, photoTimeout);

    private static Task<AiEstimateDto> Text(FakeClaudeSender sender, string description = "1 medium banana") =>
        Estimator(sender).EstimateFromTextAsync(description, CancellationToken.None);

    [Fact]
    public async Task Uses_model_and_effort_from_options()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await Text(sender);

        Assert.Equal("model-from-config", sender.Body.GetProperty("model").GetString());
        Assert.Equal("low", sender.Body.GetProperty("output_config").GetProperty("effort").GetString());
    }

    [Fact]
    public async Task Requests_structured_output_with_the_ai_estimate_schema()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await Text(sender);

        var format = sender.Body.GetProperty("output_config").GetProperty("format");
        Assert.Equal("json_schema", format.GetProperty("type").GetString());
        var schema = format.GetProperty("schema");
        Assert.Equal(
            ["items", "recognized"],
            schema.GetProperty("required").EnumerateArray().Select(e => e.GetString()).Order());
        Assert.True(schema.GetProperty("properties").GetProperty("items").GetProperty("items")
            .GetProperty("properties").TryGetProperty("protein_g", out _));
    }

    [Fact]
    public async Task Sends_the_stable_system_prompt()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await Text(sender);

        Assert.Equal(EstimatePrompt.SystemPrompt, sender.Body.GetProperty("system").GetString());
    }

    [Fact]
    public async Task User_content_is_only_the_description()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await Text(sender, "2 eggs and toast");

        var messages = sender.Body.GetProperty("messages").EnumerateArray().ToList();
        var message = Assert.Single(messages);
        Assert.Equal("user", message.GetProperty("role").GetString());
        Assert.Equal("2 eggs and toast", message.GetProperty("content").GetString());
    }

    [Fact]
    public async Task Enables_the_server_side_refusal_fallback()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await Text(sender);

        Assert.Equal("default", sender.Body.GetProperty("fallbacks").GetString());
        Assert.Contains("server-side-fallback-2026-07-01", sender.Betas);
    }

    [Fact]
    public async Task Does_not_disable_thinking()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        await Text(sender);

        Assert.False(sender.Body.TryGetProperty("thinking", out _));
    }

    [Fact]
    public async Task Maps_the_structured_json_to_the_dto()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
        var dto = await Text(sender);

        Assert.True(dto.Recognized);
        var item = Assert.Single(dto.Items!);
        Assert.Equal(new AiEstimateItemDto("Banana", 118, "g", "1 medium banana (~118 g)", 105, 1.3, 27, 0.4), item);
    }

    [Fact]
    public async Task Refusal_maps_to_invalid_ai_response()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message("", stopReason: "refusal"));
        await Assert.ThrowsAsync<InvalidAiResponseException>(() => Text(sender));
    }

    [Fact]
    public async Task Max_tokens_cut_off_maps_to_invalid_ai_response()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message("""{"recognized":tr""", stopReason: "max_tokens"));
        await Assert.ThrowsAsync<InvalidAiResponseException>(() => Text(sender));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("")]
    [InlineData("null")]
    public async Task Unparseable_output_maps_to_invalid_ai_response(string text)
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(text));
        await Assert.ThrowsAsync<InvalidAiResponseException>(() => Text(sender));
    }

    [Fact]
    public async Task Timeout_maps_to_ai_timeout()
    {
        var estimator = Estimator(FakeClaudeSender.Hanging(), textTimeout: TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAsync<AiTimeoutException>(
            () => estimator.EstimateFromTextAsync("banana", CancellationToken.None));
    }

    [Fact]
    public void Default_text_timeout_is_25_seconds()
    {
        Assert.Equal(TimeSpan.FromSeconds(25), ClaudeEstimator.TextTimeout);
    }

    [Fact]
    public async Task Connection_error_maps_to_ai_unavailable()
    {
        var sender = FakeClaudeSender.Throwing(new AnthropicIOException("connection refused", new HttpRequestException()));
        await Assert.ThrowsAsync<AiUnavailableException>(() => Text(sender));
    }

    [Fact]
    public async Task Server_error_maps_to_ai_unavailable()
    {
        var sender = FakeClaudeSender.Throwing(
            new Anthropic5xxException { StatusCode = HttpStatusCode.BadGateway, ResponseBody = "" });
        await Assert.ThrowsAsync<AiUnavailableException>(() => Text(sender));
    }

    [Fact]
    public async Task Other_api_errors_map_to_ai_unavailable()
    {
        var sender = FakeClaudeSender.Throwing(
            new AnthropicRateLimitException { StatusCode = HttpStatusCode.TooManyRequests, ResponseBody = "" });
        await Assert.ThrowsAsync<AiUnavailableException>(() => Text(sender));
    }

    [Fact]
    public async Task Caller_cancellation_is_propagated()
    {
        using var cts = new CancellationTokenSource();
        var task = Estimator(FakeClaudeSender.Hanging()).EstimateFromTextAsync("banana", cts.Token);
        await cts.CancelAsync();

        var ex = await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        Assert.IsNotType<AiTimeoutException>(ex);
    }

    [Fact]
    public async Task Response_json_round_trips_through_the_snake_case_dto()
    {
        // Guards the DTO's JSON names against the schema's property names.
        var schema = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "ai-estimate.schema.json")));
        var schemaNames = schema.RootElement.GetProperty("properties").GetProperty("items").GetProperty("items")
            .GetProperty("properties").EnumerateObject().Select(p => p.Name).Order().ToList();

        var dto = await Text(FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson)));
        var json = JsonSerializer.SerializeToElement(dto.Items![0]);
        Assert.Equal(schemaNames, json.EnumerateObject().Select(p => p.Name).Order().ToList());
    }
}
