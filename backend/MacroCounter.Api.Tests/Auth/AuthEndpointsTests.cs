using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>The /api/auth/* endpoints over HTTP, as specified in contracts/auth-api.yaml.</summary>
[Collection("Postgres")]
public class AuthEndpointsTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await AuthClient.Json(response)).GetProperty("code").GetString());
    }

    private static string? SetCookie(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(v => v.StartsWith(name + "=", StringComparison.Ordinal))
            : null;

    private static string CookieValue(string setCookie) => setCookie.Split(';')[0];

    [Fact]
    public async Task Signed_out_session_state_carries_a_csrf_token_and_antiforgery_cookie()
    {
        var client = new AuthClient(_factory);
        var response = await client.Http.GetAsync("/api/auth/session");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await AuthClient.Json(response);
        Assert.Equal("signed_out", json.GetProperty("state").GetString());
        Assert.False(string.IsNullOrEmpty(json.GetProperty("csrfToken").GetString()));
        Assert.False(json.TryGetProperty("user", out _));
        var antiforgery = SetCookie(response, "__Host-mc_af");
        Assert.NotNull(antiforgery);
        Assert.Contains("httponly", antiforgery, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", antiforgery, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", antiforgery, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Sign_in_without_a_csrf_token_is_refused()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        await AssertProblem(await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = code }, withCsrf: false),
            HttpStatusCode.Forbidden, "csrf_failed");
    }

    [Fact]
    public async Task The_session_cookie_is_host_only_httponly_secure_and_strict()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        var response = await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = code });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cookie = SetCookie(response, "__Host-mc_session");
        Assert.NotNull(cookie);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", cookie, StringComparison.OrdinalIgnoreCase);
        var json = await AuthClient.Json(response);
        Assert.Equal("setup", json.GetProperty("state").GetString());
        Assert.Equal("password", json.GetProperty("setupStep").GetString());
    }

    [Fact]
    public async Task The_full_setup_over_http_ends_signed_in_with_a_new_session_key()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        var signIn = await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = code });
        var setupCookie = CookieValue(SetCookie(signIn, "__Host-mc_session")!);
        client.Csrf = (await AuthClient.Json(signIn)).GetProperty("csrfToken").GetString();

        var afterPassword = await client.PostForStateAsync("/api/auth/setup/password", new { newPassword = TestUsers.DefaultPassword });
        Assert.Equal("totp", afterPassword.GetProperty("setupStep").GetString());

        var enrollment = await AuthClient.Json(await client.PostAsync("/api/auth/setup/totp"));
        var secret = enrollment.GetProperty("setupKey").GetString()!.Replace(" ", "");
        Assert.StartsWith("otpauth://totp/Macro%20Counter:carol?secret=", enrollment.GetProperty("otpauthUri").GetString());

        var afterTotp = await client.PostForStateAsync("/api/auth/setup/totp/confirm", new { code = Totp.Compute(secret, DateTimeOffset.UtcNow) });
        Assert.Equal("notice", afterTotp.GetProperty("setupStep").GetString());

        var done = await client.PostAsync("/api/auth/setup/notice", new { acknowledged = true });
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        var state = await AuthClient.Json(done);
        Assert.Equal("signed_in", state.GetProperty("state").GetString());
        Assert.Equal("carol", state.GetProperty("user").GetProperty("username").GetString());
        Assert.Equal("user", state.GetProperty("user").GetProperty("role").GetString());
        Assert.True(Guid.TryParse(state.GetProperty("user").GetProperty("id").GetString(), out _));

        // Session fixation: the full session is a different key, and the setup session is gone.
        var fullCookie = CookieValue(SetCookie(done, "__Host-mc_session")!);
        Assert.NotEqual(setupCookie, fullCookie);
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions where kind = 'full'"));
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions where kind = 'setup'"));
    }

    [Fact]
    public async Task Normal_sign_in_works_and_a_wrong_password_gets_the_generic_message()
    {
        var (_, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        var wrong = await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = "not the password", code = carol.Code(1) });
        await AssertProblem(wrong, HttpStatusCode.Unauthorized, "sign_in_failed");
        Assert.Equal("Could not sign in. Check your details and try again.",
            (await AuthClient.Json(wrong)).GetProperty("detail").GetString());

        var state = await client.SignInAsync("carol", carol.Password, carol.Code(1));
        Assert.Equal("signed_in", state.GetProperty("state").GetString());
        Assert.Equal(carol.Id.ToString(), state.GetProperty("user").GetProperty("id").GetString());

        var session = await client.SessionAsync();
        Assert.Equal("signed_in", session.GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_signed_out_cookie_cannot_be_replayed()
    {
        var (client, _) = await TestUsers.ActivateAsync(db, _factory, "carol");
        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);
        var cookie = client.SessionCookieHeader();

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/sign-out")).StatusCode);

        var replay = _factory.CreateDefaultClient(AuthClient.BaseAddress);
        replay.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/status")).StatusCode);
    }

    [Fact]
    public async Task Sign_out_everywhere_ends_every_session_of_that_user()
    {
        var (first, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        var second = new AuthClient(_factory);
        await second.SessionAsync();
        await second.SignInAsync("carol", carol.Password, carol.Code(1));
        Assert.Equal(HttpStatusCode.OK, (await second.Http.GetAsync("/api/status")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await first.PostAsync("/api/auth/sign-out-everywhere")).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await second.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await first.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions"));
    }

    [Fact]
    public async Task Unknown_json_properties_are_rejected()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        await AssertProblem(await client.PostRawAsync("/api/auth/sign-in",
                $$"""{"username":"carol","password":"{{code}}","userId":"00000000-0000-0000-0000-000000000000"}"""),
            HttpStatusCode.BadRequest, "invalid_request");
    }

    [Fact]
    public async Task Bodies_over_4_kb_are_rejected()
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        var response = await client.PostRawAsync("/api/auth/sign-in",
            $$"""{"username":"carol","password":"{{new string('x', 5000)}}"}""");

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Theory]
    [InlineData("12345")]
    [InlineData("1234567")]
    [InlineData("12345a")]
    public async Task Codes_must_be_six_digits(string code)
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        await AssertProblem(await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = "whatever-pass", code }),
            HttpStatusCode.BadRequest, "invalid_request");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_usernames_are_invalid_requests(string username)
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();

        await AssertProblem(await client.PostAsync("/api/auth/sign-in", new { username, password = "whatever-pass" }),
            HttpStatusCode.BadRequest, "invalid_request");
    }
}
