using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using MacroCounter.Api.Ai;

namespace MacroCounter.Api.Tests.Endpoints;

public class PhotoEstimateEndpointTests
{
    private const string Key = "test-key-not-real";
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00];

    private static MultipartFormDataContent Form(byte[]? photo, string? note = null, string contentType = "image/jpeg")
    {
        var form = new MultipartFormDataContent();
        if (photo is not null)
        {
            var file = new ByteArrayContent(photo);
            file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            form.Add(file, "photo", "meal.jpg");
        }
        if (note is not null) form.Add(new StringContent(note), "note");
        return form;
    }

    private static async Task<HttpResponseMessage> Post(IEstimator estimator, HttpContent content, string? apiKey = Key)
    {
        var factory = new ApiFactory(apiKey, estimator);
        return await factory.CreateClient().PostAsync("/api/estimates/photo", content);
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(code, json.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Returns_the_estimate_for_a_valid_jpeg_without_a_note()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        var response = await Post(estimator, Form(Jpeg));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Banana", json.GetProperty("items")[0].GetProperty("name").GetString());
        Assert.Equal(Jpeg, estimator.LastPhoto);
        Assert.Null(estimator.LastNote);
    }

    [Fact]
    public async Task Passes_the_note_through()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        var response = await Post(estimator, Form(Jpeg, "cooked in olive oil"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("cooked in olive oil", estimator.LastNote);
    }

    [Fact]
    public async Task Missing_photo_is_invalid_request()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, Form(null, "just a note")), HttpStatusCode.BadRequest, "invalid_request");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Non_multipart_body_is_invalid_request()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        var response = await Post(estimator, new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        await AssertProblem(response, HttpStatusCode.BadRequest, "invalid_request");
    }

    [Fact]
    public async Task Note_over_300_characters_is_invalid_request()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, Form(Jpeg, new string('x', 301))), HttpStatusCode.BadRequest, "invalid_request");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Note_of_exactly_300_characters_is_accepted()
    {
        var response = await Post(FakeEstimator.Returning(FakeEstimator.Banana), Form(Jpeg, new string('x', 300)));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Photo_over_5_MB_is_image_too_large()
    {
        var big = new byte[5 * 1024 * 1024 + 1];
        Jpeg.CopyTo(big, 0);
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, Form(big)), HttpStatusCode.RequestEntityTooLarge, "image_too_large");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Photo_of_exactly_5_MB_is_accepted()
    {
        var exact = new byte[5 * 1024 * 1024];
        Jpeg.CopyTo(exact, 0);
        var response = await Post(FakeEstimator.Returning(FakeEstimator.Banana), Form(exact));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("image/png")]
    [InlineData("application/octet-stream")]
    public async Task Non_jpeg_content_type_is_unsupported_media_type(string contentType)
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, Form(Jpeg, contentType: contentType)), HttpStatusCode.UnsupportedMediaType, "unsupported_media_type");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Bytes_without_the_jpeg_magic_number_are_unsupported_media_type()
    {
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, Form(png)), HttpStatusCode.UnsupportedMediaType, "unsupported_media_type");
        Assert.Equal(0, estimator.Calls);
    }

    [Fact]
    public async Task Tiny_file_is_unsupported_media_type()
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await AssertProblem(await Post(estimator, Form([0xFF, 0xD8])), HttpStatusCode.UnsupportedMediaType, "unsupported_media_type");
    }

    [Fact]
    public async Task Validator_rejection_is_invalid_ai_response()
    {
        var estimator = FakeEstimator.Returning(new AiEstimateDto(true, []));
        await AssertProblem(await Post(estimator, Form(Jpeg)), HttpStatusCode.BadGateway, "invalid_ai_response");
    }

    [Fact]
    public async Task No_key_is_ai_unavailable()
    {
        var factory = new ApiFactory(apiKey: null);
        var response = await factory.CreateClient().PostAsync("/api/estimates/photo", Form(Jpeg));
        await AssertProblem(response, HttpStatusCode.ServiceUnavailable, "ai_unavailable");
    }

    [Fact]
    public async Task Estimator_timeout_is_ai_timeout()
    {
        var estimator = FakeEstimator.Throwing(new AiTimeoutException("slow"));
        await AssertProblem(await Post(estimator, Form(Jpeg)), HttpStatusCode.GatewayTimeout, "ai_timeout");
    }

    [Fact]
    public async Task Estimator_invalid_response_is_invalid_ai_response()
    {
        var estimator = FakeEstimator.Throwing(new InvalidAiResponseException("refused"));
        await AssertProblem(await Post(estimator, Form(Jpeg)), HttpStatusCode.BadGateway, "invalid_ai_response");
    }
}
