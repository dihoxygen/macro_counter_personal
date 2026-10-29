using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using MacroCounter.Api.Ai;
using MacroCounter.Api.Tests.Ai;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>
/// Tech Constraints, Privacy: "The identity of the requesting user MUST NOT be sent to Anthropic." Runs the
/// real ClaudeEstimator over a fake sender and inspects exactly what would go to the API.
/// </summary>
[Collection("Postgres")]
public class NoIdentityToAnthropicTests(PostgresFixture db) : IAsyncLifetime
{
    private const string Username = "idcheck-user";
    private readonly FakeClaudeSender _sender = FakeClaudeSender.Returning(FakeClaudeSender.Message(FakeClaudeSender.BananaJson));
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: "test-key-not-real");
        _factory.ServiceOverrides.Add(services => services.Replace(ServiceDescriptor.Singleton<IEstimator>(sp =>
            new ClaudeEstimator(_sender, sp.GetRequiredService<IOptions<AnthropicOptions>>()))));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private string Sent() =>
        JsonSerializer.Serialize(_sender.Body) + "\n" + string.Join(",", _sender.Betas);

    [Fact]
    public async Task Text_and_photo_requests_carry_no_user_identity()
    {
        var user = await TestUsers.ActivateDirectlyAsync(db, _factory, Username);
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        await client.SignInAsync(Username, user.Password, user.Code());
        var secrets = new[]
        {
            Username, Username.ToUpperInvariant(), user.Id.ToString(), user.Id.ToString("N"),
            client.SessionCookieHeader().Split('=', 2)[1], client.Csrf!, "127.0.0.1", "::1",
        };

        var text = await client.PostAsync("/api/estimates/text", new { description = "1 medium banana" });
        Assert.Equal(HttpStatusCode.OK, text.StatusCode);
        AssertNoIdentity(Sent(), secrets);

        using var form = new MultipartFormDataContent();
        var photo = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
        photo.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(photo, "photo", "meal.jpg");
        form.Add(new StringContent("grilled, no sauce"), "note");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/estimates/photo") { Content = form };
        request.Headers.Add("X-CSRF-Token", client.Csrf);
        Assert.Equal(HttpStatusCode.OK, (await client.Http.SendAsync(request)).StatusCode);
        AssertNoIdentity(Sent(), secrets);
    }

    private void AssertNoIdentity(string sent, IEnumerable<string> secrets)
    {
        foreach (var secret in secrets)
        {
            Assert.DoesNotContain(secret, sent, StringComparison.OrdinalIgnoreCase);
        }
        // Not even an opaque metadata.user_id.
        Assert.False(_sender.Body.TryGetProperty("metadata", out _), "The request must not carry a metadata property.");
    }
}
