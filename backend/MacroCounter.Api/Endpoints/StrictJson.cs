using System.Text.Json;
using System.Text.Json.Serialization;

namespace MacroCounter.Api.Endpoints;

/// <summary>
/// Reads small JSON request bodies strictly (contracts/auth-api.yaml): at most <c>maxBytes</c>, camelCase
/// property names, and unknown properties rejected, so e.g. a smuggled "userId" is refused, not ignored.
/// </summary>
public static class StrictJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        PropertyNameCaseInsensitive = false,
    };

    public static async Task<(T? Value, IResult? Problem)> ReadAsync<T>(HttpContext context, int maxBytes)
        where T : class
    {
        if (context.Request.ContentLength > maxBytes) return (null, Problems.BodyTooLarge());
        if (!context.Request.HasJsonContentType())
        {
            return (null, Problems.InvalidRequest("Send the body as application/json."));
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        int read;
        while ((read = await context.Request.Body.ReadAsync(chunk, context.RequestAborted)) > 0)
        {
            if (buffer.Length + read > maxBytes) return (null, Problems.BodyTooLarge());
            buffer.Write(chunk, 0, read);
        }

        try
        {
            var value = JsonSerializer.Deserialize<T>(buffer.ToArray(), Options);
            return value is null ? (null, Problems.InvalidRequest("The body must be a JSON object.")) : (value, null);
        }
        catch (JsonException)
        {
            return (null, Problems.InvalidRequest("The body is not valid for this request."));
        }
    }
}
