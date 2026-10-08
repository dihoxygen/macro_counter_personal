using System.Net;
using System.Text.Json;
using Anthropic.Exceptions;
using MacroCounter.Api.Ai;

namespace MacroCounter.Api.Tests.Ai;

public class ClaudeEstimatorPhotoTests
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46];

    private static readonly AnthropicOptions Options = new()
    {
        ApiKey = "test-key-not-real",
        Model = "model-from-config",
        Effort = "low",
    };

    private static ClaudeEstimator Estimator(FakeClaudeSender sender, TimeSpan? photoTimeout = null) =>
        new(sender, Microsoft.Extensions.Options.Options.Create(Options), photoTimeout: photoTimeout);

    private static Task<AiEstimateDto> Photo(FakeClaudeSender sender, string? note = null) =>
        Estimator(sender).EstimateFromPhotoAsync(Jpeg, note, CancellationToken.None);

    private static FakeClaudeSender Ok() =>
        FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));

    private static List<JsonElement> UserContent(FakeClaudeSender sender)
    {
        var message = Assert.Single(sender.Body.GetProperty("messages").EnumerateArray().ToList());
        Assert.Equal("user", message.GetProperty("role").GetString());
        return message.GetProperty("content").EnumerateArray().ToList();
    }

    [Fact]
    public async Task Sends_one_base64_jpeg_image_block_and_nothing_else_without_a_note()
    {
        var sender = Ok();
        await Photo(sender);

        var block = Assert.Single(UserContent(sender));
        Assert.Equal("image", block.GetProperty("type").GetString());
        var source = block.GetProperty("source");
        Assert.Equal("base64", source.GetProperty("type").GetString());
        Assert.Equal("image/jpeg", source.GetProperty("media_type").GetString());
        Assert.Equal(Convert.ToBase64String(Jpeg), source.GetProperty("data").GetString());
    }

    [Fact]
    public async Task Adds_the_note_as_text_after_the_image_when_present()
    {
        var sender = Ok();
        await Photo(sender, "cooked in olive oil");

        var content = UserContent(sender);
        Assert.Equal(2, content.Count);
        Assert.Equal("image", content[0].GetProperty("type").GetString());
        Assert.Equal("text", content[1].GetProperty("type").GetString());
        Assert.Equal("cooked in olive oil", content[1].GetProperty("text").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Leaves_out_a_blank_note(string note)
    {
        var sender = Ok();
        await Photo(sender, note);
        Assert.Single(UserContent(sender));
    }

    [Fact]
    public async Task Uses_the_same_schema_model_effort_system_prompt_and_fallback_as_text()
    {
        var sender = Ok();
        await Photo(sender);

        Assert.Equal("model-from-config", sender.Body.GetProperty("model").GetString());
        var outputConfig = sender.Body.GetProperty("output_config");
        Assert.Equal("low", outputConfig.GetProperty("effort").GetString());
        Assert.Equal("json_schema", outputConfig.GetProperty("format").GetProperty("type").GetString());
        Assert.Equal(EstimatePrompt.SystemPrompt, sender.Body.GetProperty("system").GetString());
        Assert.Equal("default", sender.Body.GetProperty("fallbacks").GetString());
        Assert.Contains("server-side-fallback-2026-07-01", sender.Betas);
    }

    [Fact]
    public async Task Maps_the_structured_json_to_the_dto()
    {
        var dto = await Photo(Ok());
        Assert.Equal("Banana", Assert.Single(dto.Items!).Name);
    }

    [Fact]
    public async Task Refusal_maps_to_invalid_ai_response()
    {
        var sender = FakeClaudeSender.Returning(FakeClaudeSender.Message("", stopReason: "refusal"));
        await Assert.ThrowsAsync<InvalidAiResponseException>(() => Photo(sender));
    }

    [Fact]
    public async Task Connection_error_maps_to_ai_unavailable()
    {
        var sender = FakeClaudeSender.Throwing(new AnthropicIOException("down", new HttpRequestException()));
        await Assert.ThrowsAsync<AiUnavailableException>(() => Photo(sender));
    }

    [Fact]
    public async Task Server_error_maps_to_ai_unavailable()
    {
        var sender = FakeClaudeSender.Throwing(
            new Anthropic5xxException { StatusCode = HttpStatusCode.ServiceUnavailable, ResponseBody = "" });
        await Assert.ThrowsAsync<AiUnavailableException>(() => Photo(sender));
    }

    [Fact]
    public async Task Timeout_maps_to_ai_timeout()
    {
        var estimator = Estimator(FakeClaudeSender.Hanging(), photoTimeout: TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAsync<AiTimeoutException>(
            () => estimator.EstimateFromPhotoAsync(Jpeg, null, CancellationToken.None));
    }

    [Fact]
    public void Default_photo_timeout_is_40_seconds()
    {
        Assert.Equal(TimeSpan.FromSeconds(40), ClaudeEstimator.PhotoTimeout);
    }
}
