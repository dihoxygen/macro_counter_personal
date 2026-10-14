using System.Net;
using System.Net.Http.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// US3: every endpoint that is not public refuses every kind of bad or wrong credential, and an AI endpoint
/// refused this way never reaches Claude.
/// </summary>
[Collection("Postgres")]
public class AccessMatrixTests(PostgresFixture db) : IAsyncLifetime
{
    private readonly FakeEstimator _estimator = FakeEstimator.Returning(FakeEstimator.Banana);
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: "test-key-not-real", _estimator);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    public static TheoryData<string> Credentials => new()
    {
        "none", "expired", "idle", "signed-out", "revoked", "disabled", "setup-on-full", "full-on-setup",
    };

    /// <summary>A client carrying the given kind of credential (and a CSRF token, so only access is tested).</summary>
    private async Task<AuthClient> ClientWith(string credential)
    {
        if (credential == "none")
        {
            var anonymous = new AuthClient(_factory);
            await anonymous.SessionAsync();
            return anonymous;
        }
        if (credential == "setup-on-full")
        {
            var code = await TestUsers.InviteAsync(db, "settingup");
            var setup = new AuthClient(_factory);
            await setup.SessionAsync();
            await setup.SignInAsync("settingup", code);
            return setup;
        }

        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "carol");
        switch (credential)
        {
            case "expired":
                // Kept active (under the idle limit) until past the 7-day absolute limit.
                for (var i = 0; i < 7; i++)
                {
                    _factory.Clock.Advance(TimeSpan.FromHours(23));
                    Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);
                }
                _factory.Clock.Advance(TimeSpan.FromHours(8));
                break;
            case "idle":
                _factory.Clock.Advance(TimeSpan.FromHours(24) + TimeSpan.FromSeconds(1));
                break;
            case "signed-out":
                var cookie = client.SessionCookieHeader();
                Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/sign-out")).StatusCode);
                var replay = new AuthClient(_factory) { Csrf = client.Csrf };
                replay.Cookies.SetCookies(AuthClient.BaseAddress, cookie + "; path=/; secure");
                return replay;
            case "revoked":
                await Sql.Execute(db.AdminConnectionString, "select macro_admin.revoke_sessions('carol')");
                break;
            case "disabled":
                await Sql.Execute(db.AdminConnectionString, "select macro_admin.disable_user('carol')");
                break;
        }
        return client;
    }

    private static bool Applies(string credential, string access) => credential switch
    {
        "setup-on-full" => access == "full",
        "full-on-setup" => access == "setup",
        _ => true,
    };

    private static HttpContent? Body(string path) => path switch
    {
        "/api/estimates/text" => JsonContent.Create(new { description = "banana" }),
        "/api/estimates/photo" => new MultipartFormDataContent { { new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0]), "photo", "m.jpg" } },
        "/api/auth/setup/password" => JsonContent.Create(new { newPassword = "a long and unbreached test passphrase" }),
        "/api/auth/setup/totp/confirm" => JsonContent.Create(new { code = "123456" }),
        "/api/auth/setup/notice" => JsonContent.Create(new { acknowledged = true }),
        _ => null,
    };

    [Theory]
    [MemberData(nameof(Credentials))]
    public async Task Every_protected_endpoint_refuses(string credential)
    {
        var client = await ClientWith(credential);
        var checkedAny = false;

        foreach (var endpoint in EndpointInventoryTests.ReadContract().Where(e => e.Access != "public"))
        {
            if (!Applies(credential, endpoint.Access)) continue;
            checkedAny = true;
            using var request = new HttpRequestMessage(new HttpMethod(endpoint.Method), endpoint.Path) { Content = Body(endpoint.Path) };
            if (client.Csrf is not null) request.Headers.Add("X-CSRF-Token", client.Csrf);

            var response = await client.Http.SendAsync(request);

            Assert.True(response.StatusCode == HttpStatusCode.Unauthorized,
                $"{credential}: {endpoint.Method} {endpoint.Path} returned {(int)response.StatusCode}");
        }

        Assert.True(checkedAny);
        Assert.Equal(0, _estimator.Calls);
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.ai_usage_daily"));
    }
}
