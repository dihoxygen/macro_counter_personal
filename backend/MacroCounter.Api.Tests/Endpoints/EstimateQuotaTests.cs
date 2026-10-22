using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using MacroCounter.Api.Ai;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>FR-021: the AI endpoints check the burst limit and the quota before Claude is ever called.</summary>
[Collection("Postgres")]
public class EstimateQuotaTests(PostgresFixture db) : IAsyncLifetime
{
    public async Task InitializeAsync() => await db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static HttpContent Body(string path)
    {
        if (path.EndsWith("text", StringComparison.Ordinal)) return JsonContent.Create(new { description = "banana" });
        var form = new MultipartFormDataContent();
        var photo = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
        photo.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(photo, "photo", "meal.jpg");
        return form;
    }

    public static TheoryData<string> Paths => new() { "/api/estimates/text", "/api/estimates/photo" };

    [Theory]
    [MemberData(nameof(Paths))]
    public async Task Over_the_daily_quota_it_is_refused_with_scope_and_reset_time_and_claude_is_not_called(string path)
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await using var factory = new ApiFactory(db, "test-key-not-real", estimator);
        factory.Settings["Limits:Ai:PerUserDaily"] = "2";
        var client = await factory.SignedInClientAsync();

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync(path, Body(path))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync(path, Body(path))).StatusCode);
        var refused = await client.PostAsync(path, Body(path));

        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        var json = JsonDocument.Parse(await refused.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("quota_exceeded", json.GetProperty("code").GetString());
        Assert.Equal("user_daily", json.GetProperty("scope").GetString());
        var now = factory.Clock.GetUtcNow();
        Assert.Equal(new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, TimeSpan.Zero).AddDays(1),
            json.GetProperty("resetAt").GetDateTimeOffset());
        Assert.NotNull(refused.Headers.RetryAfter);
        Assert.Equal(2, estimator.Calls);
    }

    [Fact]
    public async Task A_failed_ai_call_still_counts_because_it_may_have_been_billed()
    {
        await using var factory = new ApiFactory(db, "test-key-not-real", FakeEstimator.Throwing(new AiUnavailableException("down")));
        var client = await factory.SignedInClientAsync();

        Assert.Equal(HttpStatusCode.ServiceUnavailable,
            (await client.PostAsync("/api/estimates/text", Body("/api/estimates/text"))).StatusCode);

        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select coalesce(sum(count), 0) from macro.ai_usage_daily"));
    }

    [Theory]
    [MemberData(nameof(Paths))]
    public async Task More_than_six_a_minute_is_slowed_down_for_that_person_only(string path)
    {
        var estimator = FakeEstimator.Returning(FakeEstimator.Banana);
        await using var factory = new ApiFactory(db, "test-key-not-real", estimator);
        var first = await factory.SignedInClientAsync();
        var second = await factory.SignedInClientAsync();

        for (var i = 0; i < 6; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await first.PostAsync(path, Body(path))).StatusCode);
        }
        var seventh = await first.PostAsync(path, Body(path));

        Assert.Equal(HttpStatusCode.TooManyRequests, seventh.StatusCode);
        Assert.Equal("rate_limited", JsonDocument.Parse(await seventh.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.OK, (await second.PostAsync(path, Body(path))).StatusCode);
        Assert.Equal(7, estimator.Calls);
    }
}
