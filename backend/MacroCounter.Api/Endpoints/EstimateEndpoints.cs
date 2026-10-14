using System.Text.Json;
using MacroCounter.Api.Ai;
using MacroCounter.Api.Contracts;
using MacroCounter.Api.Nutrition;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;

namespace MacroCounter.Api.Endpoints;

public static class EstimateEndpoints
{
    private const int MaxDescriptionLength = 500;
    private const int MaxNoteLength = 300;
    private const long MaxPhotoBytes = 5 * 1024 * 1024;

    /// <summary>Room for a 5 MB photo plus multipart overhead; larger bodies are cut off by Kestrel.</summary>
    private const long MaxPhotoRequestBytes = 6 * 1024 * 1024;

    private static readonly byte[] JpegMagic = [0xFF, 0xD8, 0xFF];

    public static void MapEstimateEndpoints(this IEndpointRouteBuilder api)
    {
        // Every AI call needs a full session: the key and the bill are the owner's (Principle VI/VII).
        api.MapPost("/estimates/text", EstimateFromText).RequireAuthorization();
        api.MapPost("/estimates/photo", EstimateFromPhoto)
            .RequireAuthorization()
            .WithMetadata(new RequestSizeLimitAttribute(MaxPhotoRequestBytes));
    }

    private static async Task<IResult> EstimateFromPhoto(HttpContext context, IEstimator estimator)
    {
        if (!context.Request.HasFormContentType)
        {
            return Problems.InvalidRequest("Send the photo as multipart/form-data with a 'photo' field.");
        }

        // Keep the whole upload in memory: the photo is never written to disk (research R7).
        var formFeature = new FormFeature(context.Request, new FormOptions
        {
            MemoryBufferThreshold = (int)MaxPhotoRequestBytes,
            MultipartBodyLengthLimit = MaxPhotoRequestBytes,
        });
        var form = await formFeature.ReadFormAsync(context.RequestAborted);

        var note = form["note"].ToString().Trim();
        if (note.Length > MaxNoteLength)
        {
            return Problems.InvalidRequest($"Keep the note to {MaxNoteLength} characters or fewer.");
        }

        var photo = form.Files.GetFile("photo");
        if (photo is null)
        {
            return Problems.InvalidRequest("Add a photo of the meal.");
        }
        if (photo.Length > MaxPhotoBytes)
        {
            return Problems.ImageTooLarge("Photos must be 5 MB or smaller.");
        }
        if (!string.Equals(photo.ContentType, "image/jpeg", StringComparison.OrdinalIgnoreCase))
        {
            return Problems.UnsupportedMediaType("Only JPEG photos are accepted.");
        }

        using var buffer = new MemoryStream((int)photo.Length);
        await photo.CopyToAsync(buffer, context.RequestAborted);
        var bytes = buffer.ToArray();
        if (bytes.Length < JpegMagic.Length || !bytes.AsSpan(0, JpegMagic.Length).SequenceEqual(JpegMagic))
        {
            return Problems.UnsupportedMediaType("The file is not a JPEG image.");
        }

        return await Estimate(
            ct => estimator.EstimateFromPhotoAsync(bytes, note.Length > 0 ? note : null, ct),
            context.RequestAborted);
    }

    private static async Task<IResult> EstimateFromText(HttpContext context, IEstimator estimator)
    {
        TextEstimateRequest? request;
        try
        {
            request = await context.Request.ReadFromJsonAsync<TextEstimateRequest>(context.RequestAborted);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            return Problems.InvalidRequest("The body must be JSON like {\"description\": \"1 medium banana\"}.");
        }

        var description = request?.Description?.Trim();
        if (string.IsNullOrEmpty(description))
        {
            return Problems.InvalidRequest("Describe the food you ate.");
        }
        if (description.Length > MaxDescriptionLength)
        {
            return Problems.InvalidRequest($"Keep the description to {MaxDescriptionLength} characters or fewer.");
        }

        return await Estimate(ct => estimator.EstimateFromTextAsync(description, ct), context.RequestAborted);
    }

    /// <summary>Calls the estimator, validates its output and maps failures to problem responses.</summary>
    internal static async Task<IResult> Estimate(Func<CancellationToken, Task<AiEstimateDto>> call, CancellationToken aborted)
    {
        AiEstimateDto raw;
        try
        {
            raw = await call(aborted);
        }
        catch (AiUnavailableException ex)
        {
            return Problems.AiUnavailable(ex.Message);
        }
        catch (AiTimeoutException ex)
        {
            return Problems.AiTimeout(ex.Message);
        }
        catch (InvalidAiResponseException ex)
        {
            return Problems.InvalidAiResponse(ex.Message);
        }

        return EstimateValidator.Validate(raw) switch
        {
            ValidationResult.Valid valid => Results.Ok(valid.Estimate),
            ValidationResult.Invalid invalid => Problems.InvalidAiResponse(invalid.Reason),
            _ => throw new InvalidOperationException("Unknown validation result."),
        };
    }
}
