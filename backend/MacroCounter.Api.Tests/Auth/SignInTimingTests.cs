using System.Diagnostics;
using System.Net;
using System.Text.Json.Nodes;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>
/// SC-004 / FR-005: on the password step, an unknown username, a wrong password and a wrong invite code give the
/// same answer in about the same time (mean within 100 ms), with the real PBKDF2 hasher. Only success is allowed
/// to differ (004 research R4).
/// </summary>
[Collection("Postgres")]
[Trait("Category", "Timing")]
public class SignInTimingTests(PostgresFixture db) : IAsyncLifetime
{
    private const int Runs = 30;
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        // Limits would turn later failures into 429s; this test is about the failures themselves.
        _factory.Settings["Security:SignIn:PerIpLimit"] = "100000";
        _factory.Settings["Security:SignIn:PerUsernameFailures"] = "100000";
        _factory.Settings["Security:SignIn:LockoutFailures"] = "100000";
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Every_kind_of_failure_looks_and_takes_the_same()
    {
        await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        await TestUsers.InviteAsync(db, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        (string Username, string Password)[] kinds =
        [
            ("nobody-here", "wrong password entirely"),
            ("alice", "wrong password entirely"),
            ("carol", "AAAA-BBBB-CCCC-DDDD-EEEE"),
        ];
        var times = kinds.Select(_ => new List<double>()).ToArray();
        var bodies = new HashSet<string>();

        for (var i = 0; i < 5; i++) await Attempt(client, kinds[i % kinds.Length]); // warm up
        for (var run = 0; run < Runs; run++)
        {
            for (var k = 0; k < kinds.Length; k++)
            {
                var watch = Stopwatch.StartNew();
                var (status, body) = await Attempt(client, kinds[k]);
                watch.Stop();
                Assert.Equal(HttpStatusCode.Unauthorized, status);
                times[k].Add(watch.Elapsed.TotalMilliseconds);
                bodies.Add(body);
            }
        }

        Assert.Single(bodies);
        var means = times.Select(t => t.Average()).ToArray();
        Assert.True(means.Max() - means.Min() < 100,
            $"mean times differ by {means.Max() - means.Min():F1} ms: {string.Join(", ", means.Select(m => m.ToString("F1")))}");
    }

    private static async Task<(HttpStatusCode, string)> Attempt(AuthClient client, (string Username, string Password) kind)
    {
        var response = await client.PostAsync("/api/auth/sign-in", new { username = kind.Username, password = kind.Password });
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        json.Remove("traceId");
        return (response.StatusCode, json.ToJsonString());
    }
}
