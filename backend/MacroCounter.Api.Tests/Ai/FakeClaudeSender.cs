using System.Text.Json;
using Anthropic.Models.Beta.Messages;
using MacroCounter.Api.Ai;

namespace MacroCounter.Api.Tests.Ai;

/// <summary>Stands in for the Anthropic SDK. Records the request; never touches the network.</summary>
public sealed class FakeClaudeSender : IClaudeMessageSender
{
    private readonly Func<CancellationToken, Task<BetaMessage>> _respond;

    public FakeClaudeSender(Func<CancellationToken, Task<BetaMessage>> respond) => _respond = respond;

    public MessageCreateParams? Request { get; private set; }

    public Task<BetaMessage> SendAsync(MessageCreateParams parameters, CancellationToken cancellationToken)
    {
        Request = parameters;
        return _respond(cancellationToken);
    }

    /// <summary>The JSON body the SDK would send to the API.</summary>
    public JsonElement Body => JsonSerializer.SerializeToElement(Request).GetProperty("RawBodyData");

    /// <summary>The beta flags as sent on the anthropic-beta header.</summary>
    public IReadOnlyList<string> Betas => Request?.Betas?.Select(b => b.Raw().ToString()).ToList() ?? [];

    public static FakeClaudeSender Returning(BetaMessage message) => new(_ => Task.FromResult(message));

    public static FakeClaudeSender Throwing(Exception exception) => new(_ => Task.FromException<BetaMessage>(exception));

    /// <summary>Never answers; completes only when the token is cancelled.</summary>
    public static FakeClaudeSender Hanging() => new(async ct =>
    {
        await Task.Delay(Timeout.Infinite, ct);
        throw new InvalidOperationException("unreachable");
    });

    public static BetaMessage Message(string text, string stopReason = "end_turn") =>
        BetaMessage.FromRawUnchecked(JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
            JsonSerializer.Serialize(new
            {
                id = "msg_test",
                type = "message",
                role = "assistant",
                model = "claude-opus-5-5",
                content = new object[] { new { type = "text", text } },
                stop_reason = stopReason,
                stop_sequence = (string?)null,
                usage = new { input_tokens = 10, output_tokens = 10 },
            }))!);

    public const string BananaJson =
        """{"recognized":true,"items":[{"name":"Banana","portion_amount":118,"portion_unit":"g","portion_description":"1 medium banana (~118 g)","kcal":105,"protein_g":1.3,"carbs_g":27,"fat_g":0.4}]}""";
}
