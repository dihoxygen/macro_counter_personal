using System.Text;
using System.Text.Json;
using Anthropic;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Ai;

// This file is the only place in the app that references the Anthropic SDK (Principle VI).

/// <summary>Thin seam over the SDK call so tests can fake it without a network.</summary>
public interface IClaudeMessageSender
{
    Task<BetaMessage> SendAsync(MessageCreateParams parameters, CancellationToken cancellationToken);
}

public sealed class AnthropicMessageSender(AnthropicClient client) : IClaudeMessageSender
{
    public Task<BetaMessage> SendAsync(MessageCreateParams parameters, CancellationToken cancellationToken) =>
        client.Beta.Messages.Create(parameters, cancellationToken);
}

/// <summary>Asks Claude for a structured macro estimate. Validation happens later, in EstimateValidator.</summary>
public sealed class ClaudeEstimator(
    IClaudeMessageSender sender,
    IOptions<AnthropicOptions> options,
    TimeSpan? textTimeout = null,
    TimeSpan? photoTimeout = null) : IEstimator
{
    /// <summary>Leaves room inside SC-001's 30 s budget.</summary>
    public static readonly TimeSpan TextTimeout = TimeSpan.FromSeconds(25);

    /// <summary>Leaves room inside SC-002's 45 s budget.</summary>
    public static readonly TimeSpan PhotoTimeout = TimeSpan.FromSeconds(40);

    private const int MaxTokens = 16000;
    private const string FallbackBeta = "server-side-fallback-2026-07-01";

    private readonly AnthropicOptions _options = options.Value;

    public Task<AiEstimateDto> EstimateFromTextAsync(string description, CancellationToken cancellationToken) =>
        SendAsync(Build(description), textTimeout ?? TextTimeout, cancellationToken);

    /// <summary>Sends only the image and, if given, the note (FR-015).</summary>
    public Task<AiEstimateDto> EstimateFromPhotoAsync(byte[] jpeg, string? note, CancellationToken cancellationToken)
    {
        List<BetaContentBlockParam> content =
        [
            new BetaImageBlockParam
            {
                Source = new BetaBase64ImageSource { Data = Convert.ToBase64String(jpeg), MediaType = MediaType.ImageJpeg },
            },
        ];
        if (!string.IsNullOrWhiteSpace(note))
        {
            content.Add(new BetaTextBlockParam { Text = note });
        }
        return SendAsync(Build(content), photoTimeout ?? PhotoTimeout, cancellationToken);
    }

    private MessageCreateParams Build(BetaMessageParamContent content) => new()
    {
        Model = _options.Model,
        MaxTokens = MaxTokens,
        Betas = [FallbackBeta],
        // Adaptive thinking is the default on this model: Thinking is deliberately omitted.
        Fallbacks = new Default(),
        System = EstimatePrompt.SystemPrompt,
        OutputConfig = new BetaOutputConfig
        {
            Effort = _options.Effort,
            Format = new BetaJsonOutputFormat { Schema = EstimatePrompt.Schema.ToDictionary() },
        },
        Messages = [new BetaMessageParam { Role = Role.User, Content = content }],
    };

    private async Task<AiEstimateDto> SendAsync(MessageCreateParams parameters, TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        BetaMessage response;
        try
        {
            response = await sender.SendAsync(parameters, timeoutCts.Token);
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            throw new AiTimeoutException($"Claude did not answer within {timeout.TotalSeconds:0} s.", ex);
        }
        catch (AnthropicIOException ex)
        {
            throw new AiUnavailableException("Could not reach Claude.", ex);
        }
        catch (AnthropicApiException ex)
        {
            throw new AiUnavailableException($"Claude returned HTTP {(int)ex.StatusCode}.", ex);
        }

        // Check the stop reason before reading content.
        if (response.StopReason == "refusal")
        {
            throw new InvalidAiResponseException("Claude declined to estimate this food.");
        }
        if (response.StopReason != "end_turn")
        {
            throw new InvalidAiResponseException($"Claude stopped early ({response.StopReason}).");
        }

        var text = new StringBuilder();
        foreach (var block in response.Content)
        {
            if (block.TryPickText(out var textBlock)) text.Append(textBlock.Text);
        }

        try
        {
            return JsonSerializer.Deserialize<AiEstimateDto>(text.ToString())
                ?? throw new InvalidAiResponseException("Claude returned an empty estimate.");
        }
        catch (JsonException ex)
        {
            throw new InvalidAiResponseException("Claude returned output that is not valid JSON.", ex);
        }
    }
}
